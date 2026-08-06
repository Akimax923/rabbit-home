import crypto from 'node:crypto';
import express from 'express';
import { createRateLimiter, hashPassword, parseCookies, randomToken, sanitizeText, tokenHash, validUsername, verifyPassword } from './security.js';

const COOKIE_NAME = 'rabbit_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SOCKET_CLIENT_URL = '/vendor/socket.io.min.js';
const RABBIT_VARIANTS = new Set(['dwarf', 'lop', 'lion']);
const MAOMAO_VARIANTS = new Set(['cream', 'cloud', 'chestnut', 'peach']);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const APPEARANCE_OPTIONS = Object.freeze({
  headAccessory: [
    ['none', '不戴头饰'], ['bow', '红色蝴蝶结'], ['flower', '小花'], ['leaf', '嫩叶'],
    ['cap', '小红帽'], ['crown', '迷你皇冠'], ['sleepcap', '睡帽'], ['carrot', '胡萝卜发卡'],
  ],
  neckAccessory: [
    ['none', '无颈饰'], ['scarf', '暖色围巾'], ['bell', '小铃铛'], ['bowtie', '小领结'], ['collar', '软软项圈'],
  ],
  backAccessory: [
    ['none', '无背饰'], ['mini-bag', '迷你挎包'], ['heart', '爱心背包'], ['cloud', '云朵背饰'], ['basket', '胡萝卜篮'],
  ],
  faceMark: [
    ['none', '自然脸'], ['blush', '粉色腮红'], ['patch', '小创可贴'], ['star', '星星贴纸'],
  ],
});

const HEAD_ACCESSORIES = optionSet('headAccessory');
const NECK_ACCESSORIES = optionSet('neckAccessory');
const BACK_ACCESSORIES = optionSet('backAccessory');
const FACE_MARKS = optionSet('faceMark');

const HEAD_ALIASES = new Map([
  ['red-bow', 'bow'], ['red_bow', 'bow'], ['ribbon', 'bow'],
  ['mini-crown', 'crown'], ['sleep-cap', 'sleepcap'], ['carrot-clip', 'carrot'],
]);
const NECK_ALIASES = new Map([
  ['neck-scarf', 'scarf'], ['bow-tie', 'bowtie'], ['soft-collar', 'collar'],
]);
const BACK_ALIASES = new Map([
  ['mini_bag', 'mini-bag'], ['heart-bag', 'heart'], ['cloud-back', 'cloud'], ['carrot-basket', 'basket'],
]);
const FACE_ALIASES = new Map([
  ['bandage', 'patch'], ['star-sticker', 'star'],
]);

function optionSet(key) {
  return new Set(APPEARANCE_OPTIONS[key].map(([value]) => value));
}

function publicConfig(config) {
  return {
    appVersion: config.appVersion,
    socketClientUrl: SOCKET_CLIENT_URL,
    appearanceOptions: APPEARANCE_OPTIONS,
    registrationCodeRequired: Boolean(config.registrationCode),
    registrationOpen: config.allowRegistration,
    maxPlayersPerHome: config.homeMaxPlayers,
  };
}

function publicUser(session) {
  return {
    id: session.user_id,
    username: session.username,
    displayName: session.display_name,
  };
}

function normalizedOption(rawValue, allowed, aliases) {
  const raw = sanitizeText(rawValue, 20);
  return aliases.get(raw) || raw;
}

function storedOption(rawValue, allowed, aliases) {
  const value = normalizedOption(rawValue, allowed, aliases);
  return allowed.has(value) ? value : 'none';
}

function storedAppearance(row) {
  const legacy = sanitizeText(row.accessory, 20);
  let headAccessory = storedOption(row.head_accessory, HEAD_ACCESSORIES, HEAD_ALIASES);
  let neckAccessory = storedOption(row.neck_accessory, NECK_ACCESSORIES, NECK_ALIASES);
  const backAccessory = storedOption(row.back_accessory, BACK_ACCESSORIES, BACK_ALIASES);
  const faceMark = storedOption(row.face_mark, FACE_MARKS, FACE_ALIASES);

  if (headAccessory === 'none' && legacy) {
    const legacyHead = normalizedOption(legacy, HEAD_ACCESSORIES, HEAD_ALIASES);
    const legacyNeck = normalizedOption(legacy, NECK_ACCESSORIES, NECK_ALIASES);
    if (HEAD_ACCESSORIES.has(legacyHead)) headAccessory = legacyHead;
    else if (neckAccessory === 'none' && NECK_ACCESSORIES.has(legacyNeck)) neckAccessory = legacyNeck;
  }

  return { headAccessory, neckAccessory, backAccessory, faceMark };
}

export function normalizeAppearancePayload(body = {}) {
  const legacyAccessory = sanitizeText(body.accessory, 20);
  let headRaw = sanitizeText(body.headAccessory, 20);
  let neckRaw = sanitizeText(body.neckAccessory, 20);
  const backRaw = sanitizeText(body.backAccessory, 20) || 'none';
  const faceRaw = sanitizeText(body.faceMark, 20) || 'none';

  if (!headRaw && legacyAccessory) {
    const legacyHead = normalizedOption(legacyAccessory, HEAD_ACCESSORIES, HEAD_ALIASES);
    const legacyNeck = normalizedOption(legacyAccessory, NECK_ACCESSORIES, NECK_ALIASES);
    if (HEAD_ACCESSORIES.has(legacyHead)) headRaw = legacyHead;
    else if (NECK_ACCESSORIES.has(legacyNeck)) {
      headRaw = 'none';
      if (!neckRaw) neckRaw = legacyNeck;
    } else {
      headRaw = legacyAccessory;
    }
  }

  const values = {
    headAccessory: normalizedOption(headRaw || 'none', HEAD_ACCESSORIES, HEAD_ALIASES),
    neckAccessory: normalizedOption(neckRaw || 'none', NECK_ACCESSORIES, NECK_ALIASES),
    backAccessory: normalizedOption(backRaw, BACK_ACCESSORIES, BACK_ALIASES),
    faceMark: normalizedOption(faceRaw, FACE_MARKS, FACE_ALIASES),
  };

  const invalid = [];
  if (!HEAD_ACCESSORIES.has(values.headAccessory)) invalid.push(`头饰=${values.headAccessory || '(空)'}`);
  if (!NECK_ACCESSORIES.has(values.neckAccessory)) invalid.push(`颈饰=${values.neckAccessory || '(空)'}`);
  if (!BACK_ACCESSORIES.has(values.backAccessory)) invalid.push(`背饰=${values.backAccessory || '(空)'}`);
  if (!FACE_MARKS.has(values.faceMark)) invalid.push(`面部贴纸=${values.faceMark || '(空)'}`);

  return invalid.length
    ? { ok: false, error: `配饰选项无效：${invalid.join('，')}`, invalid, values }
    : { ok: true, values };
}

export function publicAvatar(row) {
  if (!row) return null;
  const appearance = storedAppearance(row);
  const legacyAccessory = appearance.headAccessory !== 'none'
    ? appearance.headAccessory
    : appearance.neckAccessory !== 'none' ? appearance.neckAccessory : 'none';
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    variant: row.variant,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    eyeColor: row.eye_color,
    accessory: legacyAccessory,
    ...appearance,
    lastHomeId: row.last_home_id,
    x: row.last_x,
    y: row.last_y,
    stats: {
      hunger: row.hunger,
      cleanliness: row.cleanliness,
      mood: row.mood,
      energy: row.energy,
      bond: row.bond,
    },
  };
}

export function createAuthHelpers(db, config) {
  function readSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    return db.getSession(tokenHash(token, config.sessionSecret));
  }

  function requireAuth(req, res, next) {
    const session = readSession(req);
    if (!session || session.status !== 'ACTIVE') return res.status(401).json({ error: '请先登录' });
    req.auth = session;
    next();
  }

  function setSessionCookie(res, token) {
    const attributes = [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
    ];
    if (config.cookieSecure) attributes.push('Secure');
    res.setHeader('Set-Cookie', attributes.join('; '));
  }

  function clearSessionCookie(res) {
    const attributes = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (config.cookieSecure) attributes.push('Secure');
    res.setHeader('Set-Cookie', attributes.join('; '));
  }

  return { readSession, requireAuth, setSessionCookie, clearSessionCookie };
}

export function createApiRouter(db, config, auth) {
  const router = express.Router();
  const authLimiter = createRateLimiter({ windowMs: 10 * 60_000, limit: 30 });
  const registerLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 10 });

  router.get('/health', (_req, res) => res.json({
    ok: true,
    service: 'rabbit-home',
    version: config.appVersion,
    socketClientUrl: SOCKET_CLIENT_URL,
    time: new Date().toISOString(),
  }));
  router.get('/config', (_req, res) => res.json(publicConfig(config)));

  router.post('/auth/register', registerLimiter, async (req, res, next) => {
    try {
      if (!config.allowRegistration) return res.status(403).json({ error: '当前未开放注册' });
      const username = sanitizeText(req.body?.username, 24);
      const displayName = sanitizeText(req.body?.displayName, 18);
      const password = String(req.body?.password ?? '');
      const registrationCode = sanitizeText(req.body?.registrationCode, 64);
      if (config.registrationCode && registrationCode !== config.registrationCode) return res.status(403).json({ error: '注册码不正确' });
      if (!validUsername(username)) return res.status(400).json({ error: '用户名需为 3～24 位英文字母、数字或下划线' });
      if (displayName.length < 1) return res.status(400).json({ error: '昵称不能为空' });
      if (password.length < 8 || password.length > 128) return res.status(400).json({ error: '密码长度需为 8～128 位' });
      if (db.getUserByUsername(username)) return res.status(409).json({ error: '用户名已存在' });

      const passwordHash = await hashPassword(password);
      const user = db.createUser({ username, passwordHash, displayName });
      const token = randomToken();
      db.createSession(tokenHash(token, config.sessionSecret), user.id, Date.now() + SESSION_MAX_AGE_MS);
      auth.setSessionCookie(res, token);
      res.status(201).json({ user: { id: user.id, username: user.username, displayName: user.display_name }, avatar: null });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/login', authLimiter, async (req, res, next) => {
    try {
      const username = sanitizeText(req.body?.username, 24);
      const password = String(req.body?.password ?? '');
      const user = db.getUserByUsername(username);
      if (!user || !(await verifyPassword(password, user.password_hash)) || user.status !== 'ACTIVE') {
        return res.status(401).json({ error: '用户名或密码错误' });
      }
      const token = randomToken();
      db.createSession(tokenHash(token, config.sessionSecret), user.id, Date.now() + SESSION_MAX_AGE_MS);
      db.touchLogin(user.id);
      auth.setSessionCookie(res, token);
      res.json({
        user: { id: user.id, username: user.username, displayName: user.display_name },
        avatar: publicAvatar(db.getAvatarByUserId(user.id)),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) db.deleteSession(tokenHash(token, config.sessionSecret));
    auth.clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/bootstrap', auth.requireAuth, (req, res) => {
    const avatar = db.getAvatarByUserId(req.auth.user_id);
    res.json({
      user: publicUser(req.auth),
      avatar: publicAvatar(avatar),
      homes: db.listHomesForUser(req.auth.user_id).map(publicHome),
      config: publicConfig(config),
    });
  });

  router.put('/avatar', auth.requireAuth, (req, res) => {
    const role = req.body?.role === 'MAOMAO' ? 'MAOMAO' : req.body?.role === 'RABBIT' ? 'RABBIT' : '';
    const variant = sanitizeText(req.body?.variant, 20);
    const primaryColor = sanitizeText(req.body?.primaryColor, 7);
    const secondaryColor = sanitizeText(req.body?.secondaryColor, 7);
    const eyeColor = sanitizeText(req.body?.eyeColor, 7);
    const variants = role === 'RABBIT' ? RABBIT_VARIANTS : MAOMAO_VARIANTS;
    if (!role || !variants.has(variant)) return res.status(400).json({ error: '角色类型或形象无效' });
    if (![primaryColor, secondaryColor, eyeColor].every((color) => COLOR_RE.test(color))) return res.status(400).json({ error: '颜色格式无效' });

    const appearance = normalizeAppearancePayload(req.body);
    if (!appearance.ok) return res.status(400).json({
      error: appearance.error,
      invalidFields: appearance.invalid,
      appearanceOptions: APPEARANCE_OPTIONS,
    });

    const avatar = db.upsertAvatar(req.auth.user_id, {
      role, variant, primaryColor, secondaryColor, eyeColor,
      accessory: appearance.values.headAccessory,
      ...appearance.values,
    });
    res.json({ avatar: publicAvatar(avatar) });
  });

  router.get('/homes', auth.requireAuth, (req, res) => {
    res.json({ homes: db.listHomesForUser(req.auth.user_id).map(publicHome) });
  });

  router.post('/homes', auth.requireAuth, (req, res) => {
    if (!db.getAvatarByUserId(req.auth.user_id)) return res.status(400).json({ error: '请先创建角色' });
    const name = sanitizeText(req.body?.name, 24);
    if (name.length < 1) return res.status(400).json({ error: '小窝名称不能为空' });
    let inviteCode;
    do inviteCode = randomInviteCode(); while (db.getHomeByInvite(inviteCode));
    const home = db.createHome(req.auth.user_id, name, inviteCode);
    db.setLastHome(req.auth.user_id, home.id);
    res.status(201).json({ home: publicHome({ ...home, member_role: 'OWNER' }) });
  });

  router.post('/homes/join', auth.requireAuth, (req, res) => {
    if (!db.getAvatarByUserId(req.auth.user_id)) return res.status(400).json({ error: '请先创建角色' });
    const inviteCode = sanitizeText(req.body?.inviteCode, 12).toUpperCase();
    const home = db.getHomeByInvite(inviteCode);
    if (!home) return res.status(404).json({ error: '没有找到这个小窝，请检查邀请码' });
    db.addHomeMember(home.id, req.auth.user_id);
    db.setLastHome(req.auth.user_id, home.id);
    res.json({ home: publicHome({ ...home, member_role: home.owner_user_id === req.auth.user_id ? 'OWNER' : 'MEMBER' }) });
  });

  router.post('/homes/:homeId/enter', auth.requireAuth, (req, res) => {
    if (!db.isHomeMember(req.params.homeId, req.auth.user_id)) return res.status(403).json({ error: '你不是这个小窝的成员' });
    db.setLastHome(req.auth.user_id, req.params.homeId);
    res.status(204).end();
  });

  return router;
}

function publicHome(row) {
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    ownerUserId: row.owner_user_id,
    memberRole: row.member_role || 'MEMBER',
    createdAt: row.created_at,
  };
}

function randomInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

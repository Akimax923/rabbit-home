import crypto from 'node:crypto';
import express from 'express';
import { hashPassword, parseCookies, randomToken, sanitizeText, tokenHash, validUsername, verifyPassword, createRateLimiter } from './security.js';

const COOKIE_NAME = 'rabbit_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RABBIT_VARIANTS = new Set(['dwarf', 'lop', 'lion']);
const MAOMAO_VARIANTS = new Set(['cream', 'cloud', 'chestnut', 'peach']);
const HEAD_ACCESSORIES = new Set(['none', 'bow', 'flower', 'leaf', 'cap', 'crown', 'sleepcap', 'carrot']);
const NECK_ACCESSORIES = new Set(['none', 'scarf', 'bell', 'bowtie', 'collar']);
const BACK_ACCESSORIES = new Set(['none', 'mini-bag', 'heart', 'cloud', 'basket']);
const FACE_MARKS = new Set(['none', 'blush', 'patch', 'star']);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function publicUser(session) {
  return {
    id: session.user_id,
    username: session.username,
    displayName: session.display_name,
  };
}

export function publicAvatar(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    variant: row.variant,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    eyeColor: row.eye_color,
    accessory: row.head_accessory || row.accessory || 'none',
    headAccessory: row.head_accessory || row.accessory || 'none',
    neckAccessory: row.neck_accessory || 'none',
    backAccessory: row.back_accessory || 'none',
    faceMark: row.face_mark || 'none',
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

  router.get('/health', (_req, res) => res.json({ ok: true, service: 'rabbit-home', time: new Date().toISOString() }));
  router.get('/config', (_req, res) => res.json({ registrationCodeRequired: Boolean(config.registrationCode), registrationOpen: config.allowRegistration }));

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
      config: { maxPlayersPerHome: config.homeMaxPlayers, registrationCodeRequired: Boolean(config.registrationCode) },
    });
  });

  router.put('/avatar', auth.requireAuth, (req, res) => {
    const role = req.body?.role === 'MAOMAO' ? 'MAOMAO' : req.body?.role === 'RABBIT' ? 'RABBIT' : '';
    const variant = sanitizeText(req.body?.variant, 20);
    const primaryColor = sanitizeText(req.body?.primaryColor, 7);
    const secondaryColor = sanitizeText(req.body?.secondaryColor, 7);
    const eyeColor = sanitizeText(req.body?.eyeColor, 7);
    const headAccessory = sanitizeText(req.body?.headAccessory ?? req.body?.accessory, 20) || 'none';
    const neckAccessory = sanitizeText(req.body?.neckAccessory, 20) || 'none';
    const backAccessory = sanitizeText(req.body?.backAccessory, 20) || 'none';
    const faceMark = sanitizeText(req.body?.faceMark, 20) || 'none';
    const variants = role === 'RABBIT' ? RABBIT_VARIANTS : MAOMAO_VARIANTS;
    if (!role || !variants.has(variant)) return res.status(400).json({ error: '角色类型或形象无效' });
    if (![primaryColor, secondaryColor, eyeColor].every((color) => COLOR_RE.test(color))) return res.status(400).json({ error: '颜色格式无效' });
    if (!HEAD_ACCESSORIES.has(headAccessory) || !NECK_ACCESSORIES.has(neckAccessory) || !BACK_ACCESSORIES.has(backAccessory) || !FACE_MARKS.has(faceMark)) {
      return res.status(400).json({ error: '配饰选项无效' });
    }
    const avatar = db.upsertAvatar(req.auth.user_id, {
      role, variant, primaryColor, secondaryColor, eyeColor,
      accessory: headAccessory, headAccessory, neckAccessory, backAccessory, faceMark,
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

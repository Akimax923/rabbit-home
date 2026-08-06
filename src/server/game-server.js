import crypto from 'node:crypto';

const WORLD = { width: 960, height: 576, padding: 34 };
const PLAYER_RADIUS = 14;
const ROOM_PREFIX = 'home:';
const TICK_MS = 50;
const BROADCAST_MS = 100;
const REQUEST_TTL_MS = 60_000;
const REQUEST_COOLDOWN_MS = 30_000;
const CHAT_LIMIT = 80;
const CHAT_COOLDOWN_MS = 1200;
const CHAT_HISTORY_LIMIT = 40;

export const GAME_OBJECTS = {
  bed: { id: 'bed', type: 'BED', x: 168, y: 151, radius: 82 },
  sofa: { id: 'sofa', type: 'SOFA', x: 448, y: 161, radius: 98 },
  bookshelf: { id: 'bookshelf', type: 'BOOKSHELF', x: 690, y: 130, radius: 64 },
  rug: { id: 'rug', type: 'RUG', x: 456, y: 354, radius: 108 },
  food: { id: 'food', type: 'FOOD', x: 112, y: 462, radius: 62 },
  water: { id: 'water', type: 'WATER', x: 180, y: 462, radius: 58 },
  ball: { id: 'ball', type: 'BALL', x: 352, y: 450, radius: 58 },
  brush: { id: 'brush', type: 'BRUSH', x: 665, y: 449, radius: 74 },
  bath: { id: 'bath', type: 'BATH', x: 824, y: 445, radius: 90 },
};

const FURNITURE_ANCHORS = {
  bed: [{ x: 166, y: 168, exitX: 166, exitY: 214, direction: 'right', behavior: 'SLEEP' }],
  sofa: [
    { x: 405, y: 179, exitX: 405, exitY: 220, direction: 'down', behavior: 'SIT' },
    { x: 490, y: 179, exitX: 490, exitY: 220, direction: 'down', behavior: 'SIT' },
  ],
  rug: [
    { x: 410, y: 354, exitX: 410, exitY: 386, direction: 'down', behavior: 'SIT' },
    { x: 458, y: 372, exitX: 458, exitY: 404, direction: 'down', behavior: 'SIT' },
    { x: 505, y: 350, exitX: 505, exitY: 382, direction: 'down', behavior: 'SIT' },
  ],
};

const CARE_ANCHORS = {
  bath: {
    rabbit: { x: 824, y: 447, direction: 'down', behavior: 'BATH' },
    maomao: { x: 742, y: 447, direction: 'right', behavior: 'BRUSH' },
  },
  brush: {
    rabbit: { x: 665, y: 456, direction: 'down', behavior: 'BRUSH' },
    maomao: { x: 602, y: 456, direction: 'right', behavior: 'BRUSH' },
  },
};

const OBSTACLES = [
  { x: 80, y: 86, width: 180, height: 106 },
  { x: 338, y: 98, width: 218, height: 96 },
  { x: 629, y: 76, width: 128, height: 128 },
  { x: 70, y: 424, width: 140, height: 76 },
  { x: 615, y: 393, width: 104, height: 94 },
  { x: 748, y: 374, width: 151, height: 108 },
];

const ALLOWED_EMOTES = new Set(['hello', 'follow', 'thanks', 'happy', 'sleepy', 'hungry', 'bath', 'hug']);

export class GameServer {
  constructor({ io, db, config, auth }) {
    this.io = io;
    this.db = db;
    this.config = config;
    this.auth = auth;
    this.players = new Map();
    this.rooms = new Map();
    this.avatarSockets = new Map();
    this.requestCooldowns = new Map();
    this.chatCooldowns = new Map();
    this.chatHistory = new Map();
    this.occupancy = new Map();
    this.lastBroadcast = 0;
    this.configureSocketAuth();
    this.bindConnections();
    this.loop = setInterval(() => this.tick(), TICK_MS);
    this.loop.unref();
    this.expiryLoop = setInterval(() => db.expireRequests(), 5_000);
    this.expiryLoop.unref();
  }

  close() {
    clearInterval(this.loop);
    clearInterval(this.expiryLoop);
    for (const player of this.players.values()) this.persistPlayer(player);
  }

  configureSocketAuth() {
    this.io.use((socket, next) => {
      const session = this.auth.readSession({ headers: socket.handshake.headers });
      if (!session || session.status !== 'ACTIVE') return next(new Error('UNAUTHORIZED'));
      socket.data.auth = session;
      next();
    });
  }

  bindConnections() {
    this.io.on('connection', (socket) => {
      socket.on('home:join', (payload, ack = () => {}) => this.joinHome(socket, payload, ack));
      socket.on('player:input', (payload) => this.handleInput(socket, payload));
      socket.on('interaction:use', (payload, ack = () => {}) => this.handleInteraction(socket, payload, ack));
      socket.on('care-request:respond', (payload, ack = () => {}) => this.respondToCareRequest(socket, payload, ack));
      socket.on('care-action:start', (payload, ack = () => {}) => this.startCareAction(socket, payload, ack));
      socket.on('emote:send', (payload) => this.sendEmote(socket, payload));
      socket.on('chat:send', (payload, ack = () => {}) => this.sendChat(socket, payload, ack));
      socket.on('disconnect', () => this.removePlayer(socket.id));
    });
  }

  joinHome(socket, payload, ack) {
    try {
      const homeId = String(payload?.homeId || '');
      const userId = socket.data.auth.user_id;
      if (!this.db.isHomeMember(homeId, userId)) return ack({ ok: false, error: '你不是这个小窝的成员' });
      const avatar = this.db.getAvatarByUserId(userId);
      if (!avatar) return ack({ ok: false, error: '请先创建角色' });
      const home = this.db.getHome(homeId);
      if (!home) return ack({ ok: false, error: '小窝不存在' });

      const roomPlayers = this.getRoom(homeId);
      if (roomPlayers.size >= this.config.homeMaxPlayers) return ack({ ok: false, error: '这个小窝暂时坐满啦' });

      const previousSocketId = this.avatarSockets.get(avatar.id);
      if (previousSocketId && previousSocketId !== socket.id) {
        const previous = this.io.sockets.sockets.get(previousSocketId);
        previous?.emit('session:replaced');
        previous?.disconnect(true);
      }

      const spawn = this.safeSpawn(avatar.last_home_id === homeId ? avatar.last_x : 470, avatar.last_home_id === homeId ? avatar.last_y : 350);
      const player = {
        socketId: socket.id,
        homeId,
        avatarId: avatar.id,
        userId,
        displayName: socket.data.auth.display_name,
        role: avatar.role,
        variant: avatar.variant,
        primaryColor: avatar.primary_color,
        secondaryColor: avatar.secondary_color,
        eyeColor: avatar.eye_color,
        accessory: avatar.head_accessory || avatar.accessory || 'none',
        headAccessory: avatar.head_accessory || avatar.accessory || 'none',
        neckAccessory: avatar.neck_accessory || 'none',
        backAccessory: avatar.back_accessory || 'none',
        faceMark: avatar.face_mark || 'none',
        x: spawn.x,
        y: spawn.y,
        direction: 'down',
        moving: false,
        behavior: 'IDLE',
        furniture: null,
        input: emptyInput(0),
        stats: {
          hunger: avatar.hunger,
          cleanliness: avatar.cleanliness,
          mood: avatar.mood,
          energy: avatar.energy,
          bond: avatar.bond,
        },
        busy: false,
      };

      this.removePlayer(socket.id);
      this.players.set(socket.id, player);
      roomPlayers.set(socket.id, player);
      this.avatarSockets.set(avatar.id, socket.id);
      socket.join(ROOM_PREFIX + homeId);
      socket.data.homeId = homeId;
      this.db.setLastHome(userId, homeId);

      socket.emit('world:snapshot', {
        home: { id: home.id, name: home.name },
        selfId: avatar.id,
        world: WORLD,
        objects: Object.values(GAME_OBJECTS),
        players: Array.from(roomPlayers.values(), publicPlayer),
        openRequests: this.db.listOpenRequests(homeId).map(publicRequest),
        chatHistory: this.chatHistory.get(homeId) || [],
      });
      socket.to(ROOM_PREFIX + homeId).emit('player:joined', publicPlayer(player));
      ack({ ok: true });
    } catch (error) {
      console.error('joinHome error', error);
      ack({ ok: false, error: '进入小窝失败' });
    }
  }

  handleInput(socket, payload) {
    const player = this.players.get(socket.id);
    if (!player || player.busy) return;
    const sequence = Number.isInteger(payload?.sequence) ? payload.sequence : player.input.sequence + 1;
    if (sequence < player.input.sequence) return;
    const next = {
      sequence,
      up: payload?.up === true,
      down: payload?.down === true,
      left: payload?.left === true,
      right: payload?.right === true,
    };
    const wantsMove = next.up || next.down || next.left || next.right;
    if (wantsMove && (player.behavior === 'SIT' || player.behavior === 'SLEEP')) this.releaseFurniture(player);
    player.input = next;
  }

  handleInteraction(socket, payload, ack) {
    const player = this.players.get(socket.id);
    if (!player || player.busy) return ack({ ok: false, error: '当前不能互动' });
    const object = GAME_OBJECTS[String(payload?.objectId || '')];
    if (!object || distance(player, object) > object.radius) return ack({ ok: false, error: '请再靠近一点' });

    if (player.furniture?.objectId === object.id) {
      this.releaseFurniture(player);
      return ack({ ok: true, behavior: player.behavior });
    }

    if (object.type === 'FOOD') {
      if (player.role !== 'RABBIT') return ack({ ok: false, error: '食盆是给兔兔准备的' });
      this.applyStats(player, { hunger: 22, mood: 2 }, '吃到了脆脆的胡萝卜');
      this.emitEffect(player, object, 'eat');
      return ack({ ok: true });
    }
    if (object.type === 'WATER') {
      this.applyStats(player, { mood: 1, energy: 2 }, '喝了一口清清的小水');
      this.emitEffect(player, object, 'drink');
      return ack({ ok: true });
    }
    if (object.type === 'BED' || object.type === 'SOFA' || object.type === 'RUG') return this.useFurniture(player, object, ack);
    if (object.type === 'BOOKSHELF') {
      this.applyStats(player, { mood: 3 }, '翻了翻温暖的小绘本');
      this.emitEffect(player, object, 'read');
      return ack({ ok: true });
    }
    if (object.type === 'BALL') {
      this.applyStats(player, { mood: 4, energy: -1 }, '玩具球咕噜噜地滚了起来');
      this.emitEffect(player, object, 'play');
      return ack({ ok: true });
    }
    if (object.type === 'BATH' || object.type === 'BRUSH') {
      if (player.role !== 'RABBIT') return ack({ ok: false, error: '毛毛可以等待兔兔发起照料请求' });
      return this.createCareRequest(player, object, ack);
    }
    ack({ ok: false, error: '这个物品暂时不能互动' });
  }

  useFurniture(player, object, ack) {
    const anchors = FURNITURE_ANCHORS[object.id] || [];
    const index = anchors.findIndex((_, candidate) => !this.occupancy.has(occupancyKey(player.homeId, object.id, candidate)));
    if (index < 0) return ack({ ok: false, error: '这里已经坐满啦' });
    this.releaseFurniture(player);
    const anchor = anchors[index];
    const key = occupancyKey(player.homeId, object.id, index);
    this.occupancy.set(key, player.avatarId);
    player.furniture = { objectId: object.id, anchorIndex: index, occupancyKey: key };
    player.x = anchor.x;
    player.y = anchor.y;
    player.direction = anchor.direction;
    player.behavior = anchor.behavior;
    player.moving = false;
    player.input = emptyInput(player.input.sequence);
    const delta = object.type === 'BED' ? { energy: 18, mood: 2 } : { mood: object.type === 'SOFA' ? 5 : 3 };
    const message = object.type === 'BED' ? '躺进软软的小床休息' : object.type === 'SOFA' ? '舒舒服服地坐上沙发' : '坐在暖暖的地毯上';
    this.applyStats(player, delta, message);
    this.emitEffect(player, object, object.type === 'BED' ? 'sleep' : object.type === 'SOFA' ? 'rest' : 'rug');
    ack({ ok: true, behavior: player.behavior });
  }

  releaseFurniture(player) {
    if (player.furniture?.occupancyKey) this.occupancy.delete(player.furniture.occupancyKey);
    if (player.furniture) {
      const anchor = FURNITURE_ANCHORS[player.furniture.objectId]?.[player.furniture.anchorIndex];
      if (anchor) {
        player.x = anchor.exitX ?? player.x;
        player.y = anchor.exitY ?? player.y;
      }
    }
    player.furniture = null;
    if (!player.busy) player.behavior = 'IDLE';
  }

  createCareRequest(player, object, ack) {
    const cooldownKey = `${player.avatarId}:${object.type}`;
    const cooldownUntil = this.requestCooldowns.get(cooldownKey) || 0;
    if (cooldownUntil > Date.now()) return ack({ ok: false, error: `请等待 ${Math.ceil((cooldownUntil - Date.now()) / 1000)} 秒再请求` });
    const existing = this.db.listOpenRequests(player.homeId).find((request) => request.requester_avatar_id === player.avatarId && request.request_type === object.type);
    if (existing) return ack({ ok: false, error: '这个请求已经挂在任务板上啦' });

    const request = this.db.createInteractionRequest({
      homeId: player.homeId,
      requesterAvatarId: player.avatarId,
      requestType: object.type,
      objectId: object.id,
      expiresAt: Date.now() + REQUEST_TTL_MS,
    });
    this.requestCooldowns.set(cooldownKey, Date.now() + REQUEST_COOLDOWN_MS);
    const event = { ...publicRequest(request), requesterName: player.displayName };
    this.io.to(ROOM_PREFIX + player.homeId).emit('care-request:created', event);
    ack({ ok: true, request: event });
  }

  respondToCareRequest(socket, payload, ack) {
    const player = this.players.get(socket.id);
    if (!player || player.role !== 'MAOMAO') return ack({ ok: false, error: '只有毛毛可以接下照料请求' });
    if (String(payload?.response || '') !== 'accept') return ack({ ok: true });
    const request = this.db.getInteractionRequest(String(payload?.requestId || ''));
    if (!request || request.home_id !== player.homeId) return ack({ ok: false, error: '请求不存在' });
    const accepted = this.db.acceptInteractionRequest(request.id, player.avatarId);
    if (!accepted) return ack({ ok: false, error: '已经有其他毛毛接下这个任务了' });
    const event = { ...publicRequest(accepted), acceptedByName: player.displayName };
    this.io.to(ROOM_PREFIX + player.homeId).emit('care-request:accepted', event);
    ack({ ok: true, request: event });
  }

  startCareAction(socket, payload, ack) {
    const helper = this.players.get(socket.id);
    if (!helper || helper.role !== 'MAOMAO' || helper.busy) return ack({ ok: false, error: '当前不能开始照料' });
    const request = this.db.getInteractionRequest(String(payload?.requestId || ''));
    if (!request || request.home_id !== helper.homeId || request.accepted_by_avatar_id !== helper.avatarId || request.status !== 'ACCEPTED') {
      return ack({ ok: false, error: '任务状态已经变化' });
    }
    const object = GAME_OBJECTS[request.object_id];
    const requesterSocket = this.avatarSockets.get(request.requester_avatar_id);
    const requester = requesterSocket ? this.players.get(requesterSocket) : null;
    if (!requester) return ack({ ok: false, error: '兔兔现在不在小窝' });
    if (distance(helper, object) > object.radius || distance(requester, object) > object.radius) return ack({ ok: false, error: '需要兔兔和毛毛都来到互动区域' });
    if (!this.db.markRequestRunning(request.id)) return ack({ ok: false, error: '任务已经开始或失效' });

    this.releaseFurniture(helper);
    this.releaseFurniture(requester);
    const anchors = CARE_ANCHORS[request.object_id];
    const rabbitAnchor = anchors?.rabbit || { x: object.x, y: object.y, direction: 'down', behavior: request.request_type };
    const maomaoAnchor = anchors?.maomao || { x: object.x - 55, y: object.y, direction: 'right', behavior: 'BRUSH' };
    Object.assign(requester, { x: rabbitAnchor.x, y: rabbitAnchor.y, direction: rabbitAnchor.direction, behavior: rabbitAnchor.behavior, busy: true, moving: false });
    Object.assign(helper, { x: maomaoAnchor.x, y: maomaoAnchor.y, direction: maomaoAnchor.direction, behavior: maomaoAnchor.behavior, busy: true, moving: false });
    helper.input = emptyInput(helper.input.sequence);
    requester.input = emptyInput(requester.input.sequence);
    const durationMs = request.request_type === 'BATH' ? 4800 : 3900;
    this.io.to(ROOM_PREFIX + helper.homeId).emit('care-action:started', {
      requestId: request.id,
      requestType: request.request_type,
      helperAvatarId: helper.avatarId,
      requesterAvatarId: requester.avatarId,
      objectId: request.object_id,
      durationMs,
    });
    ack({ ok: true });

    setTimeout(() => {
      this.db.completeRequest(request.id);
      helper.busy = false; requester.busy = false;
      helper.behavior = 'IDLE'; requester.behavior = 'IDLE';
      const exitY = object.id === 'bath' ? 515 : 520;
      helper.x = object.x - 64; helper.y = exitY;
      requester.x = object.x; requester.y = exitY;
      const requesterDelta = request.request_type === 'BATH' ? { cleanliness: 35, mood: 6, bond: 3 } : { cleanliness: 10, mood: 12, bond: 4 };
      this.applyStats(requester, requesterDelta);
      this.applyStats(helper, { mood: 5, bond: request.request_type === 'BATH' ? 3 : 4 });
      this.io.to(ROOM_PREFIX + helper.homeId).emit('care-action:completed', {
        requestId: request.id,
        requestType: request.request_type,
        helperAvatarId: helper.avatarId,
        requesterAvatarId: requester.avatarId,
      });
    }, durationMs).unref?.();
  }

  sendEmote(socket, payload) {
    const player = this.players.get(socket.id);
    const emote = String(payload?.emote || '');
    if (!player || !ALLOWED_EMOTES.has(emote)) return;
    this.io.to(ROOM_PREFIX + player.homeId).emit('emote:shown', { avatarId: player.avatarId, emote, expiresIn: 3000 });
  }

  sendChat(socket, payload, ack) {
    const player = this.players.get(socket.id);
    if (!player) return ack({ ok: false, error: '请先进入小窝' });
    const text = sanitizeChat(payload?.text);
    if (!text) return ack({ ok: false, error: '消息不能为空' });
    const now = Date.now();
    const nextAllowed = this.chatCooldowns.get(player.avatarId) || 0;
    if (nextAllowed > now) return ack({ ok: false, error: '说话太快啦，请稍等一下' });
    this.chatCooldowns.set(player.avatarId, now + CHAT_COOLDOWN_MS);
    const message = {
      id: crypto.randomUUID(),
      homeId: player.homeId,
      avatarId: player.avatarId,
      displayName: player.displayName,
      role: player.role,
      text,
      createdAt: now,
    };
    const history = this.chatHistory.get(player.homeId) || [];
    history.push(message);
    if (history.length > CHAT_HISTORY_LIMIT) history.splice(0, history.length - CHAT_HISTORY_LIMIT);
    this.chatHistory.set(player.homeId, history);
    this.io.to(ROOM_PREFIX + player.homeId).emit('chat:message', message);
    ack({ ok: true, message });
  }

  tick() {
    const dt = TICK_MS / 1000;
    for (const player of this.players.values()) this.movePlayer(player, dt);
    const now = Date.now();
    if (now - this.lastBroadcast >= BROADCAST_MS) {
      this.lastBroadcast = now;
      for (const [homeId, players] of this.rooms) {
        this.io.to(ROOM_PREFIX + homeId).emit('world:state', { players: Array.from(players.values(), publicPlayer), serverTime: now });
      }
    }
  }

  movePlayer(player, dt) {
    if (player.busy || player.behavior === 'SIT' || player.behavior === 'SLEEP') { player.moving = false; return; }
    let dx = Number(player.input.right) - Number(player.input.left);
    let dy = Number(player.input.down) - Number(player.input.up);
    if (!dx && !dy) { player.moving = false; player.behavior = 'IDLE'; return; }
    const length = Math.hypot(dx, dy) || 1;
    dx /= length; dy /= length;
    const speed = player.role === 'RABBIT' ? 138 : 126;
    const nextX = player.x + dx * speed * dt;
    const nextY = player.y + dy * speed * dt;
    if (!collides(nextX, player.y)) player.x = nextX;
    if (!collides(player.x, nextY)) player.y = nextY;
    player.moving = true;
    player.behavior = 'WALK';
    if (Math.abs(dx) > Math.abs(dy)) player.direction = dx > 0 ? 'right' : 'left';
    else player.direction = dy > 0 ? 'down' : 'up';
  }

  applyStats(player, delta, message) {
    const stats = this.db.updateStats(player.avatarId, delta);
    if (!stats) return;
    player.stats = stats;
    const socket = this.io.sockets.sockets.get(player.socketId);
    socket?.emit('stats:updated', { stats, message });
  }

  emitEffect(player, object, effect) {
    this.io.to(ROOM_PREFIX + player.homeId).emit('interaction:effect', { avatarId: player.avatarId, objectId: object.id, effect });
  }

  getRoom(homeId) {
    let room = this.rooms.get(homeId);
    if (!room) { room = new Map(); this.rooms.set(homeId, room); }
    return room;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;
    this.releaseFurniture(player);
    this.persistPlayer(player);
    this.players.delete(socketId);
    this.rooms.get(player.homeId)?.delete(socketId);
    if (this.rooms.get(player.homeId)?.size === 0) this.rooms.delete(player.homeId);
    if (this.avatarSockets.get(player.avatarId) === socketId) this.avatarSockets.delete(player.avatarId);
    this.io.to(ROOM_PREFIX + player.homeId).emit('player:left', { avatarId: player.avatarId });
  }

  persistPlayer(player) { this.db.saveAvatarPosition(player.avatarId, player.homeId, Math.round(player.x), Math.round(player.y)); }

  safeSpawn(x, y) {
    const nx = Number.isFinite(x) ? x : 470;
    const ny = Number.isFinite(y) ? y : 350;
    if (!collides(nx, ny)) return { x: nx, y: ny };
    return { x: 470, y: 350 };
  }
}

function publicPlayer(player) {
  return {
    avatarId: player.avatarId,
    displayName: player.displayName,
    role: player.role,
    variant: player.variant,
    primaryColor: player.primaryColor,
    secondaryColor: player.secondaryColor,
    eyeColor: player.eyeColor,
    accessory: player.headAccessory,
    headAccessory: player.headAccessory,
    neckAccessory: player.neckAccessory,
    backAccessory: player.backAccessory,
    faceMark: player.faceMark,
    x: Math.round(player.x * 10) / 10,
    y: Math.round(player.y * 10) / 10,
    direction: player.direction,
    moving: player.moving,
    behavior: player.behavior,
    busy: player.busy,
    furniture: player.furniture ? { objectId: player.furniture.objectId, anchorIndex: player.furniture.anchorIndex } : null,
    stats: player.stats,
  };
}

function publicRequest(request) {
  return {
    id: request.id,
    homeId: request.home_id,
    requesterAvatarId: request.requester_avatar_id,
    acceptedByAvatarId: request.accepted_by_avatar_id,
    requestType: request.request_type,
    status: request.status,
    objectId: request.object_id,
    createdAt: request.created_at,
    expiresAt: request.expires_at,
    requesterName: request.requester_name,
  };
}

function sanitizeChat(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, CHAT_LIMIT);
}
function occupancyKey(homeId, objectId, index) { return `${homeId}:${objectId}:${index}`; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function emptyInput(sequence) { return { up: false, down: false, left: false, right: false, sequence }; }
function collides(x, y) {
  if (x < WORLD.padding || y < WORLD.padding || x > WORLD.width - WORLD.padding || y > WORLD.height - WORLD.padding) return true;
  return OBSTACLES.some((rect) => x + PLAYER_RADIUS > rect.x && x - PLAYER_RADIUS < rect.x + rect.width && y + PLAYER_RADIUS > rect.y && y - PLAYER_RADIUS < rect.y + rect.height);
}

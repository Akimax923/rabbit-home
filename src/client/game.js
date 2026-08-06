import { drawPixelAvatar } from './avatar-preview.js';

export const OBJECT_LABELS = {
  food: '胡萝卜食盆', water: '小水碗', bed: '软软小床', sofa: '奶油沙发',
  rug: '中央地毯', bath: '泡泡澡盆', brush: '梳毛台', ball: '玩具球', bookshelf: '小书架',
};

const WORLD = { width: 960, height: 576 };
const OBJECTS = {
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

const EMOTE_TEXT = {
  hello: '你好呀', follow: '跟我来', thanks: '谢谢', happy: '开心！',
  sleepy: '困困', hungry: '饿啦', bath: '想洗澡', hug: '抱抱',
};

export class PixelHomeGame {
  constructor({ parent, socket, avatar, callbacks = {} }) {
    this.parent = typeof parent === 'string' ? document.getElementById(parent) : parent;
    this.socket = socket;
    this.avatar = avatar;
    this.callbacks = callbacks;
    this.canvas = null;
    this.ctx = null;
    this.running = false;
    this.frameId = 0;
    this.lastTime = 0;
    this.players = new Map();
    this.selfId = null;
    this.homeId = null;
    this.keys = { up: false, down: false, left: false, right: false };
    this.sequence = 0;
    this.lastInputSent = 0;
    this.activeTask = null;
    this.promptObject = null;
    this.speech = new Map();
    this.emotes = new Map();
    this.effects = [];
    this.particles = [];
    this.unsubscribers = [];
    this.boundResize = () => this.resize();
    this.boundKeyDown = (event) => this.onKey(event, true);
    this.boundKeyUp = (event) => this.onKey(event, false);
  }

  create() {
    if (!this.parent) throw new Error('找不到游戏画布容器');
    this.parent.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.width = WORLD.width;
    this.canvas.height = WORLD.height;
    this.canvas.className = 'pixel-game-canvas';
    this.canvas.setAttribute('aria-label', '兔兔与毛毛的小窝游戏画面');
    this.parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    window.addEventListener('resize', this.boundResize);
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    this.bindMobileControls();
    this.bindSocket();
    this.resize();
    this.running = true;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame((time) => this.loop(time));
  }

  join(homeId) {
    this.homeId = homeId;
    return new Promise((resolve, reject) => {
      this.socket.emit('home:join', { homeId }, (result) => {
        if (!result?.ok) reject(new Error(result?.error || '进入小窝失败'));
        else resolve(result);
      });
    });
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.parent?.querySelectorAll('[data-game-control]').forEach((node) => node.replaceWith(node.cloneNode(true)));
    this.players.clear();
    this.speech.clear();
    this.emotes.clear();
    this.effects = [];
    this.particles = [];
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }

  sendEmote(emote) { this.socket?.emit('emote:send', { emote }); }
  sendChat(text) {
    return new Promise((resolve) => {
      this.socket?.emit('chat:send', { text }, (result) => resolve(result || { ok: false, error: '发送失败' }));
    });
  }
  setActiveTask(request) { this.activeTask = request || null; this.callbacks.onTaskChanged?.(this.activeTask); }

  bindSocket() {
    const on = (event, handler) => {
      this.socket.on(event, handler);
      this.unsubscribers.push(() => this.socket.off(event, handler));
    };

    on('connect', () => this.callbacks.onConnection?.(true));
    on('disconnect', () => this.callbacks.onConnection?.(false));
    on('connect_error', (error) => this.callbacks.onFatal?.(error.message === 'UNAUTHORIZED' ? '登录已经失效，请重新登录' : '无法连接到小窝服务器'));
    on('session:replaced', () => this.callbacks.onFatal?.('这个角色已经在另一个页面进入小窝'));

    on('world:snapshot', (snapshot) => {
      this.selfId = snapshot.selfId;
      this.players.clear();
      for (const player of snapshot.players || []) this.upsertPlayer(player, true);
      this.callbacks.onSnapshot?.(snapshot);
      this.callbacks.onOnlineCount?.(this.players.size);
      for (const message of snapshot.chatHistory || []) this.receiveChat(message, false);
    });
    on('world:state', ({ players = [] }) => {
      const present = new Set();
      for (const player of players) { present.add(player.avatarId); this.upsertPlayer(player, false); }
      for (const id of this.players.keys()) if (!present.has(id)) this.players.delete(id);
      this.callbacks.onOnlineCount?.(this.players.size);
    });
    on('player:joined', (player) => { this.upsertPlayer(player, true); this.callbacks.onOnlineCount?.(this.players.size); this.callbacks.onSystemMessage?.(`${player.displayName} 来到小窝`); });
    on('player:left', ({ avatarId }) => { const name = this.players.get(avatarId)?.displayName; this.players.delete(avatarId); this.callbacks.onOnlineCount?.(this.players.size); if (name) this.callbacks.onSystemMessage?.(`${name} 离开了小窝`); });
    on('stats:updated', ({ stats, message }) => { this.callbacks.onStats?.(stats); if (message) this.callbacks.onToast?.(message); });
    on('interaction:effect', (event) => this.addEffect(event));
    on('emote:shown', ({ avatarId, emote, expiresIn }) => this.emotes.set(avatarId, { text: EMOTE_TEXT[emote] || emote, expiresAt: Date.now() + (expiresIn || 3000) }));
    on('chat:message', (message) => this.receiveChat(message, true));
    on('care-request:created', (request) => this.callbacks.onCareRequest?.(request));
    on('care-request:accepted', (request) => this.callbacks.onCareAccepted?.(request));
    on('care-request:expired', (request) => { if (this.activeTask?.id === request.id) this.setActiveTask(null); this.callbacks.onToast?.('照料请求已经过期'); });
    on('care-action:started', (event) => { this.callbacks.onCareStarted?.(event); this.spawnCareParticles(event); });
    on('care-action:completed', (event) => { if (this.activeTask?.id === event.requestId) this.setActiveTask(null); this.callbacks.onCareCompleted?.(event); });
  }

  upsertPlayer(data, snap) {
    const current = this.players.get(data.avatarId);
    if (!current) {
      this.players.set(data.avatarId, {
        ...data,
        renderX: data.x,
        renderY: data.y,
        targetX: data.x,
        targetY: data.y,
      });
      return;
    }
    Object.assign(current, data);
    current.targetX = data.x;
    current.targetY = data.y;
    if (snap || Math.hypot(current.renderX - data.x, current.renderY - data.y) > 150) {
      current.renderX = data.x;
      current.renderY = data.y;
    }
  }

  receiveChat(message, notify) {
    if (!message?.avatarId || !message?.text) return;
    this.speech.set(message.avatarId, { text: message.text, expiresAt: Date.now() + 6200 });
    this.callbacks.onChatMessage?.(message, notify);
  }

  bindMobileControls() {
    document.querySelectorAll('[data-game-control]').forEach((button) => {
      const control = button.dataset.gameControl;
      const update = (pressed) => {
        if (control === 'interact' && pressed) this.interact();
        else if (control in this.keys) { this.keys[control] = pressed; this.sendInput(true); }
      };
      button.addEventListener('pointerdown', (event) => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); update(true); });
      button.addEventListener('pointerup', () => update(false));
      button.addEventListener('pointercancel', () => update(false));
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });
  }

  onKey(event, pressed) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    const map = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
    const control = map[event.code];
    if (control) {
      event.preventDefault();
      if (this.keys[control] !== pressed) { this.keys[control] = pressed; this.sendInput(true); }
      return;
    }
    if (pressed && !event.repeat && (event.code === 'KeyE' || event.code === 'Space')) {
      event.preventDefault();
      this.interact();
    }
  }

  sendInput(force = false) {
    const now = performance.now();
    if (!force && now - this.lastInputSent < 75) return;
    this.lastInputSent = now;
    this.sequence += 1;
    this.socket?.emit('player:input', { sequence: this.sequence, ...this.keys });
  }

  interact() {
    const self = this.players.get(this.selfId);
    if (!self) return;
    if (this.activeTask && self.role === 'MAOMAO') {
      this.socket.emit('care-action:start', { requestId: this.activeTask.id }, (result) => {
        if (!result?.ok) this.callbacks.onToast?.(result?.error || '暂时不能开始照料');
      });
      return;
    }
    const object = this.promptObject;
    if (!object) return this.callbacks.onToast?.('靠近家具或用品后再按 E');
    this.socket.emit('interaction:use', { objectId: object.id }, (result) => {
      if (!result?.ok) this.callbacks.onToast?.(result?.error || '暂时不能互动');
      if (result?.request) this.callbacks.onToast?.('请求已经送到毛毛的任务板');
    });
  }

  loop(time) {
    if (!this.running) return;
    const dt = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.update(dt, time);
    this.render(time);
    this.frameId = requestAnimationFrame((next) => this.loop(next));
  }

  update(dt, time) {
    this.sendInput(false);
    for (const player of this.players.values()) {
      const blend = player.avatarId === this.selfId ? 0.28 : 0.16;
      player.renderX += (player.targetX - player.renderX) * Math.min(1, blend * dt * 60);
      player.renderY += (player.targetY - player.renderY) * Math.min(1, blend * dt * 60);
    }
    const now = Date.now();
    for (const [id, bubble] of this.speech) if (bubble.expiresAt <= now) this.speech.delete(id);
    for (const [id, bubble] of this.emotes) if (bubble.expiresAt <= now) this.emotes.delete(id);
    this.effects = this.effects.filter((effect) => effect.expiresAt > now);
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= p.kind === 'bubble' ? 4 * dt : 0; }
    this.updatePrompt();
  }

  updatePrompt() {
    const self = this.players.get(this.selfId);
    if (!self) return;
    let nearest = null;
    let best = Infinity;
    for (const object of Object.values(OBJECTS)) {
      const distance = Math.hypot(self.renderX - object.x, self.renderY - object.y);
      if (distance <= object.radius && distance < best) { best = distance; nearest = object; }
    }
    this.promptObject = nearest;
    let text = '';
    if (this.activeTask && self.role === 'MAOMAO') text = `按 E 在${OBJECT_LABELS[this.activeTask.objectId] || '互动地点'}开始照料`;
    else if (nearest) text = interactionPrompt(nearest, self);
    this.callbacks.onPrompt?.(text);
  }

  render(time) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    drawRoom(ctx, time);
    this.drawInteractionGlow(ctx, time);

    const ordered = [...this.players.values()].sort((a, b) => a.renderY - b.renderY);
    for (const player of ordered) this.drawPlayer(ctx, player, time);
    drawFrontFurniture(ctx, time);
    this.drawEffects(ctx, time);
    this.drawBubbles(ctx);
  }

  drawPlayer(ctx, player, time) {
    drawPixelAvatar(ctx, player, player.renderX, player.renderY, {
      scale: 1.75,
      behavior: player.behavior || (player.moving ? 'WALK' : 'IDLE'),
      direction: player.direction,
      moving: player.moving,
      selected: player.avatarId === this.selfId,
      time,
    });
    const name = player.displayName || '小伙伴';
    ctx.save();
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = Math.ceil(ctx.measureText(name).width) + 12;
    const y = player.renderY - 62;
    roundedPixelPanel(ctx, player.renderX - width / 2, y - 8, width, 17, '#fff8e9', '#6a3932');
    ctx.fillStyle = '#5a302d';
    ctx.fillText(name, player.renderX, y + 1);
    ctx.restore();
  }

  drawBubbles(ctx) {
    for (const [avatarId, speech] of this.speech) {
      const player = this.players.get(avatarId);
      if (player) drawSpeechBubble(ctx, player.renderX, player.renderY - 86, speech.text);
    }
    for (const [avatarId, emote] of this.emotes) {
      if (this.speech.has(avatarId)) continue;
      const player = this.players.get(avatarId);
      if (player) drawSpeechBubble(ctx, player.renderX, player.renderY - 86, emote.text);
    }
  }

  drawInteractionGlow(ctx, time) {
    if (!this.promptObject) return;
    const pulse = 0.45 + Math.sin(time / 220) * 0.12;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ffd866';
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.ellipse(this.promptObject.x, this.promptObject.y, 30, 14, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  addEffect({ avatarId, objectId, effect }) {
    const player = this.players.get(avatarId);
    const object = OBJECTS[objectId];
    if (!player || !object) return;
    this.effects.push({ avatarId, objectId, effect, x: object.x, y: object.y, expiresAt: Date.now() + 2200 });
    if (effect === 'play') {
      for (let i = 0; i < 8; i++) this.particles.push({ kind: 'star', x: object.x, y: object.y - 10, vx: (Math.random() - .5) * 80, vy: -30 - Math.random() * 50, life: .8 + Math.random() * .5 });
    }
  }

  spawnCareParticles(event) {
    const object = OBJECTS[event.objectId];
    if (!object) return;
    const count = event.requestType === 'BATH' ? 34 : 22;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        kind: event.requestType === 'BATH' ? 'bubble' : 'spark',
        x: object.x + (Math.random() - .5) * 70,
        y: object.y - 10 + (Math.random() - .5) * 40,
        vx: (Math.random() - .5) * 24,
        vy: event.requestType === 'BATH' ? -20 - Math.random() * 35 : -12 - Math.random() * 20,
        life: 2.4 + Math.random() * 2,
      });
    }
  }

  drawEffects(ctx, time) {
    for (const effect of this.effects) {
      const age = 1 - (effect.expiresAt - Date.now()) / 2200;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - age);
      ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#7b4a3d';
      const labels = { eat: '咔嚓！', drink: '咕噜～', sleep: 'Zzz', rest: '好舒服', play: '咕噜噜', read: '翻翻书', rug: '暖呼呼' };
      ctx.fillText(labels[effect.effect] || '✨', effect.x, effect.y - 45 - age * 18);
      ctx.restore();
    }
    for (const p of this.particles) {
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life);
      if (p.kind === 'bubble') { ctx.strokeStyle = '#d9f6ff'; ctx.fillStyle = 'rgba(224,249,255,.45)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 3 + (p.life % 1) * 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      else { ctx.fillStyle = p.kind === 'spark' ? '#ffe47a' : '#ffca68'; ctx.fillRect(Math.round(p.x), Math.round(p.y), 5, 5); }
      ctx.restore();
    }
  }

  resize() {
    if (!this.canvas || !this.parent) return;
    const ratio = Math.min(this.parent.clientWidth / WORLD.width, this.parent.clientHeight / WORLD.height || 1);
    this.canvas.style.width = `${Math.floor(WORLD.width * ratio)}px`;
    this.canvas.style.height = `${Math.floor(WORLD.height * ratio)}px`;
  }
}

function interactionPrompt(object, player) {
  const prefix = '按 E ';
  if (object.type === 'FOOD') return player.role === 'RABBIT' ? `${prefix}吃胡萝卜` : '这是兔兔的小食盆';
  if (object.type === 'WATER') return `${prefix}喝水`;
  if (object.type === 'BED') return player.behavior === 'SLEEP' ? `${prefix}起床` : `${prefix}躺到床上`;
  if (object.type === 'SOFA') return player.behavior === 'SIT' ? `${prefix}从沙发起身` : `${prefix}坐上沙发`;
  if (object.type === 'RUG') return player.behavior === 'SIT' ? `${prefix}站起来` : `${prefix}坐在地毯上`;
  if (object.type === 'BALL') return `${prefix}玩小球`;
  if (object.type === 'BOOKSHELF') return `${prefix}翻一翻绘本`;
  if (object.type === 'BATH') return player.role === 'RABBIT' ? `${prefix}请求毛毛帮忙洗澡` : '等待兔兔发起洗澡请求';
  if (object.type === 'BRUSH') return player.role === 'RABBIT' ? `${prefix}请求毛毛帮忙梳毛` : '等待兔兔发起梳毛请求';
  return `${prefix}互动`;
}

function drawRoom(ctx, time) {
  // floor
  ctx.fillStyle = '#f4dec1'; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  for (let y = 64; y < WORLD.height; y += 32) {
    for (let x = 32; x < WORLD.width; x += 32) {
      ctx.fillStyle = ((x + y) / 32) % 2 ? '#efd4b3' : '#f5dfc3';
      ctx.fillRect(x, y, 32, 32);
      ctx.fillStyle = 'rgba(118,72,55,.045)'; ctx.fillRect(x, y + 30, 32, 2);
    }
  }
  // wall
  ctx.fillStyle = '#dca980'; ctx.fillRect(0, 0, WORLD.width, 69);
  ctx.fillStyle = '#f8e8d2'; ctx.fillRect(12, 12, WORLD.width - 24, 50);
  ctx.fillStyle = '#a76552'; ctx.fillRect(0, 62, WORLD.width, 8);
  drawWindow(ctx, 738, 17, time);
  drawGarland(ctx);

  // zones and rugs
  drawRug(ctx, 343, 286, 224, 142);
  drawSmallRug(ctx, 91, 410, 129, 92, '#d6b8a0');
  drawSmallRug(ctx, 609, 389, 286, 131, '#c7d7bc');

  drawBed(ctx, 86, 92);
  drawSofa(ctx, 346, 104);
  drawBookshelf(ctx, 637, 82);
  drawFoodArea(ctx, 77, 430);
  drawBall(ctx, 352, 450, time);
  drawBrushStation(ctx, 622, 401);
  drawBath(ctx, 756, 383);
  drawPlants(ctx);
}

function drawFrontFurniture(ctx, time) {
  // sofa front lip makes sitting characters appear seated in the cushions
  ctx.fillStyle = '#925e52'; ctx.fillRect(362, 178, 172, 12);
  ctx.fillStyle = '#c78372'; ctx.fillRect(369, 178, 158, 7);
  // bed blanket front
  ctx.fillStyle = '#b77d82'; ctx.fillRect(96, 171, 147, 18);
  ctx.fillStyle = '#df9fa2'; ctx.fillRect(101, 171, 137, 11);
  // bath front
  ctx.fillStyle = '#735d58'; ctx.fillRect(765, 456, 126, 18);
  ctx.fillStyle = '#d5e7df'; ctx.fillRect(770, 449, 116, 20);
  ctx.fillStyle = '#a8cec6'; ctx.fillRect(777, 463, 102, 8);
}

function drawBed(ctx, x, y) {
  ctx.fillStyle = '#72483f'; ctx.fillRect(x, y + 18, 166, 82);
  ctx.fillStyle = '#f7e5ca'; ctx.fillRect(x + 8, y + 8, 150, 76);
  ctx.fillStyle = '#d88e94'; ctx.fillRect(x + 12, y + 28, 142, 52);
  ctx.fillStyle = '#f4c5b9'; ctx.fillRect(x + 18, y + 15, 48, 26);
  ctx.fillStyle = '#fff1dc'; ctx.fillRect(x + 22, y + 18, 40, 18);
  ctx.fillStyle = '#905d4d'; ctx.fillRect(x - 6, y, 9, 103); ctx.fillRect(x + 163, y, 9, 103);
  ctx.fillStyle = '#f4b8aa'; ctx.fillRect(x + 88, y + 34, 48, 7);
}

function drawSofa(ctx, x, y) {
  ctx.fillStyle = '#765046'; ctx.fillRect(x, y + 14, 202, 74);
  ctx.fillStyle = '#cc8d79'; ctx.fillRect(x + 9, y, 184, 75);
  ctx.fillStyle = '#e2aa91'; ctx.fillRect(x + 17, y + 8, 82, 42); ctx.fillRect(x + 103, y + 8, 82, 42);
  ctx.fillStyle = '#f2c2a4'; ctx.fillRect(x + 26, y + 15, 65, 27); ctx.fillRect(x + 112, y + 15, 65, 27);
  ctx.fillStyle = '#a86d61'; ctx.fillRect(x - 8, y + 24, 20, 61); ctx.fillRect(x + 190, y + 24, 20, 61);
  ctx.fillStyle = '#75504a'; ctx.fillRect(x + 14, y + 81, 16, 10); ctx.fillRect(x + 173, y + 81, 16, 10);
}

function drawBookshelf(ctx, x, y) {
  ctx.fillStyle = '#674238'; ctx.fillRect(x, y, 112, 116);
  ctx.fillStyle = '#a96c48'; ctx.fillRect(x + 7, y + 6, 98, 103);
  ctx.fillStyle = '#70463a'; ctx.fillRect(x + 11, y + 37, 90, 6); ctx.fillRect(x + 11, y + 72, 90, 6);
  const colors = ['#d66c62', '#739d88', '#e3b35d', '#7c78a8', '#e7977e'];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) { ctx.fillStyle = colors[(row + i) % colors.length]; ctx.fillRect(x + 14 + i * 14, y + 12 + row * 35, 9, 22); }
  ctx.fillStyle = '#e9d7b9'; ctx.fillRect(x + 35, y + 83, 38, 20); ctx.fillStyle = '#5c423d'; ctx.fillRect(x + 51, y + 89, 7, 7);
}

function drawFoodArea(ctx, x, y) {
  ctx.fillStyle = '#8c604b'; ctx.fillRect(x, y + 30, 66, 18); ctx.fillStyle = '#cf8e59'; ctx.fillRect(x + 6, y + 25, 54, 17);
  ctx.fillStyle = '#ef8a32'; ctx.fillRect(x + 15, y + 14, 11, 20); ctx.fillRect(x + 31, y + 11, 10, 22); ctx.fillRect(x + 45, y + 16, 9, 18);
  ctx.fillStyle = '#69a45e'; ctx.fillRect(x + 15, y + 6, 12, 10); ctx.fillRect(x + 33, y + 4, 10, 9); ctx.fillRect(x + 47, y + 9, 10, 9);
  ctx.fillStyle = '#c98761'; ctx.fillRect(x + 4, y + 50, 58, 13); ctx.fillStyle = '#f4c18e'; ctx.fillRect(x + 10, y + 52, 46, 7);
  // water bowl
  ctx.fillStyle = '#6b7c8b'; ctx.fillRect(x + 74, y + 47, 52, 17); ctx.fillStyle = '#b8dbea'; ctx.fillRect(x + 80, y + 48, 40, 8);
}

function drawBrushStation(ctx, x, y) {
  ctx.fillStyle = '#795147'; ctx.fillRect(x, y + 17, 88, 63);
  ctx.fillStyle = '#d2a775'; ctx.fillRect(x + 7, y + 9, 74, 58);
  ctx.fillStyle = '#f0d5a7'; ctx.fillRect(x + 13, y + 15, 62, 40);
  ctx.fillStyle = '#a96955'; ctx.fillRect(x + 19, y - 5, 9, 35); ctx.fillStyle = '#e2b764'; ctx.fillRect(x + 12, y - 7, 23, 11);
  ctx.fillStyle = '#b77f55'; ctx.fillRect(x + 55, y - 1, 8, 31); ctx.fillStyle = '#f3c98e'; ctx.fillRect(x + 48, y - 5, 22, 10);
  ctx.fillStyle = '#8a5c50'; ctx.fillRect(x + 13, y + 69, 12, 12); ctx.fillRect(x + 64, y + 69, 12, 12);
}

function drawBath(ctx, x, y) {
  ctx.fillStyle = '#6e5a55'; ctx.fillRect(x + 4, y + 26, 130, 66);
  ctx.fillStyle = '#b7d8d0'; ctx.fillRect(x + 8, y + 15, 122, 64);
  ctx.fillStyle = '#d8eee6'; ctx.fillRect(x + 15, y + 10, 108, 53);
  ctx.fillStyle = '#9dc9c2'; ctx.fillRect(x + 18, y + 22, 102, 34);
  ctx.fillStyle = '#e9fbf7'; ctx.fillRect(x + 25, y + 17, 88, 12);
  ctx.fillStyle = '#82604d'; ctx.fillRect(x + 109, y - 10, 8, 30); ctx.fillRect(x + 105, y - 10, 19, 7);
  ctx.fillStyle = '#f4faf8'; ctx.fillRect(x + 18, y + 6, 12, 12); ctx.fillRect(x + 35, y + 2, 16, 16); ctx.fillRect(x + 103, y + 5, 12, 12);
}

function drawRug(ctx, x, y, w, h) {
  ctx.fillStyle = '#a96b62'; ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
  ctx.fillStyle = '#e7b6a5'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f4d4be'; ctx.fillRect(x + 10, y + 10, w - 20, h - 20);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#d9988b' : '#edc0a9'; ctx.fillRect(x + 20 + i * 31, y + 60, 18, 18); }
}
function drawSmallRug(ctx, x, y, w, h, color) { ctx.fillStyle = '#9b6d61'; ctx.fillRect(x - 4, y - 4, w + 8, h + 8); ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
function drawBall(ctx, x, y, time) { const bob = Math.sin(time / 300) * 2; ctx.fillStyle = '#5a3835'; ctx.fillRect(x - 15, y - 15 + bob, 30, 30); ctx.fillStyle = '#e7a544'; ctx.fillRect(x - 12, y - 12 + bob, 24, 24); ctx.fillStyle = '#d95f55'; ctx.fillRect(x - 12, y - 2 + bob, 24, 7); ctx.fillStyle = '#f5d47b'; ctx.fillRect(x - 4, y - 12 + bob, 8, 24); }
function drawWindow(ctx, x, y, time) { ctx.fillStyle = '#80564c'; ctx.fillRect(x, y, 142, 52); ctx.fillStyle = '#bfe2e4'; ctx.fillRect(x + 7, y + 7, 128, 38); ctx.fillStyle = '#eaf8f4'; ctx.fillRect(x + 12, y + 10, 52, 11); ctx.fillStyle = '#80564c'; ctx.fillRect(x + 68, y + 6, 6, 40); ctx.fillStyle = '#f4cf6a'; ctx.fillRect(x + 110 + Math.sin(time / 1000) * 2, y + 13, 12, 12); }
function drawGarland(ctx) { const colors = ['#d55c58', '#e8b354', '#70a884', '#8d79ad']; for (let i = 0; i < 10; i++) { ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(250 + i * 36, 18 + (i % 2) * 5, 15, 15); } }
function drawPlants(ctx) { ctx.fillStyle = '#9f664c'; ctx.fillRect(894, 96, 42, 42); ctx.fillStyle = '#5e9b5e'; ctx.fillRect(902, 65, 9, 35); ctx.fillRect(916, 58, 9, 43); ctx.fillRect(929, 70, 7, 28); ctx.fillStyle = '#74b66e'; ctx.fillRect(894, 68, 20, 10); ctx.fillRect(916, 55, 18, 10); }

function roundedPixelPanel(ctx, x, y, w, h, fill, stroke) { ctx.fillStyle = stroke; ctx.fillRect(Math.round(x + 3), Math.round(y), Math.round(w - 6), Math.round(h)); ctx.fillRect(Math.round(x), Math.round(y + 3), Math.round(w), Math.round(h - 6)); ctx.fillStyle = fill; ctx.fillRect(Math.round(x + 4), Math.round(y + 2), Math.round(w - 8), Math.round(h - 4)); ctx.fillRect(Math.round(x + 2), Math.round(y + 4), Math.round(w - 4), Math.round(h - 8)); }
function drawSpeechBubble(ctx, x, y, text) { const safe = String(text).slice(0, 34); ctx.save(); ctx.font = '13px "Courier New", monospace'; const width = Math.min(240, Math.ceil(ctx.measureText(safe).width) + 20); roundedPixelPanel(ctx, x - width / 2, y - 14, width, 29, '#fffdf2', '#633832'); ctx.fillStyle = '#633832'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(safe, x, y); ctx.fillRect(Math.round(x - 3), Math.round(y + 15), 7, 6); ctx.restore(); }

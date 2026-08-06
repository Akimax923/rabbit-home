import { APPEARANCE_OPTIONS, drawPixelAvatar, renderAvatarPreview } from './avatar-preview.js';
import { OBJECT_LABELS, PixelHomeGame } from './game.js';

const CLIENT_VERSION = document.querySelector('meta[name="rabbit-home-version"]')?.content || 'unknown';
const state = { user: null, avatar: null, homes: [], currentHome: null, socket: null, game: null, config: {} };
let socketClientLoadPromise = null;
const screens = ['loading', 'auth', 'avatar', 'lobby', 'game'];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const VARIANTS = {
  RABBIT: [
    { value: 'dwarf', label: '侏儒兔 · 圆圆短耳' },
    { value: 'lop', label: '垂耳兔 · 软软垂耳' },
    { value: 'lion', label: '狮子兔 · 蓬松脸颊' },
  ],
  MAOMAO: [
    { value: 'cream', label: '奶油毛毛 · 温暖米白' },
    { value: 'cloud', label: '云朵毛毛 · 轻轻软软' },
    { value: 'chestnut', label: '栗子毛毛 · 暖棕小叶' },
    { value: 'peach', label: '桃桃毛毛 · 淡粉花瓣' },
  ],
};

let creatorRole = 'RABBIT';
let currentModalRequest = null;

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
    ...options,
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}

function showScreen(name) {
  for (const screen of screens) $(`#${screen}-screen`)?.classList.toggle('hidden', screen !== name);
  $('#account-bar')?.classList.toggle('hidden', !state.user || name === 'auth' || name === 'loading');
  if (state.user && $('#account-name')) $('#account-name').textContent = state.user.displayName;
}

function toast(message, duration = 3400) {
  if (!message || !$('#toast-layer')) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  $('#toast-layer').append(node);
  setTimeout(() => node.remove(), duration);
}

function showModal({ title, message, actions }) {
  $('#modal-title').textContent = title;
  $('#modal-message').textContent = message;
  const area = $('#modal-actions');
  area.innerHTML = '';
  for (const action of actions) {
    const button = document.createElement('button');
    button.className = `pixel-button ${action.kind || 'ghost'}`;
    button.textContent = action.label;
    button.addEventListener('click', action.onClick);
    area.append(button);
  }
  $('#modal-layer').classList.remove('hidden');
}
function closeModal() { currentModalRequest = null; $('#modal-layer')?.classList.add('hidden'); }

function resolveForm(event) {
  if (event?.currentTarget instanceof HTMLFormElement) return event.currentTarget;
  if (event?.target instanceof HTMLFormElement) return event.target;
  if (event?.target instanceof Element) return event.target.closest('form');
  return null;
}
function safeResetForm(form) { if (form instanceof HTMLFormElement) form.reset(); }

async function bootstrap() {
  try {
    state.config = await api('/config');
    assertCompatibleVersion(state.config);
  } catch (error) {
    if (/版本不一致/.test(error.message)) throw error;
    state.config = {};
  }
  $('#registration-code-field')?.classList.toggle('hidden', !state.config.registrationCodeRequired);
  try {
    const data = await api('/bootstrap');
    state.user = data.user;
    state.avatar = data.avatar;
    state.homes = data.homes || [];
    state.config = { ...state.config, ...(data.config || {}) };
    if (!state.avatar) showCreator(); else showLobby();
  } catch (error) {
    showScreen('auth');
    if (!/登录/.test(error.message)) toast(error.message);
  }
}

function switchAuthTab(tab) {
  $$('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  $('#login-form')?.classList.toggle('hidden', tab !== 'login');
  $('#register-form')?.classList.toggle('hidden', tab !== 'register');
}

async function submitAuth(form, endpoint) {
  if (!(form instanceof HTMLFormElement)) return toast('找不到登录表单');
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const data = await api(endpoint, { method: 'POST', body: JSON.stringify(values) });
    state.user = data.user;
    state.avatar = data.avatar;
    safeResetForm(form);
    if (!state.avatar) showCreator();
    else {
      const boot = await api('/bootstrap');
      state.homes = boot.homes || [];
      showLobby();
    }
  } catch (error) { toast(error.message); }
  finally { if (button) button.disabled = false; }
}

function assertCompatibleVersion(serverConfig = {}) {
  if (!serverConfig.appVersion || CLIENT_VERSION === 'unknown') return;
  if (serverConfig.appVersion !== CLIENT_VERSION) {
    throw new Error(`前后端版本不一致：页面 ${CLIENT_VERSION}，服务端 ${serverConfig.appVersion}。请重新部署并强制刷新。`);
  }
}

function appearanceOptions() {
  return state.config.appearanceOptions || APPEARANCE_OPTIONS;
}

function setSelectValue(select, requestedValue, fallback = 'none') {
  if (!select) return;
  const value = String(requestedValue || fallback);
  const available = Array.from(select.options).some((option) => option.value === value);
  select.value = available ? value : fallback;
}

async function ensureSocketIoClient() {
  if (typeof window.io === 'function') return window.io;
  if (!socketClientLoadPromise) {
    const baseUrl = state.config.socketClientUrl || '/vendor/socket.io.min.js';
    const separator = baseUrl.includes('?') ? '&' : '?';
    const version = encodeURIComponent(state.config.appVersion || CLIENT_VERSION || 'current');
    const source = `${baseUrl}${separator}v=${version}`;

    socketClientLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.async = true;
      script.dataset.rabbitSocketClient = 'dynamic';
      script.addEventListener('load', () => {
        if (typeof window.io === 'function') resolve(window.io);
        else reject(new Error(`Socket.IO 客户端文件已返回，但没有注册 window.io：${baseUrl}`));
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Socket.IO 客户端加载失败：${baseUrl}`)), { once: true });
      document.head.append(script);
    }).catch((error) => {
      socketClientLoadPromise = null;
      throw error;
    });
  }
  return socketClientLoadPromise;
}

function showCreator() {
  creatorRole = state.avatar?.role || 'RABBIT';
  showScreen('avatar');
  $$('.role-option').forEach((button) => button.classList.toggle('active', button.dataset.role === creatorRole));
  fillCreatorForm();
}

function fillSelect(select, options) {
  if (!select) return;
  select.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
}

function fillCreatorForm() {
  const existing = state.avatar?.role === creatorRole ? state.avatar : defaultAvatar(creatorRole);
  const form = $('#avatar-form');
  if (!(form instanceof HTMLFormElement)) return;
  $('#variant-select').innerHTML = VARIANTS[creatorRole].map((item) => `<option value="${item.value}">${item.label}</option>`).join('');
  const options = appearanceOptions();
  fillSelect($('#head-accessory-select'), options.headAccessory || APPEARANCE_OPTIONS.headAccessory);
  fillSelect($('#neck-accessory-select'), options.neckAccessory || APPEARANCE_OPTIONS.neckAccessory);
  fillSelect($('#back-accessory-select'), options.backAccessory || APPEARANCE_OPTIONS.backAccessory);
  fillSelect($('#face-mark-select'), options.faceMark || APPEARANCE_OPTIONS.faceMark);
  form.elements.variant.value = existing.variant;
  form.elements.primaryColor.value = existing.primaryColor;
  form.elements.secondaryColor.value = existing.secondaryColor;
  form.elements.eyeColor.value = existing.eyeColor;
  setSelectValue(form.elements.headAccessory, existing.headAccessory || existing.accessory, 'none');
  setSelectValue(form.elements.neckAccessory, existing.neckAccessory, 'none');
  setSelectValue(form.elements.backAccessory, existing.backAccessory, 'none');
  setSelectValue(form.elements.faceMark, existing.faceMark, 'none');
  updateCreatorPreview();
}

function creatorValues() {
  const form = $('#avatar-form');
  return form instanceof HTMLFormElement ? Object.fromEntries(new FormData(form)) : defaultAvatar(creatorRole);
}
function updateCreatorPreview() { renderAvatarPreview($('#avatar-preview'), { ...creatorValues(), role: creatorRole }); }

function defaultAvatar(role) {
  return role === 'RABBIT'
    ? { role, variant: 'lop', primaryColor: '#f7eee2', secondaryColor: '#d99f7f', eyeColor: '#342a2a', headAccessory: 'bow', neckAccessory: 'none', backAccessory: 'none', faceMark: 'blush' }
    : { role, variant: 'cream', primaryColor: '#f4ead8', secondaryColor: '#d8be96', eyeColor: '#342a2a', headAccessory: 'leaf', neckAccessory: 'scarf', backAccessory: 'none', faceMark: 'none' };
}

async function saveAvatar(event) {
  event.preventDefault();
  const form = resolveForm(event);
  if (!form) return toast('找不到角色表单');
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const payload = { ...values, accessory: values.headAccessory || 'none', role: creatorRole };
    const data = await api('/avatar', { method: 'PUT', body: JSON.stringify(payload) });
    state.avatar = data.avatar;
    const boot = await api('/bootstrap');
    state.homes = boot.homes || [];
    toast('角色与配饰已经保存');
    showLobby();
  } catch (error) { toast(error.message); }
  finally { if (button) button.disabled = false; }
}

function showLobby() {
  showScreen('lobby');
  renderAvatarPreview($('#lobby-avatar'), state.avatar);
  $('#lobby-name').textContent = state.user?.displayName || '';
  $('#lobby-role').textContent = state.avatar?.role === 'RABBIT' ? `兔兔 · ${variantLabel(state.avatar)}` : `毛毛 · ${variantLabel(state.avatar)}`;
  renderHomes();
}

function renderHomes() {
  const list = $('#homes-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.homes.length) {
    list.innerHTML = '<div class="empty-state">你还没有加入小窝。<br>创建一个，或向朋友索取邀请码。</div>';
    return;
  }
  for (const home of state.homes) {
    const item = document.createElement('div');
    item.className = 'home-item';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = home.name;
    const detail = document.createElement('span'); detail.textContent = `邀请码 ${home.inviteCode} · ${home.memberRole === 'OWNER' ? '创建者' : '成员'}`;
    info.append(title, detail);
    const button = document.createElement('button');
    button.className = 'pixel-button primary small';
    button.type = 'button';
    button.textContent = '进入';
    button.addEventListener('click', () => enterHome(home));
    item.append(info, button);
    list.append(item);
  }
}

async function createHome(event) {
  event.preventDefault();
  const form = resolveForm(event);
  if (!form) return toast('找不到创建小窝表单');
  const values = Object.fromEntries(new FormData(form));
  try {
    const data = await api('/homes', { method: 'POST', body: JSON.stringify(values) });
    state.homes.unshift(data.home);
    safeResetForm(form);
    renderHomes();
    toast(`小窝已创建，邀请码：${data.home.inviteCode}`, 6500);
  } catch (error) { toast(error.message); }
}

async function joinHome(event) {
  event.preventDefault();
  const form = resolveForm(event);
  if (!form) return toast('找不到加入小窝表单');
  const values = Object.fromEntries(new FormData(form));
  try {
    const data = await api('/homes/join', { method: 'POST', body: JSON.stringify(values) });
    if (!state.homes.some((home) => home.id === data.home.id)) state.homes.unshift(data.home);
    safeResetForm(form);
    renderHomes();
    toast(`已经加入「${data.home.name}」`);
  } catch (error) { toast(error.message); }
}

async function enterHome(home) {
  try {
    await api(`/homes/${home.id}/enter`, { method: 'POST' });
    const ioFactory = await ensureSocketIoClient();
    state.currentHome = home;
    showScreen('game');
    $('#game-home-name').textContent = home.name;
    $('#hud-name').textContent = state.user.displayName;
    renderHudAvatar();
    updateStats(state.avatar.stats);
    $('#task-panel').classList.add('hidden');
    $('#chat-messages').innerHTML = '';
    addSystemMessage(`欢迎来到「${home.name}」`);

    state.socket = ioFactory({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
    state.game = new PixelHomeGame({
      parent: 'game-canvas', socket: state.socket, avatar: state.avatar,
      callbacks: {
        onSnapshot: (snapshot) => {
          $('#game-home-name').textContent = snapshot.home.name;
          for (const request of snapshot.openRequests || []) if (request.acceptedByAvatarId === state.avatar.id) state.game.setActiveTask(request);
        },
        onOnlineCount: (count) => { $('#online-count').textContent = `${count} 人在线`; },
        onStats: (stats) => { state.avatar.stats = stats; updateStats(stats); },
        onPrompt: updatePrompt,
        onToast: toast,
        onCareRequest: showCareRequest,
        onCareAccepted: careAccepted,
        onCareStarted: (data) => { addSystemMessage(data.requestType === 'BATH' ? '泡泡澡开始啦' : '开始轻轻梳毛啦'); toast(data.requestType === 'BATH' ? '泡泡正在飞起来' : '轻轻慢慢地梳毛'); },
        onCareCompleted: (data) => { addSystemMessage(data.requestType === 'BATH' ? '兔兔洗得干干净净' : '兔毛变得蓬蓬松松'); toast('互动完成，亲密度提升'); },
        onTaskChanged: updateTask,
        onConnection: (connected) => { $('#chat-status').textContent = connected ? '在线' : '重连中'; if (!connected) toast('与小窝的连接断开，正在尝试重连…'); },
        onFatal: (message) => { toast(message); leaveGame(); },
        onChatMessage: renderChatMessage,
        onSystemMessage: addSystemMessage,
      },
    });
    state.game.create();
    await state.game.join(home.id);
  } catch (error) { toast(error.message); leaveGame(); }
}

function renderHudAvatar() {
  const canvas = $('#hud-avatar');
  if (!canvas || !state.avatar) return;
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#f5dcc0'; ctx.fillRect(0, 0, 64, 64);
  drawPixelAvatar(ctx, state.avatar, 32, 56, { scale: 1.65, behavior: 'IDLE', direction: 'down', time: performance.now() });
}

function showCareRequest(request) {
  if (state.avatar?.role !== 'MAOMAO' || request.status !== 'PENDING' || request.requesterAvatarId === state.avatar.id) return;
  if (currentModalRequest?.id === request.id) return;
  currentModalRequest = request;
  const typeText = request.requestType === 'BATH' ? '洗澡' : '梳毛';
  showModal({
    title: request.requestType === 'BATH' ? '🛁 兔兔想洗澡' : '🪮 兔兔想梳毛',
    message: `${request.requesterName || '一只兔兔'} 发来了${typeText}请求。接下后，请走到${OBJECT_LABELS[request.objectId] || '互动地点'}，等兔兔也到达后按 E。`,
    actions: [
      { label: '稍后', kind: 'ghost', onClick: closeModal },
      { label: '去帮忙', kind: 'primary', onClick: () => acceptCareRequest(request) },
    ],
  });
}

function acceptCareRequest(request) {
  state.socket?.emit('care-request:respond', { requestId: request.id, response: 'accept' }, (result) => {
    if (!result?.ok) toast(result?.error || '没有接到任务');
    else { state.game?.setActiveTask(result.request); toast('任务已接下，请前往互动地点'); addSystemMessage('你接下了一项照料任务'); }
    closeModal();
  });
}
function careAccepted(request) {
  if (currentModalRequest?.id === request.id) closeModal();
  if (request.acceptedByAvatarId === state.avatar.id) toast('你接下了照料任务');
  else toast(`${request.acceptedByName || '另一位毛毛'} 接下了照料任务`);
}
function updateTask(request) {
  const panel = $('#task-panel');
  if (!request) { panel.classList.add('hidden'); panel.textContent = ''; return; }
  panel.classList.remove('hidden');
  panel.textContent = `当前任务：前往${OBJECT_LABELS[request.objectId] || '互动地点'}帮助兔兔${request.requestType === 'BATH' ? '洗澡' : '梳毛'}。双方到达后按 E。`;
}
function updatePrompt(text) { const node = $('#interaction-prompt'); node.textContent = text; node.classList.toggle('hidden', !text); }
function updateStats(stats = {}) { for (const key of ['hunger', 'cleanliness', 'mood', 'energy', 'bond']) if ($(`#stat-${key}`)) $(`#stat-${key}`).value = stats[key] ?? 0; }

function renderChatMessage(message) {
  const list = $('#chat-messages');
  if (!list || !message) return;
  const node = document.createElement('div');
  node.className = `chat-message${message.avatarId === state.avatar?.id ? ' self' : ''}`;
  const name = document.createElement('strong'); name.textContent = message.displayName || '小伙伴';
  const time = document.createElement('time'); time.textContent = formatTime(message.createdAt);
  const body = document.createElement('div'); body.textContent = message.text;
  node.append(name, time, body);
  list.append(node);
  while (list.children.length > 80) list.firstElementChild?.remove();
  list.scrollTop = list.scrollHeight;
}
function addSystemMessage(text) {
  const list = $('#chat-messages');
  if (!list || !text) return;
  const node = document.createElement('div');
  node.className = 'chat-message system';
  node.textContent = `系统 · ${text}`;
  list.append(node);
  list.scrollTop = list.scrollHeight;
}
function formatTime(value) { const date = value ? new Date(value) : new Date(); return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

async function sendChat(event) {
  event.preventDefault();
  const form = resolveForm(event);
  const input = $('#chat-input');
  if (!form || !input || !state.game) return;
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  const result = await state.game.sendChat(text);
  input.disabled = false;
  input.focus();
  if (!result?.ok) return toast(result?.error || '消息发送失败');
  input.value = '';
}

function leaveGame() {
  closeModal();
  state.game?.destroy(); state.game = null;
  state.socket?.disconnect(); state.socket = null;
  state.currentHome = null;
  $('#game-canvas').innerHTML = '';
  showLobby();
}
async function logout() {
  if (state.game || state.socket) leaveGame();
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  state.user = null; state.avatar = null; state.homes = [];
  showScreen('auth');
}
function variantLabel(avatar) { return VARIANTS[avatar.role]?.find((item) => item.value === avatar.variant)?.label.split(' · ')[0] || avatar.variant; }

function bindEvents() {
  $$('.tab').forEach((button) => button.addEventListener('click', () => switchAuthTab(button.dataset.tab)));
  $('#login-form')?.addEventListener('submit', (event) => { event.preventDefault(); submitAuth(resolveForm(event), '/auth/login'); });
  $('#register-form')?.addEventListener('submit', (event) => { event.preventDefault(); submitAuth(resolveForm(event), '/auth/register'); });
  $$('.role-option').forEach((button) => button.addEventListener('click', () => { creatorRole = button.dataset.role; $$('.role-option').forEach((item) => item.classList.toggle('active', item === button)); fillCreatorForm(); }));
  $('#avatar-form')?.addEventListener('input', updateCreatorPreview);
  $('#avatar-form')?.addEventListener('submit', saveAvatar);
  $('#edit-avatar-btn')?.addEventListener('click', showCreator);
  $('#create-home-form')?.addEventListener('submit', createHome);
  $('#join-home-form')?.addEventListener('submit', joinHome);
  $('#chat-form')?.addEventListener('submit', sendChat);
  $('#leave-game-btn')?.addEventListener('click', leaveGame);
  $('#logout-btn')?.addEventListener('click', logout);
  $('#copy-invite-btn')?.addEventListener('click', async () => {
    const code = state.currentHome?.inviteCode; if (!code) return;
    try { await navigator.clipboard.writeText(code); toast(`邀请码 ${code} 已复制`); } catch { toast(`邀请码：${code}`); }
  });
  $$('[data-emote]').forEach((button) => button.addEventListener('click', () => state.game?.sendEmote(button.dataset.emote)));
  window.addEventListener('beforeunload', () => state.socket?.disconnect());
}

bindEvents();
bootstrap().catch((error) => {
  console.error('[rabbit-home] bootstrap failed', error);
  showScreen('auth');
  toast(`页面初始化失败：${error?.message || '未知错误'}`, 10000);
});

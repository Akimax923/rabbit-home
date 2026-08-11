const BASE_TITLE = '兔兔与毛毛的小窝';
const HISTORY_BATCH = 24;
const CHAT_DOM_LIMIT = 120;
const NEAR_BOTTOM_PX = 56;

const $ = (selector) => document.querySelector(selector);

injectSocialControls();
injectSocialStyles();

const chatList = $('#chat-messages');
const socialPanel = document.querySelector('.social-panel');
const collapseButton = $('#chat-collapse-btn');
const loadEarlierButton = $('#chat-load-earlier');
const newMessagesButton = $('#chat-new-messages');
const notificationButton = $('#notification-toggle-btn');
const modalLayer = $('#modal-layer');

let visibleLimit = HISTORY_BATCH;
let unreadCount = 0;
let nearBottom = true;
let lastKnownScrollTop = 0;
let suppressNotificationsUntil = Date.now() + 1200;
let lastCareSignature = '';
let lastCareAt = 0;

function injectSocialControls() {
  const panel = document.querySelector('.social-panel');
  const header = panel?.querySelector('.chat-header');
  const list = panel?.querySelector('#chat-messages');
  if (!panel || !header || !list) return;

  if (!$('#chat-toolbar')) {
    const toolbar = document.createElement('div');
    toolbar.id = 'chat-toolbar';
    toolbar.className = 'chat-toolbar';

    const notification = document.createElement('button');
    notification.id = 'notification-toggle-btn';
    notification.className = 'pixel-button ghost tiny';
    notification.type = 'button';
    notification.textContent = '🔔 开启后台提醒';

    const collapse = document.createElement('button');
    collapse.id = 'chat-collapse-btn';
    collapse.className = 'pixel-button ghost tiny';
    collapse.type = 'button';
    collapse.setAttribute('aria-expanded', 'true');
    collapse.textContent = '收起聊天';

    toolbar.append(notification, collapse);
    header.append(toolbar);
  }

  if (!$('#chat-load-earlier')) {
    const earlier = document.createElement('button');
    earlier.id = 'chat-load-earlier';
    earlier.className = 'chat-edge-action hidden';
    earlier.type = 'button';
    earlier.textContent = '↑ 查看更早消息';
    list.before(earlier);
  }

  if (!$('#chat-new-messages')) {
    const newer = document.createElement('button');
    newer.id = 'chat-new-messages';
    newer.className = 'chat-edge-action new hidden';
    newer.type = 'button';
    newer.textContent = '↓ 新消息';
    list.after(newer);
  }
}

function injectSocialStyles() {
  if ($('#rabbit-social-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'rabbit-social-ui-styles';
  style.textContent = `
    @media (min-width: 981px) {
      #game-screen:not(.hidden) { height: calc(100vh - 72px); min-height: 560px; overflow: hidden; }
      #game-screen:not(.hidden) .game-layout { height: calc(100vh - 177px); min-height: 0; }
      #game-screen:not(.hidden) .game-column,
      #game-screen:not(.hidden) .social-panel { min-height: 0; height: 100%; }
      #game-screen:not(.hidden) .game-canvas-wrap { min-height: 0; }
    }
    .social-panel { overflow: hidden; }
    .chat-header { align-items: center; }
    .chat-toolbar { display: flex; justify-content: flex-end; align-items: center; gap: 5px; flex-wrap: wrap; margin-left: auto; }
    .pixel-button.tiny { padding: 5px 7px; font-size: 10px; box-shadow: 2px 2px 0 rgba(89,49,46,.2); }
    .chat-messages { min-height: 0; max-height: 100%; overflow-y: auto !important; overscroll-behavior: contain; scrollbar-gutter: stable; }
    .chat-history-hidden { display: none !important; }
    .chat-edge-action { width: 100%; border: 2px dashed #a77666; background: #f7e8d2; color: #7c5148; padding: 6px 8px; font: inherit; font-size: 10px; cursor: pointer; }
    .chat-edge-action.new { background: #fff0c2; border-style: solid; font-weight: bold; }
    .social-panel.chat-collapsed { grid-template-rows: auto auto auto; align-content: start; }
    .social-panel.chat-collapsed #chat-messages,
    .social-panel.chat-collapsed #chat-load-earlier,
    .social-panel.chat-collapsed #chat-new-messages,
    .social-panel.chat-collapsed #chat-form { display: none !important; }
    #notification-toggle-btn[data-state="granted"] { background: #e4eddd; }
    #notification-toggle-btn[data-state="insecure"],
    #notification-toggle-btn[data-state="unsupported"],
    #notification-toggle-btn[data-state="denied"] { opacity: .72; }
    @media (max-width: 980px) {
      .social-panel { max-height: 560px; }
      .chat-messages { max-height: 300px; min-height: 180px; }
    }
  `;
  document.head.append(style);
}

function messages() {
  return chatList ? Array.from(chatList.children).filter((node) => node.classList?.contains('chat-message')) : [];
}

function isNearBottom() {
  if (!chatList) return true;
  return chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight <= NEAR_BOTTOM_PX;
}

function updateUnreadUi() {
  if (newMessagesButton) {
    newMessagesButton.classList.toggle('hidden', unreadCount === 0);
    newMessagesButton.textContent = unreadCount > 0 ? `↓ ${unreadCount} 条新消息` : '↓ 新消息';
  }
  document.title = document.hidden && unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
}

function clearUnread() {
  unreadCount = 0;
  updateUnreadUi();
}

function markUnread(count = 1) {
  unreadCount += count;
  updateUnreadUi();
}

function refreshHistoryVisibility() {
  const nodes = messages();
  const hiddenCount = Math.max(0, nodes.length - visibleLimit);
  nodes.forEach((node, index) => node.classList.toggle('chat-history-hidden', index < hiddenCount));
  if (loadEarlierButton) {
    loadEarlierButton.classList.toggle('hidden', hiddenCount === 0);
    loadEarlierButton.textContent = hiddenCount > 0 ? `↑ 查看更早消息（还有 ${hiddenCount} 条）` : '↑ 已到最早消息';
  }
}

function trimChatDom() {
  if (!chatList) return;
  const nodes = messages();
  const removeCount = Math.max(0, nodes.length - CHAT_DOM_LIMIT);
  for (let i = 0; i < removeCount; i += 1) nodes[i]?.remove();
}

function scrollChatToBottom() {
  if (!chatList) return;
  visibleLimit = HISTORY_BATCH;
  refreshHistoryVisibility();
  requestAnimationFrame(() => {
    chatList.scrollTop = chatList.scrollHeight;
    lastKnownScrollTop = chatList.scrollTop;
    nearBottom = true;
    clearUnread();
  });
}

function showToast(message, duration = 4200) {
  const layer = $('#toast-layer');
  if (!layer || !message) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  layer.append(node);
  setTimeout(() => node.remove(), duration);
}

function notificationAvailable() {
  return 'Notification' in window && window.isSecureContext;
}

function syncNotificationButton() {
  if (!notificationButton) return;
  if (!('Notification' in window)) {
    notificationButton.textContent = '系统提醒不可用';
    notificationButton.dataset.state = 'unsupported';
    return;
  }
  if (!window.isSecureContext) {
    notificationButton.textContent = '后台提醒需 HTTPS';
    notificationButton.dataset.state = 'insecure';
    notificationButton.title = '浏览器只允许 HTTPS 页面发送系统通知；HTTP 下仍显示标签页未读数量';
    return;
  }
  const permission = Notification.permission;
  notificationButton.dataset.state = permission;
  notificationButton.textContent = permission === 'granted'
    ? '🔔 后台提醒已开'
    : permission === 'denied'
      ? '🔕 后台提醒已关闭'
      : '🔔 开启后台提醒';
}

async function requestNotifications() {
  if (!('Notification' in window)) return showToast('当前浏览器不支持系统通知');
  if (!window.isSecureContext) {
    return showToast('系统后台提醒受浏览器安全策略限制，需要 HTTPS。当前 HTTP 下会使用标签页未读数量和返回时汇总提醒。', 7000);
  }
  if (Notification.permission === 'denied') {
    return showToast('通知权限已被浏览器关闭，请在网站权限设置中重新允许。', 6500);
  }
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    syncNotificationButton();
    if (permission !== 'granted') return showToast('没有开启系统通知，仍会使用标签页未读提醒。');
  }
  syncNotificationButton();
  showToast('后台提醒已开启。切到其他标签页后，新聊天和照料请求会轻轻提醒你。');
}

function showSystemNotification(title, body, tag) {
  if (!document.hidden || !notificationAvailable() || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(title, {
      body,
      tag,
      renotify: false,
      silent: true,
    });
    notification.addEventListener('click', () => {
      window.focus();
      notification.close();
    });
    setTimeout(() => notification.close(), 6500);
  } catch (error) {
    console.warn('[rabbit-home] background notification failed', error);
  }
}

function describeChatMessage(node) {
  if (!(node instanceof HTMLElement) || node.classList.contains('self') || node.classList.contains('system')) return null;
  const sender = node.querySelector('strong')?.textContent?.trim() || '小伙伴';
  const body = node.querySelector('div')?.textContent?.trim() || '';
  return body ? { sender, body } : null;
}

function onChatMutations(mutations) {
  if (!chatList) return;
  const shouldStick = nearBottom;
  const previousScrollTop = lastKnownScrollTop;
  const added = [];
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement && node.classList.contains('chat-message')) added.push(node);
    }
  }
  if (!added.length) return;

  trimChatDom();
  refreshHistoryVisibility();

  if (shouldStick) {
    requestAnimationFrame(() => {
      chatList.scrollTop = chatList.scrollHeight;
      lastKnownScrollTop = chatList.scrollTop;
      nearBottom = true;
    });
  } else {
    requestAnimationFrame(() => {
      chatList.scrollTop = previousScrollTop;
      lastKnownScrollTop = previousScrollTop;
    });
  }

  if (Date.now() < suppressNotificationsUntil) return;
  for (const node of added) {
    const message = describeChatMessage(node);
    if (!message) continue;
    if (document.hidden || !shouldStick) markUnread();
    showSystemNotification(`🐰 ${message.sender} 在小窝说`, message.body, 'rabbit-home-chat');
  }
}

function maybeNotifyCareRequest() {
  if (!modalLayer || modalLayer.classList.contains('hidden') || !document.hidden) return;
  const title = $('#modal-title')?.textContent?.trim() || '';
  if (!/想洗澡|想梳毛/.test(title)) return;
  const body = $('#modal-message')?.textContent?.trim() || '小窝里有新的照料请求';
  const signature = `${title}|${body}`;
  const now = Date.now();
  if (signature === lastCareSignature && now - lastCareAt < 5000) return;
  lastCareSignature = signature;
  lastCareAt = now;
  markUnread();
  showSystemNotification(`💗 ${title.replace(/^\S+\s*/, '')}`, body, 'rabbit-home-care');
}

if (chatList) {
  chatList.addEventListener('scroll', () => {
    lastKnownScrollTop = chatList.scrollTop;
    nearBottom = isNearBottom();
    if (nearBottom) clearUnread();
  }, { passive: true });

  const chatObserver = new MutationObserver(onChatMutations);
  chatObserver.observe(chatList, { childList: true });
  refreshHistoryVisibility();
}

if (modalLayer) {
  const modalObserver = new MutationObserver(maybeNotifyCareRequest);
  modalObserver.observe(modalLayer, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });
}

collapseButton?.addEventListener('click', () => {
  const collapsed = socialPanel?.classList.toggle('chat-collapsed') === true;
  collapseButton.textContent = collapsed ? '展开聊天' : '收起聊天';
  collapseButton.setAttribute('aria-expanded', String(!collapsed));
});

loadEarlierButton?.addEventListener('click', () => {
  if (!chatList) return;
  const beforeHeight = chatList.scrollHeight;
  const beforeTop = chatList.scrollTop;
  visibleLimit += HISTORY_BATCH;
  refreshHistoryVisibility();
  requestAnimationFrame(() => {
    chatList.scrollTop = beforeTop + (chatList.scrollHeight - beforeHeight);
    lastKnownScrollTop = chatList.scrollTop;
    nearBottom = isNearBottom();
  });
});

newMessagesButton?.addEventListener('click', scrollChatToBottom);
notificationButton?.addEventListener('click', requestNotifications);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    suppressNotificationsUntil = Date.now() + 250;
    updateUnreadUi();
    return;
  }
  const missed = unreadCount;
  document.title = BASE_TITLE;
  if (missed > 0) showToast(`欢迎回来，刚才小窝里有 ${missed} 条新提醒。`);
});

window.addEventListener('focus', () => { document.title = BASE_TITLE; });
syncNotificationButton();

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/client/index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/client/main.js'), 'utf8');
const social = fs.readFileSync(path.join(root, 'src/client/social-ui.js'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'src/client/game-layout.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/server/index.js'), 'utf8');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('client HTML contains the forms, game canvas and chat controls required by main.js', () => {
  const requiredIds = [
    'login-form', 'register-form', 'avatar-form', 'create-home-form', 'join-home-form',
    'game-canvas', 'chat-form', 'chat-input', 'chat-messages', 'interaction-prompt',
    'modal-layer', 'toast-layer', 'head-accessory-select', 'neck-accessory-select',
    'back-accessory-select', 'face-mark-select',
  ];
  for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
});

test('client form resets are guarded and no async currentTarget.reset call remains', () => {
  assert.doesNotMatch(main, /event\.currentTarget\.reset\s*\(/);
  assert.match(main, /function safeResetForm\(/);
});

test('Socket.IO browser bundle uses a dedicated vendor route', () => {
  assert.doesNotMatch(html, /\/socket\.io\/socket\.io\.js/);
  assert.match(main, /function ensureSocketIoClient\(/);
  assert.match(server, /app\.get\('\/vendor\/socket\.io\.min\.js'/);
  assert.match(server, /serveClient:\s*false/);
});

test('avatar save keeps compatibility with the legacy accessory field', () => {
  assert.match(main, /accessory:\s*values\.headAccessory/);
});

test('page version matches package version and all client controllers are wired', () => {
  const versionMatch = html.match(/<meta name="rabbit-home-version" content="([^"]+)"/);
  assert.ok(versionMatch, 'missing rabbit-home-version meta');
  assert.equal(versionMatch[1], packageInfo.version);
  const socialIndex = html.indexOf('src="/social-ui.js"');
  const mainIndex = html.indexOf('src="/main.js"');
  const layoutIndex = html.indexOf('src="/game-layout.js"');
  assert.ok(socialIndex >= 0, 'social-ui.js is not loaded');
  assert.ok(mainIndex > socialIndex, 'social-ui.js must be wired before main.js');
  assert.ok(layoutIndex > mainIndex, 'game-layout.js must be loaded after the game client');
});

test('chat UI bounds history, preserves scroll intent and exposes earlier/new-message controls', () => {
  assert.match(social, /const HISTORY_BATCH = 24/);
  assert.match(social, /const CHAT_DOM_LIMIT = 120/);
  assert.match(social, /chat-load-earlier/);
  assert.match(social, /chat-new-messages/);
  assert.match(social, /chat-history-hidden/);
  assert.match(social, /overscroll-behavior:\s*contain/);
  assert.match(social, /previousScrollTop/);
});

test('authoritative layout makes chat a true overlay and uses JS cover sizing for canvas', () => {
  assert.match(layout, /social-panel[^}]*position:\s*fixed\s*!important/s);
  assert.match(layout, /social-panel\.chat-collapsed/);
  assert.match(layout, /chat-messages[^}]*overflow-y:\s*auto\s*!important/s);
  assert.match(layout, /const scale = Math\.max\(width \/ WORLD_WIDTH, height \/ WORLD_HEIGHT\)/);
  assert.match(layout, /ResizeObserver/);
  assert.match(layout, /canvas\.style\.setProperty\('width'/);
  assert.match(layout, /game-layout[^}]*flex:\s*1 1 0\s*!important/s);
  assert.match(layout, /game-column[^}]*position:\s*absolute\s*!important/s);
});

test('collapsed chat hides every content section except the compact launcher', () => {
  for (const selector of ['#chat-messages', '#chat-form', '.emote-grid', '.control-help', '#notification-toggle-btn', '#chat-status']) {
    assert.ok(layout.includes(selector), `collapsed rule missing ${selector}`);
  }
  assert.match(layout, /height:\s*50px\s*!important/);
});

test('background reminders support secure Notification API and HTTP fallback unread title', () => {
  assert.match(social, /Notification\.requestPermission\(\)/);
  assert.match(social, /new Notification\(/);
  assert.match(social, /window\.isSecureContext/);
  assert.match(social, /document\.hidden/);
  assert.match(social, /提醒需 HTTPS/);
  assert.match(social, /document\.title = document\.hidden && unreadCount > 0/);
  assert.match(social, /想洗澡\|想梳毛/);
});

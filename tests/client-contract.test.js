import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/client/index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/client/main.js'), 'utf8');
const social = fs.readFileSync(path.join(root, 'src/client/social-ui.js'), 'utf8');
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

test('page version matches package version and social UI is loaded before main client', () => {
  const versionMatch = html.match(/<meta name="rabbit-home-version" content="([^"]+)"/);
  assert.ok(versionMatch, 'missing rabbit-home-version meta');
  assert.equal(versionMatch[1], packageInfo.version);
  const socialIndex = html.indexOf('src="/social-ui.js"');
  const mainIndex = html.indexOf('src="/main.js"');
  assert.ok(socialIndex >= 0, 'social-ui.js is not loaded');
  assert.ok(mainIndex > socialIndex, 'social-ui.js must be wired before main.js');
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

test('game-first layout makes chat floating/collapsible and canvas cover the available viewport', () => {
  assert.match(social, /game-layout[^}]*display:\s*block/s);
  assert.match(social, /game-column[^}]*position:\s*absolute/s);
  assert.match(social, /social-panel[^}]*position:\s*absolute/s);
  assert.match(social, /social-panel\.chat-collapsed/);
  assert.match(social, /pixel-game-canvas[^}]*object-fit:\s*cover/s);
  assert.match(social, /height:\s*calc\(100dvh - 72px\)/);
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

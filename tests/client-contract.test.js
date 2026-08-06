import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/client/index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/client/main.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/server/index.js'), 'utf8');

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validUsername, sanitizeText } from '../src/server/security.js';

test('scrypt password hash verifies correct password only', async () => {
  const hash = await hashPassword('rabbit-password-123');
  assert.equal(await verifyPassword('rabbit-password-123', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  assert.match(hash, /^scrypt\$/);
});

test('username and text validation', () => {
  assert.equal(validUsername('rabbit_01'), true);
  assert.equal(validUsername('兔兔'), false);
  assert.equal(sanitizeText('  小兔\u0000兔  ', 10), '小兔兔');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameDatabase } from '../src/server/database.js';

test('database supports user, avatar, home and atomic care request flow', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rabbit-home-'));
  const db = new GameDatabase(path.join(dir, 'test.db'));
  try {
    const rabbitUser = db.createUser({ username: 'rabbit1', passwordHash: 'test', displayName: '小垂耳' });
    const maoUser = db.createUser({ username: 'maomao1', passwordHash: 'test', displayName: '云朵毛毛' });
    const rabbit = db.upsertAvatar(rabbitUser.id, { role: 'RABBIT', variant: 'lop', primaryColor: '#ffffff', secondaryColor: '#ccaa88', eyeColor: '#221111', headAccessory: 'bow', neckAccessory: 'bell', backAccessory: 'heart', faceMark: 'blush' });
    const mao = db.upsertAvatar(maoUser.id, { role: 'MAOMAO', variant: 'cloud', primaryColor: '#eeeeee', secondaryColor: '#aabbcc', eyeColor: '#222222', headAccessory: 'leaf', neckAccessory: 'scarf', backAccessory: 'cloud', faceMark: 'none' });
    assert.equal(rabbit.head_accessory, 'bow');
    assert.equal(rabbit.neck_accessory, 'bell');
    assert.equal(rabbit.back_accessory, 'heart');
    assert.equal(rabbit.face_mark, 'blush');
    const home = db.createHome(rabbitUser.id, '测试小窝', 'ABCDEFGH');
    db.addHomeMember(home.id, maoUser.id);
    assert.equal(db.isHomeMember(home.id, maoUser.id), true);

    const request = db.createInteractionRequest({ homeId: home.id, requesterAvatarId: rabbit.id, requestType: 'BATH', objectId: 'bath', expiresAt: Date.now() + 60_000 });
    const accepted = db.acceptInteractionRequest(request.id, mao.id);
    assert.equal(accepted.status, 'ACCEPTED');
    assert.equal(db.acceptInteractionRequest(request.id, mao.id), null);
    assert.equal(db.markRequestRunning(request.id), true);
    db.completeRequest(request.id);
    assert.equal(db.getInteractionRequest(request.id).status, 'COMPLETED');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

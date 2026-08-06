import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class GameDatabase {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath, { timeout: 5000 });
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      ) STRICT;

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS avatars (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('RABBIT', 'MAOMAO')),
        variant TEXT NOT NULL,
        primary_color TEXT NOT NULL,
        secondary_color TEXT NOT NULL,
        eye_color TEXT NOT NULL,
        accessory TEXT NOT NULL DEFAULT 'none',
        head_accessory TEXT NOT NULL DEFAULT 'none',
        neck_accessory TEXT NOT NULL DEFAULT 'none',
        back_accessory TEXT NOT NULL DEFAULT 'none',
        face_mark TEXT NOT NULL DEFAULT 'none',
        last_home_id TEXT,
        last_x REAL NOT NULL DEFAULT 480,
        last_y REAL NOT NULL DEFAULT 340,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS homes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        invite_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS home_members (
        home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        member_role TEXT NOT NULL DEFAULT 'MEMBER',
        joined_at INTEGER NOT NULL,
        PRIMARY KEY(home_id, user_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS care_states (
        avatar_id TEXT PRIMARY KEY REFERENCES avatars(id) ON DELETE CASCADE,
        hunger INTEGER NOT NULL DEFAULT 80,
        cleanliness INTEGER NOT NULL DEFAULT 80,
        mood INTEGER NOT NULL DEFAULT 80,
        energy INTEGER NOT NULL DEFAULT 80,
        bond INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS interaction_requests (
        id TEXT PRIMARY KEY,
        home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
        requester_avatar_id TEXT NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
        accepted_by_avatar_id TEXT REFERENCES avatars(id) ON DELETE SET NULL,
        request_type TEXT NOT NULL CHECK(request_type IN ('BATH', 'BRUSH')),
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
        object_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        completed_at INTEGER
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_requests_home_status ON interaction_requests(home_id, status);
    `);
    this.ensureColumn('avatars', 'head_accessory', "TEXT NOT NULL DEFAULT 'none'");
    this.ensureColumn('avatars', 'neck_accessory', "TEXT NOT NULL DEFAULT 'none'");
    this.ensureColumn('avatars', 'back_accessory', "TEXT NOT NULL DEFAULT 'none'");
    this.ensureColumn('avatars', 'face_mark', "TEXT NOT NULL DEFAULT 'none'");
  }

  ensureColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  close() { this.db.close(); }
  cleanupExpiredSessions() { this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()); }

  createUser({ username, passwordHash, displayName }) {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO users(id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, username, passwordHash, displayName, now);
    return this.getUserById(id);
  }

  getUserByUsername(username) { return this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username); }
  getUserById(id) { return this.db.prepare('SELECT id, username, display_name, status, created_at, last_login_at FROM users WHERE id = ?').get(id); }
  touchLogin(id) { this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), id); }
  listUsers() { return this.db.prepare('SELECT id, username, display_name, status, created_at, last_login_at FROM users ORDER BY created_at').all(); }
  setUserPassword(userId, passwordHash) { this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, userId); }
  setUserStatus(userId, status) { this.db.prepare('UPDATE users SET status=? WHERE id=?').run(status, userId); }

  createSession(tokenHash, userId, expiresAt) {
    this.db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, Date.now(), expiresAt);
  }
  deleteSession(tokenHash) { this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash); }
  getSession(tokenHash) {
    return this.db.prepare(`
      SELECT s.token_hash, s.user_id, s.expires_at, u.username, u.display_name, u.status
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash, Date.now());
  }

  upsertAvatar(userId, avatar) {
    const existing = this.getAvatarByUserId(userId);
    const now = Date.now();
    if (existing) {
      this.db.prepare(`UPDATE avatars SET role=?, variant=?, primary_color=?, secondary_color=?, eye_color=?, accessory=?,
        head_accessory=?, neck_accessory=?, back_accessory=?, face_mark=?, updated_at=? WHERE user_id=?`)
        .run(avatar.role, avatar.variant, avatar.primaryColor, avatar.secondaryColor, avatar.eyeColor,
          avatar.headAccessory || avatar.accessory || 'none', avatar.headAccessory || avatar.accessory || 'none',
          avatar.neckAccessory || 'none', avatar.backAccessory || 'none', avatar.faceMark || 'none', now, userId);
      return this.getAvatarByUserId(userId);
    }
    const id = crypto.randomUUID();
    this.db.prepare(`INSERT INTO avatars(id,user_id,role,variant,primary_color,secondary_color,eye_color,accessory,
      head_accessory,neck_accessory,back_accessory,face_mark,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, userId, avatar.role, avatar.variant, avatar.primaryColor, avatar.secondaryColor, avatar.eyeColor,
        avatar.headAccessory || avatar.accessory || 'none', avatar.headAccessory || avatar.accessory || 'none',
        avatar.neckAccessory || 'none', avatar.backAccessory || 'none', avatar.faceMark || 'none', now, now);
    this.db.prepare('INSERT INTO care_states(avatar_id, updated_at) VALUES (?, ?)').run(id, now);
    return this.getAvatarByUserId(userId);
  }

  getAvatarByUserId(userId) {
    return this.db.prepare(`SELECT a.*, c.hunger, c.cleanliness, c.mood, c.energy, c.bond
      FROM avatars a JOIN care_states c ON c.avatar_id=a.id WHERE a.user_id=?`).get(userId);
  }
  getAvatarById(id) {
    return this.db.prepare(`SELECT a.*, u.display_name, c.hunger, c.cleanliness, c.mood, c.energy, c.bond
      FROM avatars a JOIN users u ON u.id=a.user_id JOIN care_states c ON c.avatar_id=a.id WHERE a.id=?`).get(id);
  }
  saveAvatarPosition(avatarId, homeId, x, y) {
    this.db.prepare('UPDATE avatars SET last_home_id=?, last_x=?, last_y=?, updated_at=? WHERE id=?')
      .run(homeId, x, y, Date.now(), avatarId);
  }
  setLastHome(userId, homeId) { this.db.prepare('UPDATE avatars SET last_home_id=?, updated_at=? WHERE user_id=?').run(homeId, Date.now(), userId); }

  updateStats(avatarId, delta) {
    const fields = ['hunger', 'cleanliness', 'mood', 'energy', 'bond'];
    const current = this.db.prepare('SELECT * FROM care_states WHERE avatar_id=?').get(avatarId);
    if (!current) return null;
    const next = {};
    for (const field of fields) {
      const max = field === 'bond' ? 1000 : 100;
      next[field] = Math.max(0, Math.min(max, current[field] + (delta[field] || 0)));
    }
    this.db.prepare(`UPDATE care_states SET hunger=?,cleanliness=?,mood=?,energy=?,bond=?,updated_at=? WHERE avatar_id=?`)
      .run(next.hunger, next.cleanliness, next.mood, next.energy, next.bond, Date.now(), avatarId);
    return next;
  }

  createHome(userId, name, inviteCode) {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO homes(id,name,invite_code,owner_user_id,created_at) VALUES(?,?,?,?,?)').run(id, name, inviteCode, userId, now);
      this.db.prepare(`INSERT INTO home_members(home_id,user_id,member_role,joined_at) VALUES(?,?, 'OWNER', ?)`).run(id, userId, now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getHome(id);
  }
  getHome(id) { return this.db.prepare('SELECT * FROM homes WHERE id=?').get(id); }
  getHomeByInvite(inviteCode) { return this.db.prepare('SELECT * FROM homes WHERE invite_code=? COLLATE NOCASE').get(inviteCode); }
  addHomeMember(homeId, userId) {
    this.db.prepare(`INSERT OR IGNORE INTO home_members(home_id,user_id,member_role,joined_at) VALUES(?,?, 'MEMBER', ?)`).run(homeId, userId, Date.now());
  }
  isHomeMember(homeId, userId) { return Boolean(this.db.prepare('SELECT 1 FROM home_members WHERE home_id=? AND user_id=?').get(homeId, userId)); }
  listHomesForUser(userId) {
    return this.db.prepare(`SELECT h.id,h.name,h.invite_code,h.owner_user_id,h.created_at,hm.member_role
      FROM homes h JOIN home_members hm ON hm.home_id=h.id WHERE hm.user_id=? ORDER BY hm.joined_at DESC`).all(userId);
  }

  createInteractionRequest({ homeId, requesterAvatarId, requestType, objectId, expiresAt }) {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db.prepare(`INSERT INTO interaction_requests(id,home_id,requester_avatar_id,request_type,status,object_id,created_at,expires_at)
      VALUES(?,?,?,?,'PENDING',?,?,?)`).run(id, homeId, requesterAvatarId, requestType, objectId, now, expiresAt);
    return this.getInteractionRequest(id);
  }
  getInteractionRequest(id) { return this.db.prepare('SELECT * FROM interaction_requests WHERE id=?').get(id); }
  listOpenRequests(homeId) {
    return this.db.prepare(`SELECT r.*, u.display_name AS requester_name FROM interaction_requests r
      JOIN avatars a ON a.id=r.requester_avatar_id JOIN users u ON u.id=a.user_id
      WHERE r.home_id=? AND r.status IN ('PENDING','ACCEPTED') AND r.expires_at>? ORDER BY r.created_at`).all(homeId, Date.now());
  }
  acceptInteractionRequest(id, avatarId) {
    const result = this.db.prepare(`UPDATE interaction_requests SET status='ACCEPTED', accepted_by_avatar_id=?
      WHERE id=? AND status='PENDING' AND expires_at>?`).run(avatarId, id, Date.now());
    return result.changes === 1 ? this.getInteractionRequest(id) : null;
  }
  markRequestRunning(id) {
    const result = this.db.prepare(`UPDATE interaction_requests SET status='RUNNING' WHERE id=? AND status='ACCEPTED'`).run(id);
    return result.changes === 1;
  }
  completeRequest(id) {
    this.db.prepare(`UPDATE interaction_requests SET status='COMPLETED', completed_at=? WHERE id=? AND status='RUNNING'`).run(Date.now(), id);
  }
  expireRequests() {
    this.db.prepare(`UPDATE interaction_requests SET status='EXPIRED' WHERE status IN ('PENDING','ACCEPTED') AND expires_at<=?`).run(Date.now());
  }
}

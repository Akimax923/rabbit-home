import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { config } from './config.js';

const backupDir = process.env.BACKUP_DIR || path.join(config.root, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `rabbit-home-${stamp}.db`);
const db = new DatabaseSync(config.databasePath, { readOnly: true });
await backup(db, target);
db.close();

const retentionDays = Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10);
const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const name of fs.readdirSync(backupDir)) {
  if (!/^rabbit-home-.*\.db$/.test(name)) continue;
  const file = path.join(backupDir, name);
  if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
}
console.log(target);

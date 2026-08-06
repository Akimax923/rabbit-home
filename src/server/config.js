import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import 'dotenv/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

export const config = {
  root,
  appVersion: String(packageInfo.version || '0.0.0'),
  host: process.env.HOST || '127.0.0.1',
  port: Number.parseInt(process.env.PORT || '3100', 10),
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me-please',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'rabbit-home.db'),
  homeMaxPlayers: Number.parseInt(process.env.HOME_MAX_PLAYERS || '8', 10),
  allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
  registrationCode: process.env.REGISTRATION_CODE || '',
  isProduction: process.env.NODE_ENV === 'production',
};

if (config.isProduction && config.sessionSecret.length < 32) {
  throw new Error('生产环境 SESSION_SECRET 至少需要 32 个字符');
}

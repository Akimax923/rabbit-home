import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config.js';
import { GameDatabase } from './database.js';
import { createApiRouter, createAuthHelpers } from './api.js';
import { GameServer } from './game-server.js';

const socketClientBundlePath = resolveSocketClientBundle();
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProduction) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss: ws:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  }
  next();
});

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin || isAllowedOrigin(origin, requestOrigin(req), config.publicOrigin)) return next();
  res.status(403).json({ error: '请求来源无效' });
});

// Do not use /socket.io/socket.io.js for the browser bundle. That path shares the
// Engine.IO transport prefix and can be handled as a handshake request in mixed
// or stale deployments. Serve the exact bundled client from a normal HTTP path.
app.get('/vendor/socket.io.min.js', (_req, res, next) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(socketClientBundlePath, (error) => {
    if (error) next(error);
  });
});

const db = new GameDatabase(config.databasePath);
const auth = createAuthHelpers(db, config);
app.use('/api', createApiRouter(db, config, auth));

const distPath = path.join(config.root, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    maxAge: 0,
    etag: true,
    index: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/socket.io/') || req.path.startsWith('/vendor/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.type('text').send('Rabbit Home API is running. Run npm run build first.'));
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 格式无效' });
  if (String(error?.message || '').includes('UNIQUE constraint failed')) return res.status(409).json({ error: '数据已经存在' });
  res.status(500).json({ error: '服务器暂时开小差了' });
});

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  path: '/socket.io',
  serveClient: false,
  transports: ['websocket', 'polling'],
  pingInterval: 20_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 32_000,
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    const expected = forwardedOrigin(req.headers);
    callback(null, !origin || isAllowedOrigin(origin, expected, config.publicOrigin));
  },
});
const gameServer = new GameServer({ io, db, config, auth });

server.listen(config.port, config.host, () => {
  console.log(`[rabbit-home] v${config.appVersion} listening on http://${config.host}:${config.port}`);
  console.log(`[rabbit-home] database: ${config.databasePath}`);
  console.log(`[rabbit-home] public origin: ${config.publicOrigin || 'same-origin auto'}`);
  console.log(`[rabbit-home] socket client: ${socketClientBundlePath}`);
});

const cleanupTimer = setInterval(() => db.cleanupExpiredSessions(), 60 * 60_000);
cleanupTimer.unref();

function resolveSocketClientBundle() {
  const entryPath = fileURLToPath(import.meta.resolve('socket.io'));
  let directory = path.dirname(entryPath);
  const filesystemRoot = path.parse(directory).root;

  while (directory !== filesystemRoot) {
    const packagePath = path.join(directory, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (packageInfo.name === 'socket.io') {
          for (const filename of ['socket.io.min.js', 'socket.io.js']) {
            const candidate = path.join(directory, 'client-dist', filename);
            if (fs.existsSync(candidate)) return candidate;
          }
        }
      } catch {
        // Keep walking upward until the socket.io package root is found.
      }
    }
    directory = path.dirname(directory);
  }

  throw new Error('找不到 Socket.IO 浏览器客户端文件，请重新执行 npm install');
}

function requestOrigin(req) {
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${protocol}://${host}` : '';
}
function forwardedOrigin(headers) {
  const protocol = String(headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  return host ? `${protocol}://${host}` : '';
}
function isAllowedOrigin(origin, sameOrigin, publicOrigin) {
  const normalized = String(origin).replace(/\/$/, '');
  if (publicOrigin && normalized === publicOrigin) return true;
  if (sameOrigin && normalized === sameOrigin.replace(/\/$/, '')) return true;
  if (!config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) return true;
  return false;
}

function shutdown(signal) {
  console.log(`[rabbit-home] received ${signal}, shutting down`);
  clearInterval(cleanupTimer);
  gameServer.close();
  io.close(() => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

import { config } from './config.js';
import { GameDatabase } from './database.js';
import { hashPassword } from './security.js';

const [command, username, value] = process.argv.slice(2);
const db = new GameDatabase(config.databasePath);
let exitCode = 0;

try {
  if (command === 'list-users') {
    console.table(db.listUsers().map((user) => ({
      username: user.username,
      displayName: user.display_name,
      status: user.status,
      createdAt: new Date(user.created_at).toISOString(),
      lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : '-',
    })));
  } else if (command === 'reset-password' && username && value?.length >= 8) {
    const user = db.getUserByUsername(username);
    if (!user) { console.error('用户不存在'); exitCode = 1; }
    else { db.setUserPassword(user.id, await hashPassword(value)); console.log(`已重置 ${user.username} 的密码`); }
  } else if ((command === 'disable-user' || command === 'enable-user') && username) {
    const user = db.getUserByUsername(username);
    if (!user) { console.error('用户不存在'); exitCode = 1; }
    else {
      const status = command === 'disable-user' ? 'DISABLED' : 'ACTIVE';
      db.setUserStatus(user.id, status);
      console.log(`${user.username} 状态已修改为 ${status}`);
    }
  } else {
    console.error(`用法：
  node src/server/admin.js list-users
  node src/server/admin.js reset-password <用户名> <至少8位新密码>
  node src/server/admin.js disable-user <用户名>
  node src/server/admin.js enable-user <用户名>`);
    exitCode = 1;
  }
} finally {
  db.close();
}
process.exitCode = exitCode;

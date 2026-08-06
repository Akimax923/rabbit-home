# Package Contents — v0.2.0

```text
rabbit-home/
├── src/client/                 浏览器端源码
│   ├── index.html              页面与 UI
│   ├── styles.css              像素风样式
│   ├── main.js                 账号、角色、大厅、聊天与页面状态
│   ├── game.js                 Canvas 小窝、移动、家具与动画
│   └── avatar-preview.js       角色与配饰像素绘制
├── src/server/
│   ├── index.js                Express、静态页面、Socket.IO
│   ├── api.js                  登录、角色和小窝 API
│   ├── database.js             SQLite 与增量迁移
│   ├── game-server.js          多人房间、移动、聊天和互动
│   ├── security.js             密码、Cookie 与限流
│   ├── backup.js               数据库备份
│   └── admin.js                用户管理命令
├── dist/                       已生成的可运行前端
├── deploy/                     安装、更新、卸载与 Node 24 脚本
├── docs/                       部署、开发、玩法、运维与参考架构
├── scripts/
│   ├── build-client.js         零依赖静态构建
│   └── check-syntax.js         JS 语法检查
├── tests/                      SQLite、密码与验证测试
├── package.json
├── README.md
├── REQUIREMENTS.md
├── CHANGELOG.md
└── LICENSE
```

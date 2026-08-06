# 开发说明

## 安装

```bash
npm install
npm run check
npm test
npm run build
npm start
```

开发访问：

```text
http://127.0.0.1:3100
```

## 客户端

源码：

```text
src/client/index.html
src/client/styles.css
src/client/main.js
src/client/game.js
src/client/avatar-preview.js
```

构建只是复制到：

```text
dist/
```

## 角色稳定性约束

- Canvas 逻辑画布固定 960×576。
- 角色内部像素骨架固定 32×32。
- 脚底为定位原点。
- 服务端碰撞使用脚部半径，而不是角色耳朵和配饰轮廓。
- 配饰只作为渲染层，不参与碰撞。
- 家具使用固定 anchor，不根据角色外形计算位置。

## 添加配饰

同时修改：

- `src/client/avatar-preview.js` 的 `APPEARANCE_OPTIONS` 和绘制代码。
- `src/server/api.js` 的白名单。
- 如需新增数据库字段，再修改 `database.js` 增量迁移。

## 添加家具

同时修改：

- `src/client/game.js` 的 OBJECTS 与绘制函数。
- `src/server/game-server.js` 的 GAME_OBJECTS、OBSTACLES 和可选 FURNITURE_ANCHORS。

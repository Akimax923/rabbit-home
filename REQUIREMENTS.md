# 系统要求

## 生产环境

| 项目 | 要求 |
|---|---|
| Linux | Ubuntu 20.04 / 22.04 / 24.04 |
| CPU 架构 | x86_64 或 ARM64 |
| Node.js | 24.15 或更高的 Node 24 LTS |
| npm | 随 Node 24 安装的版本即可 |
| 内存 | 最低 1 GB，建议 2 GB 以上 |
| 磁盘 | 项目约数十 MB；数据库和备份按用户量增长 |
| 网关 | Nginx |
| 数据库 | Node.js 内置 `node:sqlite`，无需另装数据库服务 |

## 端口

- `22/TCP`：SSH
- `80/TCP`：HTTP 与证书验证
- `443/TCP`：HTTPS/WSS
- `3100`：仅监听 `127.0.0.1`，不要开放公网

## npm 依赖

生产依赖只有：

- `express@5.1.0`
- `socket.io@4.8.1`
- `dotenv@17.2.1`

前端不再依赖 Phaser、Vite 或 `socket.io-client` npm 包；Socket.IO 浏览器脚本由服务器的 `/socket.io/socket.io.js` 提供。

## 浏览器

建议使用近期版本的 Chrome、Edge、Firefox 或 Safari。需要支持：

- ES Modules
- Canvas 2D
- Fetch
- WebSocket
- Pointer Events（手机控制）

## 规模建议

首版默认单个小窝最多 8 人。单进程部署建议先以 20～30 名总在线玩家做压力验证。若未来需要多进程或多服务器，需要为 Socket.IO 增加跨实例适配器，并将房间内存状态外置。

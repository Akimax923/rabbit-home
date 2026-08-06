# 兔兔与毛毛的小窝 v0.2.0

一个可直接部署到公网 Linux 服务器的多人像素网页游戏。玩家注册后选择兔兔或毛毛，进入同一个邀请码小窝，实时移动、聊天、使用家具，并共同完成洗澡与梳毛互动。

## v0.2.0 更新

- 全新暖色像素 UI 与温馨小窝布局。
- 原创程序化像素角色：侏儒兔、垂耳兔、狮子兔，以及 4 种毛毛。
- 统一 32×32 角色骨架、脚底锚点和碰撞框，换品种与配饰不改变逻辑尺寸。
- 头饰、颈饰、背饰、面部贴纸分层显示。
- 小窝房间聊天、角色头顶聊天气泡、快捷表情。
- 沙发双座、床铺、地毯可坐/躺；移动即可起身。
- 洗澡泡泡动画、梳毛星光动画和双方固定互动站位。
- 服务端管理家具占用、玩家行为状态、聊天限流和移动碰撞。
- 不再依赖 Phaser/Vite 前端构建：浏览器端为原生 Canvas + Socket.IO，`npm run build` 只是复制静态文件，避免服务器缺少 Vite 或镜像未同步 Phaser。
- HTTP 公网 IP 模式自动执行同源校验，不再要求手工填写公网 IP 到 `PUBLIC_ORIGIN`。
- HTML、JS 默认 `no-cache`，减少更新后浏览器继续运行旧代码的问题。

## 技术结构

```text
浏览器
  ├─ HTML / CSS 像素 UI
  ├─ Canvas 场景、角色和动画
  └─ Socket.IO Client（由服务器直接提供）
          │
          ▼
Nginx :80 / :443
          │
          ▼
Node.js 24 + Express + Socket.IO :3100
  ├─ 账号与 Cookie Session
  ├─ 服务端移动与碰撞
  ├─ 房间、聊天、家具占用和互动状态
  └─ node:sqlite 持久化
```

## 快速部署

### 环境

- Ubuntu 20.04、22.04 或 24.04
- x86_64 或 ARM64
- Node.js 24.15+
- 公网安全组开放 `80/TCP`；使用 HTTPS 时开放 `443/TCP`
- 不需要开放 `3100`

### 通过 GitHub 克隆

```bash
cd /home/ubuntu
git clone git@github.com:你的用户名/rabbit-home.git rabbit-home-src
cd rabbit-home-src
```

### 暂无域名：公网 IP 测试

```bash
sudo bash deploy/install.sh \
  --install-node \
  --http-only
```

访问：

```text
http://你的公网IP
```

HTTP-only 模式会让 `PUBLIC_ORIGIN` 保持为空，应用根据 Nginx 转发的 Host 和协议校验同源请求，因此不再把云服务器内网 IP `10.x.x.x` 错写成公网来源。

### 有域名：HTTPS 正式部署

先将域名 A 记录解析到服务器公网 IP，再执行：

```bash
sudo bash deploy/install.sh \
  --install-node \
  --domain rabbit.example.com \
  --email you@example.com
```

### 设置注册邀请码

```bash
sudo bash deploy/install.sh \
  --install-node \
  --http-only \
  --registration-code RABBIT-2026
```

这里是**账号注册邀请码**。玩家创建小窝后，系统还会生成独立的 **8 位小窝邀请码**，用于进入同一个多人房间。

## 后续更新

服务器源码仓库位于例如：

```text
/home/ubuntu/rabbit-home-src
```

运行目录为：

```text
/opt/rabbit-home
```

更新：

```bash
cd /home/ubuntu/rabbit-home-src
bash deploy/pull-and-update.sh
```

脚本会：

1. `git pull --ff-only`
2. 备份 SQLite
3. 同步源码
4. 安装生产依赖
5. 执行语法检查与测试
6. 生成 `dist/`
7. 重启服务并检查健康接口

## 本地检查

```bash
npm install
npm run check
npm test
npm run build
```

本版本不需要 Vite，`npm run build` 不访问网络，只将 `src/client/` 复制到 `dist/`。

## 游戏操作

- `WASD` / 方向键：移动
- `E` / 空格：使用家具或互动
- 沙发、床、地毯：靠近后按 E；移动即可离开
- 兔兔靠近澡盆或梳毛台：按 E 发起请求
- 毛毛收到弹窗后接单，双方到达指定位置后按 E
- 右侧聊天框：发送 80 字以内的消息
- 手机：页面提供方向按钮和互动按钮

## 管理命令

```bash
sudo -u rabbit-home bash -lc 'cd /opt/rabbit-home && npm run admin -- list-users'

sudo -u rabbit-home bash -lc \
  'cd /opt/rabbit-home && npm run admin -- reset-password 用户名 新密码'

sudo -u rabbit-home bash -lc \
  'cd /opt/rabbit-home && npm run admin -- disable-user 用户名'
```

## 数据与备份

```text
/opt/rabbit-home/data/rabbit-home.db
/opt/rabbit-home/backups/
```

每日备份计时器：

```bash
systemctl status rabbit-home-backup.timer
```

## 参考架构

本项目没有复制参考游戏的角色素材或完整源码，而是基于成熟开源项目中已验证的多人游戏模式重新实现：

- SkyOffice：家具交互点、坐下行为状态、脚部碰撞框、聊天 UI 与头顶对话气泡的分层思路。
- Reldens：房间式多人服务端、玩家状态、聊天与可配置对象模块化思路。
- Kontra：固定时间步 Canvas 游戏循环的轻量设计思路。

详细说明见 [`docs/REFERENCE_ARCHITECTURE.md`](docs/REFERENCE_ARCHITECTURE.md)。

## 安全边界

当前版本适合小范围邀请测试：

- 密码使用 scrypt 哈希。
- Session 使用 HttpOnly Cookie。
- 非 GET 请求执行同源检查。
- Socket.IO 连接读取同一登录 Session。
- 服务端验证移动、碰撞、交互距离、家具占用和照料请求状态。
- 聊天限制 80 字且每名玩家约 1.2 秒最多发送一次。
- 没有开放文件上传、HTML 富文本或自由脚本。

正式公开运营前仍建议增加：举报/屏蔽、管理员聊天审计、邮件找回密码、用户协议和更完善的内容安全机制。

## License

MIT。角色图形与小窝场景为本项目原创程序化绘制，不包含用户参考图中的原始像素素材。

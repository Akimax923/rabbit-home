# 公网部署说明

## 1. 云安全组

开放：

- 22/TCP
- 80/TCP
- 443/TCP（有域名时）

不要开放 3100。

## 2. 首次安装

```bash
cd /home/ubuntu/rabbit-home-src
sudo bash deploy/install.sh --install-node --http-only
```

国内网络可指定镜像；本版本只有常见服务端依赖：

```bash
sudo bash deploy/install.sh \
  --install-node \
  --http-only \
  --npm-registry https://registry.npmmirror.com
```

HTTP-only 模式下 `.env` 的 `PUBLIC_ORIGIN` 留空，应用根据浏览器 Origin 与 Nginx 的 Host/协议进行同源比较。

## 3. 域名 HTTPS

DNS 添加 A 记录：

```text
rabbit.example.com -> 服务器公网 IP
```

确认解析生效且 80/443 已开放，再执行：

```bash
sudo bash deploy/install.sh \
  --install-node \
  --domain rabbit.example.com \
  --email you@example.com
```

## 4. 验证

```bash
systemctl status rabbit-home --no-pager
curl http://127.0.0.1:3100/api/health
curl -I http://127.0.0.1/
journalctl -u rabbit-home -n 100 --no-pager
```

浏览器访问：

```text
http://公网IP
```

或：

```text
https://rabbit.example.com
```

## 5. 运行目录

```text
/opt/rabbit-home/.env
/opt/rabbit-home/data/rabbit-home.db
/opt/rabbit-home/backups/
/opt/rabbit-home/dist/
```

## 6. 更新

```bash
cd /home/ubuntu/rabbit-home-src
bash deploy/pull-and-update.sh
```

更新脚本自动备份数据库、构建静态客户端、重启和检查健康接口。

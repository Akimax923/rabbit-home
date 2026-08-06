# 运维手册

## 服务

```bash
sudo systemctl status rabbit-home
sudo systemctl restart rabbit-home
sudo journalctl -u rabbit-home -f
```

## 监听

```bash
ss -lntp | grep -E ':80|:443|:3100'
```

预期 Node 只监听 `127.0.0.1:3100`。

## 健康检查

```bash
curl http://127.0.0.1:3100/api/health
curl http://127.0.0.1/api/health
```

## 用户管理

```bash
sudo -u rabbit-home bash -lc 'cd /opt/rabbit-home && npm run admin -- list-users'
sudo -u rabbit-home bash -lc 'cd /opt/rabbit-home && npm run admin -- disable-user 用户名'
sudo -u rabbit-home bash -lc 'cd /opt/rabbit-home && npm run admin -- enable-user 用户名'
sudo -u rabbit-home bash -lc 'cd /opt/rabbit-home && npm run admin -- reset-password 用户名 新密码'
```

## 注册开关

```bash
sudo sed -i 's/^ALLOW_REGISTRATION=.*/ALLOW_REGISTRATION=false/' /opt/rabbit-home/.env
sudo systemctl restart rabbit-home
```

设置注册邀请码：

```bash
sudo sed -i 's/^REGISTRATION_CODE=.*/REGISTRATION_CODE=RABBIT-2026/' /opt/rabbit-home/.env
sudo systemctl restart rabbit-home
```

## 备份

```bash
systemctl status rabbit-home-backup.timer
sudo systemctl start rabbit-home-backup.service
ls -lh /opt/rabbit-home/backups
```

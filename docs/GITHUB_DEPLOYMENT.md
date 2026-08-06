# GitHub 与服务器更新

## 本地首次推送

```bash
git init
git add .
git commit -m "feat: rabbit home v0.2"
git branch -M main
git remote add origin git@github.com:你的用户名/rabbit-home.git
git push -u origin main
```

## 私有仓库服务器 Deploy Key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/rabbit_home_deploy -C rabbit-home-server
cat ~/.ssh/rabbit_home_deploy.pub
```

在 GitHub 仓库 Settings → Deploy keys 中添加公钥，建议保持只读。

`~/.ssh/config`：

```sshconfig
Host github-rabbit-home
  HostName github.com
  User git
  IdentityFile ~/.ssh/rabbit_home_deploy
  IdentitiesOnly yes
```

克隆：

```bash
git clone git@github-rabbit-home:你的用户名/rabbit-home.git /home/ubuntu/rabbit-home-src
```

## 更新

```bash
cd /home/ubuntu/rabbit-home-src
bash deploy/pull-and-update.sh
```

不要在 `/opt/rabbit-home` 中执行 `git pull`；该目录属于运行用户，包含生产 `.env`、SQLite 和备份。

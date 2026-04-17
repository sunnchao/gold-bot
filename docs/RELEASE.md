# 版本发布流程

适用于 gold-bot 后续正式版本发布：**代码合并 → EA 版本同步 → tag → GitHub Actions 出镜像/Release → JP 部署 → 验证**。

---

## 发布对象

gold-bot 实际上有两套版本号：

1. **服务端 Git tag**：例如 `v1.6.3`
   - 触发 `.github/workflows/docker.yml`
   - 自动构建/推送 `ghcr.io/sunnchao/gold-bot:latest`
   - 触发 `.github/workflows/release.yml` 创建 GitHub Release

2. **EA 版本元数据**：例如 `2.9.0 (build 8)`
   - 存在于：
     - `mt4_ea/GoldBolt_Client.mq4`
     - `mt5_ea/GoldBolt_Client.mq5`
     - `mt4_ea/version.json`
   - 服务端 EA 下载/版本接口读取的是 `mt4_ea/version.json`

**重点：** 改了 EA 客户端但没同步 `version.json`，服务端仍会对外报告旧版本。

**补充：** 当前仓库自带的 `docker-compose.yaml` 仍是 **本地 build** 模式（`docker compose up -d --build`），不会直接消费 GHCR 镜像。GitHub Actions 产出的 GHCR 镜像主要用于归档与后续切换镜像部署；JP 现行发布动作仍是 `git pull` 后本地重建容器。

---

## 一次发布的标准顺序

### 1. 进入主分支并确保工作区干净

```bash
cd /root/gold-bot
git checkout main
git pull --ff-only origin main
git status --short
```

期望：`git status --short` 无输出。

### 2. 如涉及 EA 变更，先同步 EA 版本元数据

查看当前状态：

```bash
python3 scripts/release.py check
```

准备下一个 EA 版本：

```bash
python3 scripts/release.py prepare \
  --version 2.9.0 \
  --build 8 \
  --changelog "新增统一发布检查脚本，规范 EA 版本同步流程"
```

这个命令会统一更新：

- `mt4_ea/version.json`
- `mt4_ea/GoldBolt_Client.mq4`
- `mt5_ea/GoldBolt_Client.mq5`

再次检查：

```bash
python3 scripts/release.py check --skip-git
```

### 3. 运行发布前检查

推荐至少跑下面这些：

```bash
# Go 代码与契约
go test ./internal/... ./tests/contracts -timeout 60s

# Docker/workflow 合同检查
bash tests/docker/test_docker_workflow.sh

# 发布流程合同检查
bash tests/release/test_release_contract.sh
```

如果这次主要改了某个模块，再补该模块的专项测试。

### 4. 提交版本准备变更

```bash
git add mt4_ea/version.json mt4_ea/GoldBolt_Client.mq4 mt5_ea/GoldBolt_Client.mq5 docs/RELEASE.md docs/README.md docs/DEPLOYMENT.md tests/release scripts/release.py
git commit -m "ci: standardize release workflow"
```

如果这次没有改流程文档/脚本，只提交实际业务代码和 EA 版本文件即可。

### 5. 生成 release notes 草稿

> `scripts/release.py notes` 只读取 **已提交的 git 历史**，不会把 dirty working tree 里的改动算进去。所以这一步要放在发布相关 commit 之后。

```bash
python3 scripts/release.py notes --current-tag v1.6.3 --ref HEAD --repository sunnchao/gold-bot > /tmp/gold-bot-v1.6.3.md
cat /tmp/gold-bot-v1.6.3.md
```

这个草稿适合：

- GitHub Release body
- 飞书/Discord 发版说明
- `docs/CHANGELOG.md` 人工整理参考

### 6. 推送主分支

**必须使用 Hermes home 的 GitHub key：**

```bash
eval "$(ssh-agent -s)"
ssh-add /root/.hermes/home/.ssh/id_ed25519
git push origin main
```

不要用 `/root/.ssh/id_ed25519`，那是 gateway key，不是 gold-bot 仓库 push key。

### 7. 打 tag 并推送

```bash
git tag -a v1.6.3 -m "release v1.6.3"
git push origin v1.6.3
```

要求：
- tag 必须是标准 semver：`vX.Y.Z`
- 不要用 `v1.6.3-fix-close-short` 这种非标准后缀

### 8. 观察 GitHub Actions

先分别拿到两个 workflow 的最新 run，再各自 watch 到结束：

```bash
TAG_SHA=$(git rev-list -n 1 v1.6.3)
DOCKER_RUN_ID=$(gh run list --workflow docker.yml --commit "$TAG_SHA" --limit 1 --json databaseId --jq '.[0].databaseId')
RELEASE_RUN_ID=$(gh run list --workflow release.yml --commit "$TAG_SHA" --limit 1 --json databaseId --jq '.[0].databaseId')

gh run watch "$DOCKER_RUN_ID" --exit-status
gh run watch "$RELEASE_RUN_ID" --exit-status
```

预期都成功：
- `Docker Publish`
- `Release`

### 9. JP 节点部署

```bash
ssh jp '
cd /root/gold-bot && \
git pull --ff-only origin main && \
docker compose up -d --build
'
```

> 说明：当前 checked-in `docker-compose.yaml` 是本地 build 模式；如果未来切到 GHCR 镜像部署，再改成 `docker compose pull && docker compose up -d`。

### 10. 发布后验证

```bash
# 健康检查
curl -s https://goldbot-aliyun-jp.deedvv.dev/healthz

# 生产日志
ssh jp 'docker logs gold-bot --tail 50 2>&1'

# 容器状态
ssh jp 'docker ps --filter name=gold-bot'
```

重点看：

- `ok`
- `✅ PostgreSQL 数据库已连接` **或** `✅ SQLite 数据库已打开`（取决于部署时是否设置 `DSN`）
- `✅ 数据库迁移完成`
- `[APP] 🌐 Gold Bolt Server 启动中 :8880 ...`

---

## 推荐发版模板

### 小版本修复

- 代码修复完成
- 跑相关测试
- `python3 scripts/release.py check`
- `git push origin main`
- `git tag -a vX.Y.Z -m "release vX.Y.Z"`
- `git push origin vX.Y.Z`
- 看 GH Actions
- JP 部署
- 验证

### EA 版本更新

- 先跑 `prepare` 同步 EA 元数据
- 确认 `version.json` / `mq4` / `mq5` 三处一致
- 再走正常 tag 发布流程

---

## 常见坑

### 1. 忘记同步 EA 版本文件

表现：EA 源码改了，但 `/api/v1/ea/releases` 仍显示旧版本。

修复：永远先用：

```bash
python3 scripts/release.py prepare --version X.Y.Z --build N --changelog "..."
```

### 2. 用错 GitHub SSH key

表现：`Permission denied (publickey)`。

修复：

```bash
eval "$(ssh-agent -s)"
ssh-add /root/.hermes/home/.ssh/id_ed25519
```

### 3. 用 HTTPS / fine-grained PAT 推送

表现：`403 Write access to repository not granted`。

修复：gold-bot 仓库发布统一走 SSH push，不走 HTTPS token。

### 4. tag 不规范

表现：Docker metadata/tag 规则异常，后续镜像标签不可预测。

修复：只用标准 `vX.Y.Z`。

### 5. 只发 tag，不看部署验证

这是最容易留下假成功的地方。CI 绿了不代表 JP 已经正常提供服务。发布后必须看：

- `healthz`
- `docker logs gold-bot`
- `docker ps`

---

## 维护原则

后续每次如果发布流程有新增坑：

1. 先补到 `scripts/release.py` 或 `tests/release/test_release_contract.sh`
2. 再更新这份文档
3. 不要把关键信息只留在聊天记录里

# 部署指南

## 目标形态

当前推荐部署形态：

- Go 二进制负责全部 HTTP 服务
- 控制台前端静态构建后由 Go 统一托管
- 生产环境通过 Docker / GHCR 发布与部署
- **生产数据库优先使用 PostgreSQL（`DSN`）**，避免 SQLite 并发锁问题
- 本地开发或一次性演示可使用 SQLite

> 正式版本发布步骤请看：[RELEASE.md](RELEASE.md)

## 依赖要求

| 项目 | 要求 |
|------|------|
| Go | 1.24+ |
| Node.js | 20+（仅用于构建前端） |
| npm | 10+ |
| 系统 | Ubuntu / Debian / macOS / Linux 通用环境 |

## 环境变量

Go 服务端当前有两套数据库配置路径：

### 1) SQLite（默认，本地开发 / 单机演示）

```bash
export GB_HTTP_ADDR=":8880"
export GB_DB_PATH="data/gold_bolt.sqlite"
```

### 2) PostgreSQL（生产推荐）

```bash
export GB_HTTP_ADDR=":8880"
export DSN="postgres://user:password@127.0.0.1:5432/gold_bot?sslmode=disable"
```

说明：

- **`DSN` 非空时优先连接 PostgreSQL**
- `DSN` 为空时回退到 SQLite，默认路径是 `data/gold_bolt.sqlite`
- 当前仓库自带的 `Dockerfile` / `docker-compose.yaml` 只是提供运行容器的默认骨架；是否真正使用 PostgreSQL，取决于部署时 `.env` 是否提供 `DSN`
- 因为 SQLite 在高并发写入下容易出现锁竞争，**生产环境优先推荐 PostgreSQL**

## 一次性构建

### 1. 构建控制台

```bash
cd /path/to/gold-bot/web/dashboard
npm install
npm test
npm run build
```

输出目录：

```text
web/dashboard/dist
```

### 2. 构建 Go 服务端

```bash
cd /path/to/gold-bot
go test ./...
go build -o bin/gold-bot ./cmd/server
```

## 本地启动

```bash
cd /path/to/gold-bot
GB_HTTP_ADDR=":8880" \
GB_DB_PATH="data/gold_bolt.sqlite" \
./bin/gold-bot
```

如果没有单独 build，也可以直接：

```bash
go run ./cmd/server
```

## 启动后验证

### 健康检查

```bash
curl http://127.0.0.1:8880/healthz
```

期望：

```text
ok
```

### Legacy 接口

```bash
curl -X POST http://127.0.0.1:8880/register \
  -H 'Content-Type: application/json' \
  -H 'X-API-Token: <token>' \
  -d '{"account_id":"90011087","broker":"Demo Broker","server_name":"Demo-1"}'
```

### 控制台

浏览器访问：

```text
http://127.0.0.1:8880/?token=<admin-token>
```

控制台会：

- 加载静态页面
- 通过 `/api/v1/*` 拉取数据
- 通过 `/api/v1/events/stream?token=...` 建立 SSE 连接

## systemd 示例

下面这个 systemd 示例是 **SQLite 单机模式**。如果生产切 PostgreSQL，把 `Environment=GB_DB_PATH=...` 改成 `Environment=DSN=...` 即可。

```ini
[Unit]
Description=Gold Bot Go Server
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/home/node/gold-bot
Environment=GB_HTTP_ADDR=:8880
Environment=GB_DB_PATH=/home/node/gold-bot/data/gold_bolt.sqlite
ExecStart=/home/node/gold-bot/bin/gold-bot
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

部署流程示例：

```bash
cd /home/node/gold-bot
git pull
cd web/dashboard && npm ci && npm run build
cd /home/node/gold-bot
go build -o bin/gold-bot ./cmd/server
systemctl daemon-reload
systemctl restart gold-bot
systemctl status gold-bot
```

## Nginx 反向代理

SSE 基于标准 HTTP，不需要 WebSocket upgrade。

```nginx
server {
    listen 80;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:8880;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

## 数据与备份

推荐至少备份：

- SQLite 模式：`data/gold_bolt.sqlite`
- PostgreSQL 模式：数据库逻辑备份（`pg_dump`）
- EA 发布元数据与文件
- `.env` / 部署脚本

示例：

```bash
tar czf gold-bot-backup.tar.gz \
  data/gold_bolt.sqlite* \
  mt4_ea \
  .env
```

## 已知部署边界

- 如果 `web/dashboard/dist` 不存在，Go 仍然可以提供 API，但不会返回新控制台页面
- `/accounts/{account_id}` 通过静态占位页 + Go fallback 支持刷新直达
- 当前 cutover readiness 默认仍会显示 `Baseline Only`，直到真实 shadow 流量统计接入

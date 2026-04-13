# 部署指南

## 目标形态

当前推荐部署形态：

- Go 二进制负责全部 HTTP 服务
- SQLite 同时用于开发和生产
- Next.js 控制台提前静态构建，产物由 Go 直接托管
- 不再依赖 Python 运行时，也不需要 Node SSR 常驻进程

## 依赖要求

| 项目 | 要求 |
|------|------|
| Go | 1.24+ |
| Node.js | 20+（仅用于构建前端） |
| npm | 10+ |
| 系统 | Ubuntu / Debian / macOS / Linux 通用环境 |

## 环境变量

Go 服务端当前只需要两项核心配置：

```bash
export GB_HTTP_ADDR=":8880"
export GB_DB_PATH="data/gold_bolt.sqlite"
```

说明：

- 开发与生产都使用 SQLite
- 路径可按环境调整
- 上层业务通过 `database/sql` 访问数据库，未来可迁移 PostgreSQL，但当前不需要额外配置

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

- SQLite 主库：`data/gold_bolt.sqlite`
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

# 部署指南

## 服务器要求

| 项目 | 要求 |
|------|------|
| 系统 | Ubuntu 18.04+ / Debian |
| Python | 3.8+ |
| 内存 | 2GB+ |
| 网络 | 公网 IP 或内网穿透 |

## 快速部署

### 1. 克隆代码

```bash
cd /home/node
git clone https://github.com/sunnchao/gold-bot.git gold_bolt_server
cd gold_bolt_server
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

**requirements.txt 内容：**
```
flask>=2.0
flask-socketio>=5.0
python-socketio>=5.0
pandas>=1.3
numpy>=1.21
requests>=2.25
```

### 3. 配置

编辑 `config.py` 或设置环境变量：

```bash
export GBOLT_HOST="0.0.0.0"
export GBOLT_PORT="8880"
export GBOLT_ADMIN_TOKEN="your_secure_token"
```

### 4. 启动

```bash
# 直接运行
python -m gold_bolt_server.app

# 或使用 systemd
cp gold-bolt.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable gold-bolt-server
systemctl start gold-bolt-server
```

### 5. 验证

```bash
curl http://localhost:8880/api/status
```

---

## Systemd 服务配置

### gold-bolt-server.service

```ini
[Unit]
Description=Gold Bolt Server
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/home/node/gold_bolt_server
ExecStart=/home/node/gold_bolt_server/start.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### start.sh

```bash
#!/bin/bash
cd /home/node
python3 -m gold_bolt_server.app
```

---

## MT4 EA 配置

### 参数设置

| 参数 | 值 | 说明 |
|------|-----|------|
| ServerURL | `http://服务器IP:8880` | GB Server 地址 |
| AccountID | `90011087` | 账户标识 |
| ApiToken | `your_token` | API 认证 Token |
| Symbol | `XAUUSD` | 交易品种 |
| MaxRiskPercent | `2.0` | 单笔风险 % |
| MaxPositions | `5` | 最大持仓数 |
| MaxDailyLoss | `5.0` | 日亏损限制 % |
| MaxSpread | `5.0` | 最大点差 |

### MT4 图表设置

1. **加载足够历史数据**
   - 图表往左拖动，加载 150+ 根 H4 K线
   - EA 初始化时会检测数据量

2. **EA 加载**
   - 将 EA 文件放入 `/experts/`
   - 拖到 XAUUSD 图表
   - 配置参数

---

## Nginx 反向代理（可选）

### 安装

```bash
apt install nginx
```

### 配置 `/etc/nginx/sites-available/gold-bolt`

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 启用

```bash
ln -s /etc/nginx/sites-available/gold-bolt /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### HTTPS (Let's Encrypt)

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

---

## 防火墙配置

```bash
# 开放端口
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw allow 8880  # GB Server (可选，仅内部访问)

# 启用防火墙
ufw enable
```

---

## 日志管理

### 日志位置

```
/home/node/gold_bolt_server/logs/
├── server_YYYYMMDD.log  # 每日日志
└── service.log         # systemd stdout
```

### 查看日志

```bash
# 实时日志
journalctl -u gold-bolt-server -f

# 搜索错误
grep ERROR /home/node/gold_bolt_server/logs/server_*.log

# 搜索 K线
grep BARS /home/node/gold_bolt_server/logs/server_*.log
```

### 日志轮转

配置 `logrotate`：

```bash
cat > /etc/logrotate.d/gold-bolt <<EOF
/home/node/gold_bolt_server/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
}
EOF
```

---

## 备份与恢复

### 备份

```bash
# 打包项目
tar czf gold_bolt_backup.tar.gz \
    /home/node/gold_bolt_server \
    --exclude='*.log' \
    --exclude='__pycache__'
```

### 恢复

```bash
tar xzf gold_bolt_backup.tar.gz -C /
```

---

## 故障排查

### 服务启动失败

```bash
# 检查语法
python3 -m py_compile /home/node/gold_bolt_server/app.py

# 查看错误
journalctl -u gold-bolt-server -n 50
```

### EA 不连接

1. 检查服务器防火墙
2. 确认 ServerURL 正确
3. 检查 EA 日志中的错误信息

### K线数据为空

```bash
# 查看 EA 是否发送
grep BARS /home/node/gold_bolt_server/logs/server_*.log

# 检查历史数据量
# MT4 图表上往左拖动加载更多历史
```

### AI 分析不触发

```bash
# 检查市场状态
curl http://localhost:8880/api/market_status/90011087

# 检查整点触发日志
grep "整点触发" /home/node/gold_bolt_server/logs/service.log
```

---

## 更新部署

### 1. 拉取新代码

```bash
cd /home/node/gold_bolt_server
git pull origin main
```

### 2. 检查修改

```bash
git diff --stat
```

### 3. 重启服务

```bash
systemctl restart gold-bolt-server
```

---

## 相关文档

- [架构文档](ARCHITECTURE.md)
- [API 端点](API.md)
- [策略描述](STRATEGIES.md)

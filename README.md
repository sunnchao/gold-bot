# Gold Bolt Server

服务端黄金交易策略系统。

## 架构

```
MT4 EA (Windows)  ──HTTP──→  Gold Bolt Server (Linux/OpenClaw)
                  ←指令──┘         │
                                   ├── 策略引擎（Go）
                                   ├── Web 监控面板（Next.js）
                                   └── Prometheus + Grafana 监控
```

## 职责划分

| 组件 | 职责 |
|------|------|
| **EA（客户端）** | 风控参数、下单执行、止损止盈、账户安全 |
| **Server（服务端）** | 策略分析、信号生成、数据展示、系统监控 |

## EA 参数

- `ServerURL` — 服务器地址
- `AccountID` — 账户标识
- `MagicNumber` — 魔术号
- `ApiToken` — 接口认证 Token
- `MaxRiskPercent` — 单笔最大风险%
- `MaxPositions` — 最大持仓数
- `MaxDailyLoss` — 日最大亏损%
- `MaxSpread` — 最大点差

## 快速开始

### 1. 启动服务

```bash
# 克隆仓库
git clone <repo-url>
cd gold-bot

# 复制配置文件
cp .env.example .env
# 编辑 .env 设置数据库连接等

# 启动所有服务（包括监控）
./scripts/start-monitoring.sh

# 或仅启动应用
go run cmd/server/main.go
```

### 2. 访问界面

- **交易监控面板**: http://localhost:8880
- **Grafana 监控**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090
- **健康检查**: http://localhost:8880/healthz
- **指标端点**: http://localhost:8880/metrics

## 监控系统

系统已集成 Prometheus + Grafana 监控，提供：

- 📈 **实时指标**: 账户净值、持仓数量、信号速率
- 🔔 **告警通知**: EA 心跳超时、账户回撤、系统异常
- 📊 **性能分析**: HTTP 延迟、数据库连接池、查询耗时
- 💹 **策略分析**: 信号分布、胜率统计、盈亏曲线

详见 [监控文档](./docs/MONITORING.md)

## 文档

- [系统架构](./docs/ARCHITECTURE.md) - 技术架构和模块边界
- [API 文档](./docs/API.md) - HTTP 接口说明
- [监控指南](./docs/MONITORING.md) - Prometheus/Grafana 使用
- [部署指南](./docs/DEPLOYMENT.md) - 生产环境部署
- [优化方案](./docs/OPTIMIZATION_PLAN.md) - 架构优化建议

## 开发

```bash
# 编译
go build ./...

# 运行测试
go test ./...

# 查看日志
docker-compose logs -f app
```

## 技术栈

- **后端**: Go 1.24+
- **数据库**: PostgreSQL (生产) / SQLite (开发)
- **前端**: Next.js + Tailwind CSS
- **监控**: Prometheus + Grafana
- **容器化**: Docker + Docker Compose

---

**项目地址**: https://github.com/yourusername/gold-bot  
**文档**: [docs/](./docs/)  
**更新日期**: 2026-06-26

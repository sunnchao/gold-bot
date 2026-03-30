# Gold Bolt Server 文档

## 目录

| 文档 | 说明 |
|------|------|
| [AGENTS.md](../AGENTS.md) | Agent 开发指南 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系统架构 |
| [API.md](API.md) | API 端点参考 |
| [STRATEGIES.md](STRATEGIES.md) | 策略描述 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 部署指南 |
| [CHANGELOG.md](CHANGELOG.md) | 更新日志 |

---

## 快速导航

### 开发人员

- 新加入？先读 [AGENTS.md](../AGENTS.md)
- 想了解系统架构？读 [ARCHITECTURE.md](ARCHITECTURE.md)
- 需要调试？读 [API.md](API.md)

### 运维人员

- 部署新服务器？读 [DEPLOYMENT.md](DEPLOYMENT.md)
- 故障排查？看 DEPLOYMENT.md 的 [故障排查](DEPLOYMENT.md#故障排查) 章节

### 交易员

- 了解策略逻辑？读 [STRATEGIES.md](STRATEGIES.md)
- 查看更新历史？读 [CHANGELOG.md](CHANGELOG.md)

---

## 最新更新 (2026-03-30)

### 新增功能

- ✅ 飞书推送通知
- ✅ AI 分析整点触发 (0/15/30/45分)
- ✅ 市场状态检测
- ✅ Discord + 飞书双渠道推送
- ✅ 按策略追踪胜率
- ✅ divergence ATR 倍数字段
- ✅ 净持仓方向冲突检查

### 已知问题

- ⚠️ EA K线数据发送问题（历史数据不足）
- ⚠️ spread_trade 服务端策略未实现

---

## 常用命令

```bash
# 重启服务
systemctl restart gold-bolt-server

# 查看状态
systemctl status gold-bolt-server

# 实时日志
journalctl -u gold-bolt-server -f

# 测试 API
curl http://localhost:8880/api/status

# 查看账户状态
curl -H 'X-API-Token: your_token' http://localhost:8880/api/market_status/90011087
```

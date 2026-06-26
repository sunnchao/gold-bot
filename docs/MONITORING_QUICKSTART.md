# Prometheus 监控快速开始

## 5 分钟快速部署

### 步骤 1：启动监控栈

```bash
# 进入项目目录
cd gold-bot

# 一键启动（包含 Gold Bot + Prometheus + Grafana）
./scripts/start-monitoring.sh
```

### 步骤 2：访问 Grafana

打开浏览器访问：http://localhost:3000

- **用户名**: `admin`
- **密码**: `admin` (首次登录会要求修改)

### 步骤 3：查看仪表盘

登录后，点击左侧菜单 **Dashboards** → **Gold Bot - 系统概览**

你将看到：
- 📈 账户净值实时曲线
- 📊 持仓数量统计
- 💰 浮动盈亏监控
- ⚡ 信号生成速率
- 🚀 HTTP 性能指标
- 💾 数据库状态
- 💓 EA 心跳监控

---

## 常用监控查询

### 1. 查看账户净值

在 Grafana 查询编辑器中输入：

```promql
goldbot_account_equity_usd
```

### 2. 检查 EA 是否在线

```promql
# 查看最后心跳距现在的秒数
time() - goldbot_ea_last_heartbeat_timestamp

# 如果结果 > 120，说明 EA 已断线
```

### 3. 查看 HTTP 请求速率

```promql
# 每秒请求数
sum(rate(goldbot_http_requests_total[1m]))
```

### 4. 查看订单成功率

```promql
# 成功率（0-1）
sum(rate(goldbot_orders_total{result="success"}[5m])) 
/ 
sum(rate(goldbot_orders_total[5m]))
```

---

## 常见问题

### Q: Grafana 显示 "No data"

**解决方案**：
1. 确认 Gold Bot 服务正在运行：`docker ps`
2. 检查 Prometheus 是否能抓取数据：打开 http://localhost:9090/targets
3. 确认 EA 已连接（需要 EA 发送数据才有指标）

### Q: 如何查看原始指标数据？

**解决方案**：
直接访问：http://localhost:8880/metrics

你会看到类似这样的数据：
```
goldbot_account_equity_usd{account_id="12345"} 10000.50
goldbot_ea_heartbeats_total{account_id="12345"} 1234
```

### Q: 如何停止监控服务？

**解决方案**：
```bash
docker-compose down
```

### Q: 如何查看日志？

**解决方案**：
```bash
# 查看所有服务日志
docker-compose logs -f

# 仅查看 Gold Bot 日志
docker-compose logs -f app

# 仅查看 Prometheus 日志
docker-compose logs -f prometheus
```

---

## 告警配置

系统已预置 9 个告警规则，包括：

**关键告警（Critical）**：
- ❌ EA 心跳超时（>2 分钟）
- ❌ 账户严重回撤（>10%）
- ❌ 服务不可用

**警告告警（Warning）**：
- ⚠️ 账户轻度回撤（>5%）
- ⚠️ HTTP 延迟过高
- ⚠️ 数据库连接池使用率高
- ⚠️ 点差异常
- ⚠️ 订单失败率高
- ⚠️ 信号速率异常低

查看告警状态：http://localhost:9090/alerts

---

## 配置飞书告警通知

### 1. 获取飞书 Webhook URL

在飞书群聊中：设置 → 群机器人 → 添加机器人 → 自定义机器人 → 复制 Webhook 地址

### 2. 在 Grafana 配置通知渠道

1. 登录 Grafana
2. 左侧菜单 → **Alerting** → **Contact points**
3. 点击 **New contact point**
4. 填写：
   - Name: `Feishu`
   - Type: `Webhook`
   - URL: `<你的飞书 Webhook URL>`
   - HTTP Method: `POST`
5. 保存

### 3. 创建告警规则关联飞书

1. **Alerting** → **Alert rules** → **New alert rule**
2. 设置查询条件（例如：`time() - goldbot_ea_last_heartbeat_timestamp > 120`）
3. 在 **Contact point** 选择 `Feishu`
4. 保存

现在当 EA 断线时，你会在飞书收到通知！

---

## 测试监控是否正常

运行测试脚本：

```bash
./scripts/test-metrics.sh
```

预期输出：
```
✅ /healthz 正常
✅ /metrics 正常
✅ Prometheus 正常运行
✅ Grafana 正常运行
✅ 监控端点测试完成！
```

---

## 下一步

- 📖 阅读完整文档：[docs/MONITORING.md](./MONITORING.md)
- 📊 自定义仪表盘：在 Grafana 中创建你自己的面板
- 🔔 配置告警：根据你的需求调整告警阈值
- 📈 优化性能：参考 [docs/OPTIMIZATION_PLAN.md](./OPTIMIZATION_PLAN.md)

---

**需要帮助？**  
查看 [故障排查指南](./MONITORING.md#故障排查)

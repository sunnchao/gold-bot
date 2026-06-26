# Prometheus 监控集成指南

## 概述

Gold Bot 已集成 Prometheus + Grafana 监控体系，提供实时指标采集、可视化仪表盘和告警能力。

## 快速开始

### 1. 启动监控栈

```bash
# 启动所有服务（包括 Prometheus 和 Grafana）
docker-compose up -d

# 查看服务状态
docker-compose ps
```

### 2. 访问监控界面

- **Grafana 仪表盘**: http://localhost:3000
  - 默认用户名: `admin`
  - 默认密码: `admin`（首次登录会要求修改）

- **Prometheus 查询界面**: http://localhost:9090

- **Gold Bot Metrics 原始数据**: http://localhost:8880/metrics

### 3. 查看预置仪表盘

登录 Grafana 后，导航到 **Dashboards** → **Gold Bot - 系统概览**，可查看：

- 账户净值趋势
- 持仓数量
- 浮动盈亏
- 信号生成速率
- HTTP 请求延迟
- 数据库连接池状态
- EA 心跳状态

---

## 监控指标说明

### 账户相关指标

| 指标名称 | 类型 | 说明 | 标签 |
|---------|------|------|------|
| `goldbot_account_equity_usd` | Gauge | 账户净值（USD） | `account_id` |
| `goldbot_account_balance_usd` | Gauge | 账户余额（USD） | `account_id` |
| `goldbot_account_positions` | Gauge | 持仓数量 | `account_id`, `symbol` |
| `goldbot_account_floating_pl_usd` | Gauge | 浮动盈亏（USD） | `account_id` |
| `goldbot_account_daily_pl_usd` | Gauge | 当日盈亏（USD） | `account_id` |

**示例查询**：
```promql
# 查看账户净值
goldbot_account_equity_usd

# 净值增长率（5分钟）
rate(goldbot_account_equity_usd[5m])

# 所有账户总持仓数
sum(goldbot_account_positions)
```

### 信号相关指标

| 指标名称 | 类型 | 说明 | 标签 |
|---------|------|------|------|
| `goldbot_signals_total` | Counter | 生成的信号总数 | `account_id`, `symbol`, `strategy`, `side` |
| `goldbot_signal_score` | Histogram | 信号分数分布 | `account_id`, `strategy` |

**示例查询**：
```promql
# 每分钟信号生成速率
rate(goldbot_signals_total[1m])

# 按策略分组的信号数
sum by (strategy) (goldbot_signals_total)

# 买入信号占比
sum(goldbot_signals_total{side="BUY"}) / sum(goldbot_signals_total)
```

### 订单相关指标

| 指标名称 | 类型 | 说明 | 标签 |
|---------|------|------|------|
| `goldbot_orders_total` | Counter | 订单执行总数 | `account_id`, `symbol`, `side`, `result` |
| `goldbot_order_latency_seconds` | Histogram | 订单执行延迟（秒） | `account_id`, `order_type` |
| `goldbot_order_profit_usd` | Histogram | 订单盈亏分布（USD） | `account_id`, `symbol` |

**示例查询**：
```promql
# 订单成功率
sum(rate(goldbot_orders_total{result="success"}[5m])) / sum(rate(goldbot_orders_total[5m]))

# 订单延迟 P99
histogram_quantile(0.99, sum by (le) (rate(goldbot_order_latency_seconds_bucket[5m])))

# 平均订单利润
avg(goldbot_order_profit_usd)
```

### EA 心跳指标

| 指标名称 | 类型 | 说明 | 标签 |
|---------|------|------|------|
| `goldbot_ea_last_heartbeat_timestamp` | Gauge | 最后心跳时间戳（Unix） | `account_id` |
| `goldbot_ea_heartbeats_total` | Counter | 心跳总次数 | `account_id` |
| `goldbot_ea_ticks_total` | Counter | 接收的 Tick 总数 | `account_id`, `symbol` |

**示例查询**：
```promql
# EA 断线检测（超过 2 分钟无心跳）
time() - goldbot_ea_last_heartbeat_timestamp > 120

# Tick 接收速率
rate(goldbot_ea_ticks_total[1m])
```

### HTTP 性能指标

| 指标名称 | 类型 | 说明 | 标签 |
|---------|------|------|------|
| `goldbot_http_requests_total` | Counter | HTTP 请求总数 | `method`, `path`, `status` |
| `goldbot_http_request_duration_seconds` | Histogram | HTTP 请求耗时（秒） | `method`, `path` |

**示例查询**：
```promql
# 各端点 QPS
sum by (path) (rate(goldbot_http_requests_total[1m]))

# HTTP P50/P95/P99 延迟
histogram_quantile(0.50, sum by (path, le) (rate(goldbot_http_request_duration_seconds_bucket[5m])))
histogram_quantile(0.95, sum by (path, le) (rate(goldbot_http_request_duration_seconds_bucket[5m])))
histogram_quantile(0.99, sum by (path, le) (rate(goldbot_http_request_duration_seconds_bucket[5m])))

# 4xx/5xx 错误率
sum(rate(goldbot_http_requests_total{status=~"4xx|5xx"}[5m])) / sum(rate(goldbot_http_requests_total[5m]))
```

### 数据库指标

| 指标名称 | 类型 | 说明 | 标签 |
|---------|------|------|------|
| `goldbot_db_connections_open` | Gauge | 当前打开的数据库连接数 | - |
| `goldbot_db_connections_in_use` | Gauge | 当前使用中的连接数 | - |
| `goldbot_db_queries_total` | Counter | 数据库查询总数 | `operation`, `status` |
| `goldbot_db_query_duration_seconds` | Histogram | 查询耗时（秒） | `operation` |

**示例查询**：
```promql
# 连接池使用率
goldbot_db_connections_in_use / goldbot_db_connections_open

# 慢查询（超过 100ms）
histogram_quantile(0.99, sum by (operation, le) (rate(goldbot_db_query_duration_seconds_bucket[5m]))) > 0.1

# 查询错误率
sum(rate(goldbot_db_queries_total{status="error"}[5m])) / sum(rate(goldbot_db_queries_total[5m]))
```

### 风控指标

| 指标名称 | 类型 | 说明 | 标签 |
|---------|------|------|------|
| `goldbot_risk_gate_rejections_total` | Counter | 风控拒绝次数 | `account_id`, `reason` |
| `goldbot_spread_points` | Gauge | 当前点差 | `account_id`, `symbol` |

**示例查询**：
```promql
# 风控拒绝率
sum by (reason) (rate(goldbot_risk_gate_rejections_total[5m]))

# 点差异常检测（超过 5 点）
goldbot_spread_points > 5
```

---

## 告警规则配置

### 创建告警规则

编辑 `prometheus.yml`，添加告警规则文件：

```yaml
rule_files:
  - "alerts.yml"
```

创建 `alerts.yml`：

```yaml
groups:
  - name: gold_bot_alerts
    interval: 30s
    rules:
      # EA 心跳超时告警
      - alert: EAHeartbeatTimeout
        expr: time() - goldbot_ea_last_heartbeat_timestamp > 120
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "EA 心跳超时 (账户: {{ $labels.account_id }})"
          description: "EA 已超过 2 分钟无心跳，当前延迟: {{ $value }}s"

      # 账户亏损告警
      - alert: AccountDrawdown
        expr: (goldbot_account_equity_usd - goldbot_account_balance_usd) / goldbot_account_balance_usd < -0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "账户回撤超过 5% (账户: {{ $labels.account_id }})"
          description: "当前净值: ${{ $value }}"

      # HTTP 高延迟告警
      - alert: HighHTTPLatency
        expr: histogram_quantile(0.99, sum by (path, le) (rate(goldbot_http_request_duration_seconds_bucket[5m]))) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "HTTP 延迟过高 (路径: {{ $labels.path }})"
          description: "P99 延迟: {{ $value }}s"

      # 数据库连接池耗尽告警
      - alert: DBConnectionPoolExhausted
        expr: goldbot_db_connections_in_use / goldbot_db_connections_open > 0.9
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "数据库连接池使用率过高"
          description: "当前使用率: {{ $value | humanizePercentage }}"

      # 点差异常告警
      - alert: HighSpread
        expr: goldbot_spread_points > 10
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "点差异常 ({{ $labels.symbol }})"
          description: "当前点差: {{ $value }} 点"
```

### 集成告警通知

可通过 Grafana 配置告警通知渠道（Discord、飞书、邮件等）：

1. 登录 Grafana
2. 导航到 **Alerting** → **Contact points**
3. 添加通知渠道（例如 Webhook 到飞书机器人）
4. 创建告警规则并关联通知渠道

---

## 自定义仪表盘

### 创建新仪表盘

1. 登录 Grafana
2. 点击 **+ → Dashboard**
3. 添加 Panel，选择 Prometheus 数据源
4. 输入 PromQL 查询

### 常用可视化示例

**账户净值曲线**：
```promql
goldbot_account_equity_usd
```
- 可视化类型: Time series
- 单位: `currencyUSD`

**策略胜率**：
```promql
sum by (strategy) (goldbot_orders_total{result="success"}) / 
sum by (strategy) (goldbot_orders_total)
```
- 可视化类型: Stat 或 Gauge
- 单位: `percentunit` (0-1)

**系统健康评分**：
```promql
(
  # EA 心跳正常
  (time() - goldbot_ea_last_heartbeat_timestamp < 120) +
  # 数据库连接正常
  (goldbot_db_connections_in_use / goldbot_db_connections_open < 0.8) +
  # HTTP 延迟正常
  (histogram_quantile(0.99, rate(goldbot_http_request_duration_seconds_bucket[5m])) < 0.5)
) / 3
```
- 可视化类型: Gauge
- 阈值: Green (0.8-1), Yellow (0.5-0.8), Red (0-0.5)

---

## 性能优化建议

### 1. 降低指标基数

避免在标签中使用高基数字段（如订单 ID、时间戳）：

```go
// ❌ 错误：使用订单 ID 作为标签
metrics.OrderCounter.WithLabelValues(accountID, orderID, ...).Inc()

// ✅ 正确：仅使用低基数字段
metrics.OrderCounter.WithLabelValues(accountID, symbol, side).Inc()
```

### 2. 设置合理的采集间隔

```yaml
# prometheus.yml
global:
  scrape_interval: 15s  # 默认 15 秒
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'gold-bot'
    scrape_interval: 10s  # 可针对特定 job 调整
```

### 3. 启用 Prometheus 数据压缩

```yaml
# docker-compose.yaml
prometheus:
  command:
    - '--storage.tsdb.retention.time=30d'  # 保留 30 天
    - '--storage.tsdb.min-block-duration=2h'  # 最小块持续时间
```

---

## 故障排查

### 问题 1: Grafana 无法连接 Prometheus

**症状**：仪表盘显示 "No data"

**解决方案**：
```bash
# 检查 Prometheus 是否运行
curl http://localhost:9090/-/healthy

# 检查网络连通性
docker exec gold-bot-grafana ping prometheus

# 查看 Grafana 日志
docker logs gold-bot-grafana
```

### 问题 2: Metrics 端点返回空

**症状**：`http://localhost:8880/metrics` 无数据

**解决方案**：
```bash
# 确认服务启动成功
docker logs gold-bot

# 检查是否有监控埋点被触发（需有 EA 连接）
curl http://localhost:8880/metrics | grep goldbot_ea_heartbeats_total
```

### 问题 3: 指标数据不更新

**症状**：Grafana 图表数据停滞

**解决方案**：
1. 检查 Prometheus 抓取状态: http://localhost:9090/targets
2. 确认 Gold Bot 服务正常运行
3. 查看 Prometheus 日志：`docker logs gold-bot-prometheus`

---

## 生产环境配置

### 1. 设置 Grafana 密码

```bash
# 修改 docker-compose.yaml
environment:
  - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}

# 在 .env 文件中设置强密码
echo "GRAFANA_PASSWORD=your_strong_password" >> .env
```

### 2. 启用 Prometheus 持久化

数据已自动持久化到 Docker volume `prometheus_data`，备份方式：

```bash
# 导出 Prometheus 数据
docker run --rm --volumes-from gold-bot-prometheus \
  -v $(pwd)/backup:/backup \
  busybox tar czf /backup/prometheus-$(date +%Y%m%d).tar.gz /prometheus
```

### 3. 配置告警通知

参见上文 **告警规则配置** 章节。

---

## 相关文档

- [Prometheus 官方文档](https://prometheus.io/docs/)
- [Grafana 文档](https://grafana.com/docs/)
- [PromQL 查询语法](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Gold Bot API 文档](./API.md)
- [架构文档](./ARCHITECTURE.md)

---

**更新日期**: 2026-06-26  
**维护者**: Gold Bot 团队

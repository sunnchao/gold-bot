package metrics

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// 信号相关指标
var (
	SignalCounter = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "goldbot_signals_total",
			Help: "Total number of trading signals generated",
		},
		[]string{"account_id", "symbol", "strategy", "side"},
	)

	SignalScoreHistogram = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "goldbot_signal_score",
			Help:    "Distribution of signal scores",
			Buckets: []float64{0, 2, 4, 6, 8, 10},
		},
		[]string{"account_id", "strategy"},
	)
)

// 订单相关指标
var (
	OrderCounter = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "goldbot_orders_total",
			Help: "Total number of orders executed",
		},
		[]string{"account_id", "symbol", "side", "result"}, // result: success|error
	)

	OrderLatency = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "goldbot_order_latency_seconds",
			Help:    "Order execution latency from signal to EA execution",
			Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 30},
		},
		[]string{"account_id", "order_type"}, // order_type: open|close|modify
	)

	OrderProfitHistogram = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "goldbot_order_profit_usd",
			Help:    "Order profit/loss distribution in USD",
			Buckets: []float64{-1000, -500, -100, -50, 0, 50, 100, 500, 1000},
		},
		[]string{"account_id", "symbol"},
	)
)

// 账户相关指标
var (
	AccountEquity = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "goldbot_account_equity_usd",
			Help: "Account equity in USD",
		},
		[]string{"account_id"},
	)

	AccountBalance = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "goldbot_account_balance_usd",
			Help: "Account balance in USD",
		},
		[]string{"account_id"},
	)

	AccountPositions = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "goldbot_account_positions",
			Help: "Number of open positions",
		},
		[]string{"account_id", "symbol"},
	)

	AccountFloatingPL = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "goldbot_account_floating_pl_usd",
			Help: "Floating profit/loss in USD",
		},
		[]string{"account_id"},
	)

	AccountDailyPL = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "goldbot_account_daily_pl_usd",
			Help: "Daily profit/loss in USD (resets at midnight)",
		},
		[]string{"account_id"},
	)
)

// EA 心跳相关指标
var (
	EAHeartbeatTimestamp = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "goldbot_ea_last_heartbeat_timestamp",
			Help: "Unix timestamp of last EA heartbeat",
		},
		[]string{"account_id"},
	)

	EAHeartbeatCounter = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "goldbot_ea_heartbeats_total",
			Help: "Total number of EA heartbeats received",
		},
		[]string{"account_id"},
	)

	EATickCounter = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "goldbot_ea_ticks_total",
			Help: "Total number of ticks received from EA",
		},
		[]string{"account_id", "symbol"},
	)
)

// HTTP 请求相关指标
var (
	HTTPRequestCounter = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "goldbot_http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"method", "path", "status"},
	)

	HTTPRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "goldbot_http_request_duration_seconds",
			Help:    "HTTP request duration in seconds",
			Buckets: []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5},
		},
		[]string{"method", "path"},
	)
)

// 数据库相关指标
var (
	DBQueryDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "goldbot_db_query_duration_seconds",
			Help:    "Database query duration in seconds",
			Buckets: []float64{0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1},
		},
		[]string{"operation"}, // operation: select|insert|update|delete
	)

	DBQueryCounter = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "goldbot_db_queries_total",
			Help: "Total number of database queries",
		},
		[]string{"operation", "status"}, // status: success|error
	)

	DBConnectionsOpen = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "goldbot_db_connections_open",
			Help: "Number of open database connections",
		},
	)

	DBConnectionsInUse = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "goldbot_db_connections_in_use",
			Help: "Number of database connections currently in use",
		},
	)
)

// 策略相关指标
var (
	StrategyExecutionDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "goldbot_strategy_execution_seconds",
			Help:    "Strategy execution duration in seconds",
			Buckets: []float64{0.01, 0.05, 0.1, 0.5, 1, 2, 5},
		},
		[]string{"account_id", "strategy"},
	)

	StrategyWinRate = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "goldbot_strategy_win_rate",
			Help: "Strategy win rate (0-1)",
		},
		[]string{"account_id", "strategy"},
	)
)

// 风控相关指标
var (
	RiskGateRejections = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "goldbot_risk_gate_rejections_total",
			Help: "Total number of signals rejected by risk gate",
		},
		[]string{"account_id", "reason"}, // reason: max_positions|max_risk|spread_too_wide|etc
	)

	SpreadGauge = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "goldbot_spread_points",
			Help: "Current spread in points",
		},
		[]string{"account_id", "symbol"},
	)
)

// 辅助函数：记录 HTTP 请求
func RecordHTTPRequest(method, path string, statusCode int, duration time.Duration) {
	HTTPRequestCounter.WithLabelValues(method, path, http_status_to_string(statusCode)).Inc()
	HTTPRequestDuration.WithLabelValues(method, path).Observe(duration.Seconds())
}

// 辅助函数：记录数据库查询
func RecordDBQuery(operation string, duration time.Duration, err error) {
	status := "success"
	if err != nil {
		status = "error"
	}
	DBQueryCounter.WithLabelValues(operation, status).Inc()
	DBQueryDuration.WithLabelValues(operation).Observe(duration.Seconds())
}

// 辅助函数：更新数据库连接池状态
func UpdateDBStats(stats interface {
	OpenConnections() int
	InUse() int
}) {
	DBConnectionsOpen.Set(float64(stats.OpenConnections()))
	DBConnectionsInUse.Set(float64(stats.InUse()))
}

func http_status_to_string(code int) string {
	switch {
	case code >= 200 && code < 300:
		return "2xx"
	case code >= 300 && code < 400:
		return "3xx"
	case code >= 400 && code < 500:
		return "4xx"
	case code >= 500:
		return "5xx"
	default:
		return "unknown"
	}
}

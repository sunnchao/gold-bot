#!/bin/bash
# 测试监控端点是否正常工作

set -e

BASE_URL="${BASE_URL:-http://localhost:8880}"

echo "🧪 测试 Gold Bot 监控端点..."
echo ""

# 测试健康检查
echo "1️⃣ 测试健康检查端点..."
if curl -sf "${BASE_URL}/healthz" > /dev/null; then
    echo "✅ /healthz 正常"
else
    echo "❌ /healthz 失败"
    exit 1
fi

# 测试 metrics 端点
echo ""
echo "2️⃣ 测试 Prometheus metrics 端点..."
if curl -sf "${BASE_URL}/metrics" | grep -q "goldbot_"; then
    echo "✅ /metrics 正常"
    
    # 显示部分指标
    echo ""
    echo "📊 当前指标（部分）："
    curl -s "${BASE_URL}/metrics" | grep "^goldbot_" | head -10
else
    echo "❌ /metrics 失败或无数据"
    exit 1
fi

# 测试 Prometheus 连接
echo ""
echo "3️⃣ 测试 Prometheus 连接..."
PROM_URL="${PROMETHEUS_URL:-http://localhost:9090}"
if curl -sf "${PROM_URL}/-/healthy" > /dev/null; then
    echo "✅ Prometheus 正常运行"
    
    # 检查是否能查询到数据
    if curl -s "${PROM_URL}/api/v1/query?query=up" | grep -q '"status":"success"'; then
        echo "✅ Prometheus 查询正常"
    else
        echo "⚠️  Prometheus 查询失败（可能正在初始化）"
    fi
else
    echo "⚠️  Prometheus 未运行（如未启动监控栈，可忽略）"
fi

# 测试 Grafana 连接
echo ""
echo "4️⃣ 测试 Grafana 连接..."
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
if curl -sf "${GRAFANA_URL}/api/health" > /dev/null; then
    echo "✅ Grafana 正常运行"
else
    echo "⚠️  Grafana 未运行（如未启动监控栈，可忽略）"
fi

echo ""
echo "✅ 监控端点测试完成！"
echo ""
echo "💡 下一步："
echo "  - 启动 EA 连接以生成实际指标数据"
echo "  - 访问 Grafana: ${GRAFANA_URL}"
echo "  - 查看实时指标: ${BASE_URL}/metrics"

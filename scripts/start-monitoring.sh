#!/bin/bash
set -e

echo "🚀 启动 Gold Bot 监控栈..."

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker"
    exit 1
fi

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "📝 未找到 .env 文件，从 .env.example 复制..."
    cp .env.example .env
    echo "⚠️  请编辑 .env 文件并设置必要的配置"
    exit 1
fi

# 停止旧容器
echo "🛑 停止旧容器..."
docker-compose down

# 启动服务
echo "▶️  启动服务..."
docker-compose up -d

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 5

# 检查服务状态
echo ""
echo "📊 服务状态："
docker-compose ps

echo ""
echo "✅ 监控栈已启动！"
echo ""
echo "📈 访问地址："
echo "  - Grafana 仪表盘: http://localhost:3000 (admin/admin)"
echo "  - Prometheus:     http://localhost:9090"
echo "  - Gold Bot API:   http://localhost:8880"
echo "  - Metrics 端点:   http://localhost:8880/metrics"
echo ""
echo "💡 提示："
echo "  - 首次登录 Grafana 请修改默认密码"
echo "  - 查看日志: docker-compose logs -f"
echo "  - 停止服务: docker-compose down"

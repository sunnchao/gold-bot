#!/bin/bash
cd "$(dirname "$0")"
# 加载 .env 环境变量（python-dotenv 也会自动加载，这里作为双重保险）
set -a
[ -f .env ] && source .env
set +a
python3 -m gold_bolt_server.app
"""
飞书 Webhook 连通性测试（无外部依赖）
使用: python3 tests/test_feishu_webhook.py
"""
import os
import sys
import json
import hmac
import hashlib
import base64
import time
import urllib.request
import urllib.error
from datetime import datetime


def load_env():
    """手动加载 .env 文件"""
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, value = line.partition('=')
                    os.environ.setdefault(key.strip(), value.strip())


def gen_sign(secret: str, timestamp: int) -> str:
    """生成飞书签名（按 gold-bot 现网实现）

    注意：这里保持与项目内 Go 实现一致：
    key = f"{timestamp}\\n{secret}", msg = empty
    """
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(
        string_to_sign.encode("utf-8"),
        digestmod=hashlib.sha256
    ).digest()
    return base64.b64encode(hmac_code).decode('utf-8')


def send_test_message(webhook_url: str, secret: str) -> bool:
    """发送测试消息"""
    timestamp = int(time.time())
    sign = gen_sign(secret, timestamp) if secret else ""

    payload = {
        "timestamp": timestamp,
        "sign": sign,
        "msg_type": "interactive",
        "card": {
            "header": {
                "title": {"tag": "plain_text", "content": "Gold Bolt 连通性测试"},
                "template": "blue"
            },
            "elements": [
                {"tag": "markdown", "content": "🧪 **连通性测试**\n\n这是一条测试消息，用于验证飞书 Webhook 配置是否正确。"},
                {"tag": "note", "elements": [{"tag": "plain_text", "content": f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"}]}
            ]
        }
    }

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        webhook_url,
        data=data,
        headers={"Content-Type": "application/json"},
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            print(f"响应: {result}")
            return result.get("code") == 0 or result.get("StatusCode") == 0
    except urllib.error.HTTPError as e:
        print(f"HTTP 错误: {e.code} - {e.reason}")
        try:
            print(f"响应内容: {e.read().decode('utf-8')}")
        except:
            pass
        return False
    except urllib.error.URLError as e:
        print(f"网络错误: {e.reason}")
        return False
    except Exception as e:
        print(f"异常: {e}")
        return False


def test_feishu_connectivity():
    """测试飞书 Webhook 连通性"""
    load_env()

    webhook_url = os.getenv("FEISHU_WEBHOOK_URL", "")
    secret = os.getenv("FEISHU_SECRET", "")

    print("=" * 50)
    print("飞书 Webhook 连通性测试")
    print("=" * 50)

    if not webhook_url:
        print("❌ FEISHU_WEBHOOK_URL 未配置")
        return False

    if not secret:
        print("⚠️  FEISHU_SECRET 未配置（如果 Webhook 不需要签名可忽略）")

    print(f"✅ Webhook URL: {webhook_url[:50]}...")
    print(f"✅ Secret 已配置: {'是' if secret else '否'}")
    print()
    print("正在发送测试消息...")

    result = send_test_message(webhook_url, secret)

    if result:
        print("✅ 飞书 Webhook 连通性测试通过！")
    else:
        print("❌ 飞书 Webhook 连通性测试失败，请检查配置")

    return result


if __name__ == "__main__":
    success = test_feishu_connectivity()
    sys.exit(0 if success else 1)

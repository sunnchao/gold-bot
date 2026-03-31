#!/usr/bin/env python3
"""
post_result.py — XAUUSD 技术分析结果上报
账户 90011087

【逻辑】
- 有持仓 + 盈利 + 移动止损建议 → 推送飞书
- 有持仓 + 亏损 → 不推送（只写API）
- 无持仓 + 有信号 → 推送开单建议
"""
import sys
import json
import time
import hmac
import hashlib
import base64
import urllib.request
from datetime import datetime

API_URL = "https://goldbot-aliyun-jp.deedvv.dev/api/ai_result/90011087"
API_TOKEN = "RbIzdutbQYFR_cAdZv1jZrN0MyKoLpyf0jb0vSqzhGI"
WEBHOOK_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/8ecc6b90-aba4-49e5-bcfe-b8779af28e15"
WEBHOOK_SECRET = "qBkTnDV6wk6BXiutYf9OB"


def gen_sign():
    ts = str(int(time.time()))
    s = ts + "\n" + WEBHOOK_SECRET
    sig = base64.b64encode(
        hmac.new(s.encode(), digestmod=hashlib.sha256).digest()
    ).decode()
    return ts, sig


def post_api(combined_bias, confidence, reasoning, exit_suggestion, risk_alert, alert_reason):
    """写入 GB Server /api/ai_result"""
    payload = {
        "agent": "Aurex",
        "symbol": "XAUUSD",
        "analysis": {
            "combined_bias": combined_bias,
            "confidence": confidence,
            "reasoning": reasoning,
        },
        "exit_suggestion": exit_suggestion,
        "risk_alert": risk_alert,
        "alert_reason": alert_reason,
    }
    data = json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(API_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-API-Token", API_TOKEN)
    req.add_header("User-Agent", "Aurex/1.0")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"API OK: HTTP {r.status}")
            return True
    except Exception as e:
        print(f"API ERROR: {e}")
        return False


def post_feishu_card(combined_bias, confidence, reasoning, exit_suggestion, risk_alert, alert_reason, signal_type="开单"):
    """飞书 interactive 卡片推送"""
    ts, sig = gen_sign()

    bias_map = {"bullish": "偏多", "bearish": "偏空", "neutral": "中性"}
    exit_map = {
        "hold": "持仓",
        "tighten": "移动止损",
        "close_long": "平多",
        "close_short": "平空",
        "close_all": "清仓",
        "close_partial": "减仓",
    }
    bias_cn = bias_map.get(combined_bias.lower(), combined_bias)
    exit_cn = exit_map.get(exit_suggestion.lower(), exit_suggestion)

    # 获取当前价格
    price_str = "—"
    try:
        resp = urllib.request.urlopen(
            "https://goldbot-aliyun-jp.deedvv.dev/api/analysis_payload/90011087",
            timeout=5
        )
        pd = json.loads(resp.read().decode())
        price_str = f"{float(pd.get('market', {}).get('bid', 0)):.2f}"
    except Exception:
        pass

    # 卡片颜色
    tmpl_map = {"bullish": "green", "bearish": "red", "neutral": "grey"}
    template = tmpl_map.get(combined_bias.lower(), "blue")

    # 置信度进度条
    conf_bar = "▓" * (confidence // 10) + "░" * (10 - confidence // 10)

    # 风险提示
    risk_block = f"\n\n⚠️ **风险提示**\n{alert_reason}" if risk_alert else ""

    # 信号类型标签
    signal_label = "📈 **开单信号**" if signal_type == "开单" else "🔄 **持仓调整**"

    content = (
        f"{signal_label}\n\n"
        f"**账户**: `90011087`\n"
        f"**品种**: XAUUSD\n"
        f"**信号**: {bias_cn} | 置信度 {confidence}%\n"
        f"`{conf_bar}`\n\n"
        f"**操作建议**: {exit_cn}\n\n"
        f"**分析摘要**\n{reasoning}"
        f"{risk_block}"
    )

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    payload = {
        "timestamp": ts,
        "sign": sig,
        "msg_type": "interactive",
        "card": {
            "header": {
                "title": {"tag": "plain_text", "content": f"📊 Aurex 技术分析 | XAUUSD {price_str}"},
                "template": template,
            },
            "elements": [
                {"tag": "markdown", "content": content},
                {
                    "tag": "note",
                    "elements": [
                        {"tag": "plain_text", "content": f"⏰ {now} | Aurex · 风险第一 · 本金至上"}
                    ]
                }
            ]
        }
    }

    data = json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(WEBHOOK_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"Feishu OK: HTTP {r.status}")
            return True
    except Exception as e:
        print(f"Feishu ERROR: {e}")
        return False


def check_positions_profit():
    """检查是否有盈利持仓"""
    try:
        resp = urllib.request.urlopen(
            "https://goldbot-aliyun-jp.deedvv.dev/api/analysis_payload/90011087",
            timeout=5
        )
        pd = json.loads(resp.read().decode())
        positions = pd.get("positions", [])
        
        if not positions:
            return None, False  # 无持仓
        
        has_profit = any(p.get("profit", 0) > 0 for p in positions)
        return positions, has_profit
    except Exception:
        return None, False


def main():
    if len(sys.argv) < 7:
        print("Usage: post_result.py <combined_bias> <confidence> <reasoning> <exit_suggestion> <risk_alert> <alert_reason>")
        sys.exit(1)

    combined_bias   = sys.argv[1]
    confidence      = int(sys.argv[2])
    reasoning       = sys.argv[3]
    exit_suggestion = sys.argv[4]
    risk_alert      = sys.argv[5].lower() == "true"
    alert_reason    = sys.argv[6]

    # 1. 写入 GB Server（总是执行）
    api_ok = post_api(combined_bias, confidence, reasoning, exit_suggestion, risk_alert, alert_reason)

    # 2. 检查持仓状态
    positions, has_profit = check_positions_profit()

    # 3. 飞书推送逻辑
    push_reason = None

    if positions is None:
        # 无持仓情况
        if exit_suggestion == "hold" and combined_bias != "neutral":
            # 无持仓 + 有信号 → 开单信号
            push_reason = "开单信号"
    elif not positions:
        # 无持仓
        if exit_suggestion == "hold" and combined_bias != "neutral":
            push_reason = "开单信号"
    else:
        # 有持仓
        if has_profit and exit_suggestion == "tighten":
            # 有盈利持仓 + 移动止损建议
            push_reason = "移动止损"
        elif not has_profit:
            # 有持仓但亏损 → 不推送
            push_reason = None

    if push_reason:
        signal_type = "移动止损" if push_reason == "移动止损" else "开单"
        feishu_ok = post_feishu_card(
            combined_bias, confidence, reasoning, 
            exit_suggestion, risk_alert, alert_reason,
            signal_type=signal_type
        )
        print(f"推送结果: API={api_ok}, Feishu={feishu_ok} ({push_reason})")
    else:
        print(f"推送结果: API={api_ok}, Feishu=SKIP (无推送条件)")


if __name__ == "__main__":
    main()

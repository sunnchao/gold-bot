#!/usr/bin/env python3
"""
post_result_90974574.py — XAUUSD 技术分析结果上报
账户 90974574
写入 GB Server + 飞书卡片直接推送
"""
import sys
import json
import time
import hmac
import hashlib
import base64
import urllib.request
from datetime import datetime

API_URL = "https://goldbot-aliyun-jp.deedvv.dev/api/ai_result/90974574"
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
        "account_id": "90974574",
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
    except Exception as e:
        print(f"API ERROR: {e}")


def post_feishu_card(combined_bias, confidence, reasoning, exit_suggestion, risk_alert, alert_reason, strategy_name="pullback"):
    """飞书 interactive 卡片推送"""
    ts, sig = gen_sign()

    # 策略名称映射（中文优先，英文辅助）
    strategy_name_map = {
        "pullback":          "趋势回调 PULLBACK",
        "breakout_retest":   "突破回踩 BREAKOUT",
        "divergence":        "RSI背离 DIVERGENCE",
        "breakout_pyramid":  "突破加仓 PYRAMID",
        "counter_pullback":  "反向回调 COUNTER",
        "range":             "震荡区间 RANGE",
    }
    strategy_display = strategy_name_map.get(strategy_name.lower(), strategy_name.upper())

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
            "https://goldbot-aliyun-jp.deedvv.dev/api/analysis_payload/90974574",
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

    # 标题：中文策略名 + 账户 + 货币 + 价格
    card_title = f"📊 {strategy_display} | 90974574 | XAUUSD {price_str}"

    content = (
        f"**账户**: `90974574`\n"
        f"**品种**: XAUUSD\n"
        f"**策略**: {strategy_display}\n"
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
                "title": {"tag": "plain_text", "content": card_title},
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
    except Exception as e:
        print(f"Feishu ERROR: {e}")


def main():
    if len(sys.argv) < 7:
        print("Usage: post_result-90974574.py <combined_bias> <confidence> <reasoning> <exit_suggestion> <risk_alert> <alert_reason> [strategy_name]")
        sys.exit(1)

    combined_bias   = sys.argv[1]
    confidence      = int(sys.argv[2])
    reasoning       = sys.argv[3]
    exit_suggestion = sys.argv[4]
    risk_alert      = sys.argv[5].lower() == "true"
    alert_reason    = sys.argv[6]
    strategy_name   = sys.argv[7] if len(sys.argv) > 7 else "pullback"

    post_api(combined_bias, confidence, reasoning, exit_suggestion, risk_alert, alert_reason)

    # P0修复：risk_alert=true 强制推送
    if risk_alert:
        post_feishu_card(combined_bias, confidence, reasoning,
                         exit_suggestion, risk_alert, alert_reason,
                         strategy_name=strategy_name)
        print(f"推送结果: risk_alert=true → 强制推送")
    else:
        # 有持仓 + 移动止损建议时推送
        if exit_suggestion.lower() == "tighten":
            post_feishu_card(combined_bias, confidence, reasoning,
                             exit_suggestion, risk_alert, alert_reason,
                             strategy_name=strategy_name)
            print(f"推送结果: tighten → 推送")
        else:
            print(f"推送结果: Feishu=SKIP")


if __name__ == "__main__":
    main()

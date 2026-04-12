#!/usr/bin/env python3
"""
post_result.py — XAUUSD 技术分析结果上报（通用版）
支持多账户，从文件名自动提取账户ID

用法:
  python post_result.py <account_id> <combined_bias> <confidence> <reasoning> <exit_suggestion> <risk_alert> <alert_reason> [strategy_name]

也支持软链接方式复用:
  ln -s post_result.py post_result-90974574.py
  python post_result-90974574.py bullish 80 ...

账户ID也可通过 ACCOUNT_ID 环境变量指定。
"""
import sys
import os
import json
import time
import hmac
import hashlib
import base64
import urllib.request
import re
from datetime import datetime
from pathlib import Path

# 加载 .env（Agent 脚本独立运行，需要手动加载）
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    if _env_path.exists():
        load_dotenv(_env_path)
except ImportError:
    pass  # python-dotenv 未安装时回退到系统环境变量

# ──────────────────────────────────────────────
# 账户ID：优先环境变量 > 命令行参数 > 文件名解析
# ──────────────────────────────────────────────
ACCOUNT_ID = os.environ.get("ACCOUNT_ID", "")

# 从文件名提取账户ID (e.g. post_result-90974574.py → 90974574)
if not ACCOUNT_ID:
    _match = re.search(r"(\d{5,})", Path(__file__).stem)
    if _match:
        ACCOUNT_ID = _match.group(1)

# 服务器配置
API_BASE = os.environ.get("GBOLT_API_BASE", "https://goldbot-aliyun-jp.deedvv.dev")
API_TOKEN = os.environ.get("GBOLT_API_TOKEN", "")
WEBHOOK_URL = os.environ.get("FEISHU_WEBHOOK_URL", "")
WEBHOOK_SECRET = os.environ.get("FEISHU_SECRET", "")

# 启动时检查必要环境变量
_MISSING = []
if not API_TOKEN:
    _MISSING.append("GBOLT_API_TOKEN")
if not WEBHOOK_URL:
    _MISSING.append("FEISHU_WEBHOOK_URL")
if not WEBHOOK_SECRET:
    _MISSING.append("FEISHU_SECRET")
if _MISSING:
    print(f"⚠️ 警告: 缺少环境变量 {', '.join(_MISSING)}，推送功能不可用")


# ──────────────────────────────────────────────
# 策略名称映射（与 config.py STRATEGY_MAGIC_MAP 保持一致）
# ──────────────────────────────────────────────
STRATEGY_DISPLAY_MAP = {
    "pullback":          "趋势回调 PULLBACK",
    "breakout_retest":   "突破回踩 BREAKOUT",
    "divergence":        "RSI背离 DIVERGENCE",
    "breakout_pyramid":  "突破加仓 PYRAMID",
    "counter_pullback":  "反向回调 COUNTER",
    "range":             "震荡区间 RANGE",
}


def gen_sign():
    """生成飞书签名（官方标准方式）"""
    ts = str(int(time.time()))
    string_to_sign = ts + "\n" + WEBHOOK_SECRET
    # 飞书签名规范: secret 为 key, timestamp+\n+secret 为 msg
    hmac_code = hmac.new(
        WEBHOOK_SECRET.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        digestmod=hashlib.sha256
    ).digest()
    sig = base64.b64encode(hmac_code).decode()
    return ts, sig


def post_api(account_id, combined_bias, confidence, reasoning, exit_suggestion, risk_alert, alert_reason, symbol="XAUUSD"):
    """写入 GB Server /api/ai_result"""
    payload = {
        "agent": "Aurex",
        "symbol": symbol,
        "account_id": account_id,
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
    url = f"{API_BASE}/api/ai_result/{account_id}"
    req = urllib.request.Request(url, data=data, method="POST")
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


def _fetch_account_info(account_id):
    """从服务器获取账户信息（品种、持仓等）"""
    try:
        req = urllib.request.Request(
            f"{API_BASE}/api/analysis_payload/{account_id}",
            headers={"X-API-Token": API_TOKEN}
        )
        resp = urllib.request.urlopen(req, timeout=5)
        pd = json.loads(resp.read().decode())
        return pd
    except Exception as e:
        print(f"获取账户信息失败: {e}")
        return None


def get_account_symbol(account_id):
    """获取账户的交易品种（如 GOLDm#、XAUUSD 等）"""
    pd = _fetch_account_info(account_id)
    if pd:
        symbol = pd.get("market", {}).get("symbol", "")
        if symbol:
            return symbol
    return "XAUUSD"  # 默认


def check_positions_profit(account_id):
    """检查是否有盈利持仓"""
    pd = _fetch_account_info(account_id)
    if pd is None:
        return None, False
    positions = pd.get("positions", [])

    if not positions:
        return None, False  # 无持仓

    has_profit = any(p.get("profit", 0) > 0 for p in positions)
    return positions, has_profit


def post_feishu_card(account_id, combined_bias, confidence, reasoning,
                     exit_suggestion, risk_alert, alert_reason,
                     strategy_name="pullback", symbol="XAUUSD"):
    """飞书 interactive 卡片推送"""
    ts, sig = gen_sign()

    strategy_display = STRATEGY_DISPLAY_MAP.get(strategy_name.lower(), strategy_name.upper())

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

    # 卡片颜色
    tmpl_map = {"bullish": "green", "bearish": "red", "neutral": "grey"}
    template = tmpl_map.get(combined_bias.lower(), "blue")

    # 置信度进度条
    conf_bar = "▓" * (confidence // 10) + "░" * (10 - confidence // 10)

    # 风险提示
    risk_block = f"\n\n⚠️ **风险提示**\n{alert_reason}" if risk_alert else ""

    # 信号类型标签
    signal_label = "📈 **开单信号**" if exit_suggestion.lower() == "hold" and combined_bias.lower() != "neutral" else "🔄 **持仓调整**"

    # 标题
    card_title = f"📊 {strategy_display} | {account_id} | {symbol}"

    content = (
        f"{signal_label}\n\n"
        f"**账户**: `{account_id}`\n"
        f"**品种**: {symbol}\n"
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
            return True
    except Exception as e:
        print(f"Feishu ERROR: {e}")
        return False


def main():
    # 参数解析：支持 account_id 作为第一个参数或从文件名推断
    # 格式: post_result.py [account_id] <bias> <conf> <reasoning> <exit> <risk> <alert> [strategy]
    #       或: post_result-90974574.py <bias> <conf> <reasoning> <exit> <risk> <alert> [strategy]

    # 判断第一个参数是账户ID还是 combined_bias
    account_id = ACCOUNT_ID
    args = sys.argv[1:]

    if not args:
        print("Usage: post_result.py [account_id] <combined_bias> <confidence> <reasoning> <exit_suggestion> <risk_alert> <alert_reason> [strategy_name]")
        print("  account_id 可通过: 环境变量 ACCOUNT_ID / 文件名(post_result-XXXXX.py) / 第一个参数 指定")
        sys.exit(1)

    # 如果全局已无账户ID，尝试第一个参数是纯数字（账户号）
    if not account_id and args[0].isdigit() and len(args[0]) >= 5:
        account_id = args.pop(0)

    if not account_id:
        print("❌ 错误: 未指定账户ID。用法: post_result.py <account_id> ... 或通过环境变量 ACCOUNT_ID 指定")
        sys.exit(1)

    if len(args) < 6:
        print(f"Usage: post_result-{account_id}.py <combined_bias> <confidence> <reasoning> <exit_suggestion> <risk_alert> <alert_reason> [strategy_name]")
        sys.exit(1)

    combined_bias   = args[0]
    confidence      = int(args[1])
    reasoning       = args[2]
    exit_suggestion = args[3]
    risk_alert      = args[4].lower() == "true"
    alert_reason    = args[5]
    strategy_name   = args[6] if len(args) > 6 else "pullback"

    # 0. 获取账户交易品种（从服务器动态获取，如 GOLDm#、GBPJPYm# 等）
    symbol = get_account_symbol(account_id)

    # 1. 写入 GB Server（总是执行）
    api_ok = post_api(account_id, combined_bias, confidence, reasoning, exit_suggestion, risk_alert, alert_reason, symbol=symbol)

    # 2. 检查持仓状态
    positions, has_profit = check_positions_profit(account_id)

    # 3. 飞书推送逻辑（P0修复：risk_alert=true 强制推送）
    push_reason = None

    if risk_alert:
        # 风险警告 → 必须推送
        push_reason = "风险预警"
    elif positions is None:
        # 无法获取持仓信息 → 有信号就推
        if exit_suggestion == "hold" and combined_bias.lower() != "neutral":
            push_reason = "开单信号"
    elif not positions:
        # 无持仓 → 有信号就推
        if exit_suggestion == "hold" and combined_bias.lower() != "neutral":
            push_reason = "开单信号"
    else:
        # 有持仓 → 盈利+移动止损才推
        if has_profit and exit_suggestion.lower() == "tighten":
            push_reason = "移动止损"

    if push_reason:
        feishu_ok = post_feishu_card(
            account_id, combined_bias, confidence, reasoning,
            exit_suggestion, risk_alert, alert_reason,
            strategy_name=strategy_name, symbol=symbol
        )
        print(f"推送结果: API={api_ok}, Feishu={feishu_ok} ({push_reason})")
    else:
        print(f"推送结果: API={api_ok}, Feishu=SKIP")


if __name__ == "__main__":
    main()
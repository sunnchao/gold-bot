"""
飞书机器人推送通知模块
"""
import os
import time
import json
import hmac
import hashlib
import base64
import logging
import requests
from datetime import datetime

logger = logging.getLogger(__name__)

FEISHU_WEBHOOK_URL = os.getenv("FEISHU_WEBHOOK_URL", "")

FEISHU_SECRET = os.getenv("FEISHU_SECRET", "")

_COOLDOWN = 600  # 10分钟冷却


class FeishuNotifier:
    """飞书机器人推送通知器（单例）"""

    def __init__(self):
        self._last_sent = 0.0

    def can_send(self) -> bool:
        """检查是否在冷却期内"""
        return time.time() - self._last_sent >= _COOLDOWN

    def _gen_sign(self, timestamp: int) -> str:
        """生成飞书签名（按 gold-bot 现网实现）"""
        string_to_sign = f"{timestamp}\n{FEISHU_SECRET}"
        hmac_code = hmac.new(
            string_to_sign.encode("utf-8"),
            digestmod=hashlib.sha256
        ).digest()
        sign = base64.b64encode(hmac_code).decode('utf-8')
        return sign

    def _build_card(self, content: str, title: str, template: str = "blue",
                     wide_screen: bool = True) -> dict:
        """构建飞书卡片 payload（统一结构）"""
        return {
            "msg_type": "interactive",
            "card": {
                "config": {"wide_screen_mode": wide_screen},
                "header": {
                    "title": {"tag": "plain_text", "content": title},
                    "template": template,
                },
                "elements": [
                    {"tag": "div", "text": {"tag": "lark_md", "content": content}},
                    {
                        "tag": "note",
                        "elements": [
                            {"tag": "plain_text", "content": f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"}
                        ]
                    }
                ]
            }
        }

    def send(self, content: str, title: str = "Gold Bolt AI",
             template: str = "blue") -> bool:
        """
        发送飞书消息（宽屏卡片，div+lark_md 结构）
        template: green=看多, red=看空, grey=中性, purple=风险, blue=信息
        """
        if not self.can_send():
            logger.debug("飞书推送冷却中，跳过")
            return False

        timestamp = int(time.time())
        sign = self._gen_sign(timestamp)

        payload = self._build_card(content, title, template)
        payload["timestamp"] = timestamp
        payload["sign"] = sign

        try:
            resp = requests.post(
                FEISHU_WEBHOOK_URL,
                json=payload,
                timeout=10,
                headers={"Content-Type": "application/json"},
            )
            result = resp.json()
            if result.get("code") == 0 or result.get("StatusCode") == 0:
                self._last_sent = time.time()
                logger.info("✅ 飞书推送成功")
                return True
            else:
                logger.warning(f"飞书推送失败: {result}")
                return False
        except Exception as e:
            logger.error(f"飞书推送异常: {e}")
            return False

    def send_ai_analysis(self, ai_result: dict, acc_id: str, symbol: str) -> bool:
        """
        格式化并发送 AI 研判通知
        """
        combined = ai_result.get("combined", {})
        bias = combined.get("bias", "neutral")
        conf = combined.get("confidence", 0)
        analysis = combined.get("analysis", "暂无分析")
        exit_sug = combined.get("exit_suggestion", "hold")
        exit_rsn = combined.get("exit_reason", "")
        risk_warn = combined.get("risk_warning", "")

        # 颜色标记（与卡片 header 对应）
        bias_map = {"bullish": "偏多", "bearish": "偏空", "neutral": "中性"}
        template_map = {"bullish": "green", "bearish": "red", "neutral": "grey"}
        bias_emoji = "🟢" if bias == "bullish" else "🔴" if bias == "bearish" else "⚪"
        bias_text = bias_map.get(bias, bias)
        template = template_map.get(bias, "blue")

        # 构建内容（div+lark_md 分区格式）
        lines = [
            f"**综合判断**: {bias_emoji} **{bias_text}**（置信度 {conf}%)",
            "",
            f"**出场建议**: `{exit_sug.upper()}`"
        ]
        if exit_rsn:
            lines.append(f"> {exit_rsn[:200]}")
        if risk_warn:
            lines.append("")
            lines.append(f"🚨 **风险提示**: {risk_warn[:200]}")

        # 分周期
        tf_lines = []
        for tf, label in [("M15", "15分钟"), ("M30", "30分钟"), ("H1", "1小时")]:
            data = ai_result.get(tf, {})
            tf_bias = data.get("bias", "?")
            tf_conf = data.get("confidence", 0)
            emoji = "🟢" if tf_bias == "bullish" else "🔴" if tf_bias == "bearish" else "⚪"
            tf_lines.append(f"{emoji} {label}: {tf_bias}({tf_conf}%)")
        if tf_lines:
            lines.append("")
            lines.append("**分周期判断**:")
            lines.extend(tf_lines)

        lines.append("")
        lines.append(f"**AI 分析摘要**\n{analysis[:300]}")

        content = "\n".join(lines)
        title = f"🤖 AI 智能研判 | {symbol}"
        return self.send(content, title, template=template)


# 全局单例
_notifier = None

def get_notifier() -> FeishuNotifier:
    global _notifier
    if _notifier is None:
        _notifier = FeishuNotifier()
    return _notifier
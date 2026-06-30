"""
Discord 推送通知模块
"""
import os
import time
import logging
import requests

logger = logging.getLogger(__name__)

DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")

_COOLDOWN = 900  # 15分钟冷却


class DiscordNotifier:
    """Discord 推送通知器（单例）"""

    def __init__(self):
        self._last_sent = 0.0

    def can_send(self) -> bool:
        """检查是否在冷却期内"""
        return time.time() - self._last_sent >= _COOLDOWN

    def send(self, payload: dict) -> bool:
        """
        发送 Discord Embed 消息
        payload: 包含 title, description, color, fields 等
        """
        if not self.can_send():
            logger.debug(f"Discord 推送冷却中，跳过")
            return False

        try:
            resp = requests.post(
                DISCORD_WEBHOOK_URL,
                json=payload,
                timeout=10,
                headers={"Content-Type": "application/json"},
            )
            if resp.status_code in (200, 204):
                self._last_sent = time.time()
                logger.info(f"✅ Discord 推送成功")
                return True
            else:
                logger.warning(f"Discord 推送失败: HTTP {resp.status_code} {resp.text[:100]}")
                return False
        except Exception as e:
            logger.error(f"Discord 推送异常: {e}")
            return False

    def send_ai_analysis(self, ai_result: dict, acc_id: str, symbol: str) -> bool:
        """
        格式化并发送 AI 研判通知
        ai_result: ai_analyzer 的 combined + 分周期结果
        """
        combined = ai_result.get("combined", {})
        bias     = combined.get("bias", "neutral")
        conf     = combined.get("confidence", 0)
        analysis = combined.get("analysis", "暂无分析")
        exit_sug = combined.get("exit_suggestion", "hold")
        exit_rsn = combined.get("exit_reason", "")
        risk_warn = combined.get("risk_warning", "")

        # 颜色：绿(看多) / 红(看空) / 灰(中性)
        color_map = {"bullish": 0x00FF88, "bearish": 0xFF4444, "neutral": 0x888888}
        color = color_map.get(bias, 0x888888)

        # 字段
        fields = [
            {
                "name": "📊 综合判断",
                "value": f"**{bias.upper()}** ({conf}%)\n{analysis[:300]}",
                "inline": False,
            },
            {
                "name": "⏰ 出场建议",
                "value": f"**{exit_sug.upper()}**\n{exit_rsn[:200]}" if exit_sug != "hold" else "**HOLD** 持仓观望",
                "inline": True,
            },
            {
                "name": "📈 分周期",
                "value": self._format_tf_field(ai_result),
                "inline": True,
            },
        ]
        if risk_warn:
            fields.insert(2, {
                "name": "⚠️ 风险提示",
                "value": risk_warn[:200],
                "inline": False,
            })

        import datetime
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        payload = {
            "username": "Gold Bolt AI",
            "avatar_url": "https://i.imgur.com/AFL4z7G.png",
            "embeds": [
                {
                    "title": f"🤖 AI 智能研判 | {symbol}",
                    "description": f"**账户：** `{acc_id}`\n**时间：** {now}",
                    "color": color,
                    "fields": fields,
                    "footer": {
                        "text": "Gold Bolt Server | AI 15min 周期自动推送",
                    },
                }
            ]
        }
        return self.send(payload)

    def _format_tf_field(self, ai_result: dict) -> str:
        """格式化分周期字段"""
        tf_map = {"M15": "15分钟", "M30": "30分钟", "H1": "1小时"}
        lines = []
        for tf, label in tf_map.items():
            data = ai_result.get(tf, {})
            bias = data.get("bias", "?")
            conf = data.get("confidence", 0)
            emoji = "🟢" if bias == "bullish" else "🔴" if bias == "bearish" else "⚪"
            lines.append(f"{emoji} {label}: {bias}({conf}%)")
        return "\n".join(lines)


# 全局单例
_notifier = None

def get_notifier() -> DiscordNotifier:
    global _notifier
    if _notifier is None:
        _notifier = DiscordNotifier()
    return _notifier


def format_ai_result_for_discord(ai_result: dict, acc_id: str, symbol: str) -> dict:
    """
    兼容旧调用约定（保留函数名）
    实际逻辑由 DiscordNotifier.send_ai_analysis 处理
    """
    return {"ai_result": ai_result, "acc_id": acc_id, "symbol": symbol}

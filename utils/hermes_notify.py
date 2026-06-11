"""
Hermes Webhook 多通道推送模块

通过 Hermes Gateway 的 webhook 平台，将消息同时推送到：
- 飞书
- Telegram（含微信桥接）
- Discord

使用 HMAC-SHA256 签名认证，并行发送以降低延迟。

环境变量:
  HERMES_WEBHOOK_HOST   — Hermes webhook 地址（默认 127.0.0.1）
  HERMES_WEBHOOK_PORT   — Hermes webhook 端口（默认 8644）
  HERMES_WEBHOOK_SECRET — HMAC 签名密钥（必须配置）
  HERMES_WEBHOOK_TARGETS — 推送目标，逗号分隔（默认 telegram,feishu,discord）
"""
import os
import time
import hmac
import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── 配置 ──────────────────────────────────────────────────────
HERMES_WEBHOOK_HOST = os.getenv("HERMES_WEBHOOK_HOST", "127.0.0.1")
HERMES_WEBHOOK_PORT = int(os.getenv("HERMES_WEBHOOK_PORT", "8644"))
HERMES_WEBHOOK_SECRET = os.getenv("HERMES_WEBHOOK_SECRET", "")

# 路由名称 → 平台
ROUTES = {
    "feishu": "gold-signal-feishu",
    "telegram": "gold-signal-telegram",
    "discord": "gold-signal-discord",
}

# 默认推送目标（可通过环境变量覆盖）
_DEFAULT_TARGETS = os.getenv("HERMES_WEBHOOK_TARGETS", "telegram,feishu,discord")
DEFAULT_TARGETS = [t.strip() for t in _DEFAULT_TARGETS.split(",") if t.strip()]

_COOLDOWN = 60  # 60秒冷却

_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="hermes-wh")


def _sign_payload(body: bytes, secret: str) -> str:
    """生成 HMAC-SHA256 签名（hex 格式，匹配 Hermes X-Webhook-Signature）"""
    return hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()


def _post_to_route(route_name: str, message: str, timeout: int = 10) -> tuple:
    """向单个 webhook 路由发送消息。返回 (route, success, detail)"""
    if not HERMES_WEBHOOK_SECRET:
        return route_name, False, "HERMES_WEBHOOK_SECRET not set"

    url = f"http://{HERMES_WEBHOOK_HOST}:{HERMES_WEBHOOK_PORT}/webhooks/{route_name}"
    payload = {"message": message}
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sig = _sign_payload(body, HERMES_WEBHOOK_SECRET)

    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Signature": sig,
    }

    try:
        resp = requests.post(url, data=body, headers=headers, timeout=timeout)
        if resp.status_code == 200:
            return route_name, True, "delivered"
        else:
            return route_name, False, f"HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return route_name, False, str(e)


def _route_to_platform(route_name: str) -> str:
    """路由名 → 平台名"""
    for plat, r in ROUTES.items():
        if r == route_name:
            return plat
    return route_name


class HermesWebhookNotifier:
    """Hermes Webhook 多通道推送器（单例）"""

    def __init__(self):
        self._last_sent = 0.0

    def can_send(self) -> bool:
        return time.time() - self._last_sent >= _COOLDOWN

    @property
    def available(self) -> bool:
        """检查是否可用（secret 已配置）"""
        return bool(HERMES_WEBHOOK_SECRET)

    def send(
        self,
        message: str,
        platforms: Optional[list] = None,
        parallel: bool = True,
    ) -> dict:
        """
        发送消息到指定平台。

        Args:
            message: 消息内容（Markdown 格式）
            platforms: 目标平台列表，None 表示使用默认目标
            parallel: 是否并行发送

        Returns:
            {platform: success} 映射
        """
        if not self.can_send():
            logger.debug("Hermes webhook 推送冷却中，跳过")
            return {}

        if not self.available:
            logger.warning("HERMES_WEBHOOK_SECRET 未配置，跳过 Hermes webhook 推送")
            return {}

        targets = platforms or DEFAULT_TARGETS
        route_names = [ROUTES[p] for p in targets if p in ROUTES]

        if not route_names:
            logger.warning(f"无有效目标平台: {targets}")
            return {}

        results = {}

        if parallel and len(route_names) > 1:
            futures = {
                _executor.submit(_post_to_route, r, message): r
                for r in route_names
            }
            for future in as_completed(futures):
                route, success, detail = future.result()
                platform = _route_to_platform(route)
                results[platform] = success
                if success:
                    logger.info(f"✅ Hermes → {platform}: {detail}")
                else:
                    logger.warning(f"❌ Hermes → {platform}: {detail}")
        else:
            for route in route_names:
                _, success, detail = _post_to_route(route, message)
                platform = _route_to_platform(route)
                results[platform] = success
                if success:
                    logger.info(f"✅ Hermes → {platform}: {detail}")
                else:
                    logger.warning(f"❌ Hermes → {platform}: {detail}")

        if any(results.values()):
            self._last_sent = time.time()

        return results


# 全局单例
_notifier = None


def get_notifier() -> HermesWebhookNotifier:
    global _notifier
    if _notifier is None:
        _notifier = HermesWebhookNotifier()
    return _notifier

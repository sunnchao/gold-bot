"""
Token 管理 — JSON 文件自动持久化
"""
import os
import json
import logging
import threading
import secrets

logger = logging.getLogger(__name__)

TOKENS_FILE = os.path.join(os.path.dirname(__file__), "data", "tokens.json")


class TokenManager:
    """管理 Token ↔ 账户绑定关系，自动持久化到 JSON 文件"""
    
    def __init__(self, admin_token: str):
        self.admin_token = admin_token
        self.tokens = {}   # token -> {"accounts": [...], "name": "...", "created": "..."}
        self.lock = threading.Lock()
        self._load()
    
    def _load(self):
        """启动时从 JSON 加载"""
        if os.path.exists(TOKENS_FILE):
            try:
                with open(TOKENS_FILE, 'r') as f:
                    self.tokens = json.load(f)
                logger.info(f"✅ 加载 {len(self.tokens)} 个 Token 绑定 ({TOKENS_FILE})")
            except Exception as e:
                logger.error(f"⚠️ Token 文件读取失败: {e}")
                self.tokens = {}
        else:
            logger.info("Token 文件不存在，将在首次绑定时创建")
    
    def _save(self):
        """写入 JSON（需在 lock 内调用）"""
        try:
            os.makedirs(os.path.dirname(TOKENS_FILE), exist_ok=True)
            with open(TOKENS_FILE, 'w') as f:
                json.dump(self.tokens, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"⚠️ Token 文件写入失败: {e}")
    
    def validate(self, token: str) -> bool:
        """验证 Token 是否有效"""
        if not token:
            return False
        if token == self.admin_token:
            return True
        return token in self.tokens
    
    def is_admin(self, token: str) -> bool:
        return token == self.admin_token
    
    def get_allowed_accounts(self, token: str) -> list:
        """获取 Token 允许查看的账户列表。None = 全部（admin）"""
        if token == self.admin_token:
            return None
        with self.lock:
            entry = self.tokens.get(token)
            if entry:
                return list(entry.get("accounts", []))
        return []
    
    def bind_account(self, token: str, account_id: str):
        """EA 连接时绑定 Token ↔ 账户"""
        if token == self.admin_token:
            # Admin 不写入 tokens.json，但仍然绑定到内存
            return
        
        with self.lock:
            if token not in self.tokens:
                self.tokens[token] = {"accounts": [], "name": ""}
            
            entry = self.tokens[token]
            if account_id not in entry["accounts"]:
                entry["accounts"].append(account_id)
                self._save()
                logger.info(f"🔗 Token 绑定: ...{token[-8:]} → {account_id}")
    
    def generate_token(self, name: str = "", accounts: list = None) -> str:
        """生成新 Token（管理员 API 用）"""
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.tokens[token] = {
                "accounts": accounts or [],
                "name": name,
            }
            self._save()
        logger.info(f"🆕 生成 Token: ...{token[-8:]} name={name} accounts={accounts}")
        return token
    
    def revoke_token(self, token: str) -> bool:
        """撤销 Token"""
        with self.lock:
            if token in self.tokens:
                del self.tokens[token]
                self._save()
                logger.info(f"🗑️ 撤销 Token: ...{token[-8:]}")
                return True
        return False
    
    def list_tokens(self) -> dict:
        """列出所有 Token（管理员用，隐藏完整 token）"""
        with self.lock:
            result = {}
            for token, entry in self.tokens.items():
                masked = token[:4] + "..." + token[-4:]
                result[masked] = {
                    "accounts": entry.get("accounts", []),
                    "name": entry.get("name", ""),
                    "full_token": token,
                }
            return result

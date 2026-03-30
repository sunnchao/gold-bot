"""
服务端配置
只包含策略相关配置，风控参数由 EA 端控制
"""
import os

# ============================================
# 服务器配置
# ============================================
SERVER = {
    "host":     os.getenv("GBOLT_HOST", "0.0.0.0"),
    "port":     int(os.getenv("GBOLT_PORT", "8880")),
    "debug":    os.getenv("GBOLT_DEBUG", "0") == "1",
}

# ============================================
# Token & 账户权限
# ============================================
# 管理员 Token — 可查看所有账户
ADMIN_TOKEN = os.getenv("GBOLT_ADMIN_TOKEN", "RbIzdutbQYFR_cAdZv1jZrN0MyKoLpyf0jb0vSqzhGI")

# 账户 Token 映射
# 格式: { "token_string": ["account_id_1", "account_id_2", ...] }
# EA 连接时用哪个 Token，该 Token 就自动绑定 EA 的 account_id
# Web 端用同一个 Token 登录，只能看到该 Token 绑定的账户
# ADMIN_TOKEN 可查看所有账户
ACCOUNT_TOKENS = {
    # 初始为空，EA 首次连接时自动注册
    # "some_token": ["90974574"],
}

# ============================================
# 策略配置（服务端负责）
# ============================================
STRATEGY = {
    "pullback": {
        "enabled": True,
        "name": "趋势回调",
        "min_adx": 20,
        "rsi_oversold": 35,
        "rsi_overbought": 65,
        "min_score": 5,
    },
    "breakout_retest": {
        "enabled": True,
        "name": "突破回踩",
        "lookback": 20,
        "min_score": 5,
    },
    "divergence": {
        "enabled": True,
        "name": "RSI背离",
        "lookback": 14,
        "min_score": 6,
    },
    "breakout_pyramid": {
        "enabled": True,
        "name": "突破加仓",
        "entry1_ratio": 0.4,
        "entry2_ratio": 0.6,
        "min_score": 6,
    },
    "reversal": {
        "enabled": False,
        "name": "反转对冲",
        "size_ratio": 0.3,
        "max_hedge": 2,
        "min_score": 5,
    },
}

# ============================================
# 信号生成参数
# ============================================
SIGNAL = {
    "min_score":            5,       # 最低信号评分
    "min_reward_risk":      1.5,     # 最低盈亏比
    "duplicate_atr_filter": 1.0,     # 同方向 N 个 ATR 内不重复
    "min_signal_interval":  300,     # 两次信号最小间隔（秒）
    "tp1_atr_multi":        1.5,
    "tp2_atr_multi":        3.0,
    "trailing_atr":         1.5,
}

# ============================================
# 交易时段（北京时间）
# ============================================
TRADING_HOURS = {
    "skip_start": "04:30",   # 跳过开始
    "skip_end":   "07:30",   # 跳过结束
    "timezone":   "Asia/Shanghai",
}

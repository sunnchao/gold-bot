"""
Gold Bolt Server - 主应用
Flask + SocketIO 提供 API 和实时前端
"""
import json
import os
import time
import logging
import threading
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO

from gold_bolt_server.config import SERVER, STRATEGY, SIGNAL, TRADING_HOURS, ADMIN_TOKEN, ENABLE_AI
from gold_bolt_server.data.manager import DataManager
from gold_bolt_server.strategy.engine import StrategyEngine
from gold_bolt_server.strategy.position_mgr import PositionManager

from gold_bolt_server.token_manager import TokenManager
from gold_bolt_server.utils import setup_logging

logger = logging.getLogger(__name__)

# ============================================
# Flask App
# ============================================
app = Flask(__name__,
    template_folder='templates',
    static_folder='static',
)
app.config['SECRET_KEY'] = 'gold-bolt-secret'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')


# ============================================
# 账户状态存储
# ============================================
class AccountStore:
    def __init__(self):
        self.accounts = {}   # account_id -> AccountData
        self.lock = threading.Lock()
    
    def get(self, account_id: str):
        if account_id not in self.accounts:
            self.accounts[account_id] = {
                "account_id": account_id,
                "equity": 0,
                "balance": 0,
                "margin": 0,
                "free_margin": 0,
                "positions": {},
                "tick": {},
                "bars": {},
                "last_heartbeat": 0,
                "last_signal": None,
                "last_signal_time": 0,
                "pending_commands": [],
                "history": [],
                # P2: 按策略追踪胜率
                "strategy_accuracy": {
                    "pullback": {"wins": 0, "losses": 0},
                    "breakout_retest": {"wins": 0, "losses": 0},
                    "divergence": {"wins": 0, "losses": 0},
                    "breakout_pyramid": {"wins": 0, "losses": 0},
                    "counter_pullback": {"wins": 0, "losses": 0},
                    "range": {"wins": 0, "losses": 0},
                },
                "connected": False,
                # P3: 策略映射配置(从EA上报)
                "strategy_mapping": {},  # magic -> strategy_name
                # Broker info (pushed by EA on init)
                "broker": "",
                "server_name": "",
                "account_name": "",
                "account_type": "",
                "currency": "",
                "leverage": 0,
            }
            logger.info(f"新账户注册: {account_id}")
        return self.accounts[account_id]
    
    def all_ids(self):
        return list(self.accounts.keys())

store = AccountStore()
strategy_engine = StrategyEngine()
position_manager = PositionManager()
token_mgr = TokenManager(ADMIN_TOKEN)
data_managers = {}  # account_id -> DataManager


# ============================================
# Token 验证 & 账户权限
# ============================================

def _extract_token():
    """从请求中提取 Token（header / query param）"""
    token = request.headers.get("X-API-Token", "")
    if not token:
        token = request.headers.get("X-API-Key", "")
    if not token:
        token = request.args.get("token", "")
    return token


def require_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _extract_token()
        if not token_mgr.validate(token):
            return jsonify({"status": "ERROR", "message": "invalid token"}), 401
        request._gb_token = token
        return f(*args, **kwargs)
    return decorated


# ============================================
# EA API 端点
# ============================================


# P2: 按策略追踪胜率
def _track_strategy_accuracy(acc, closed_position):
    """记录已平仓交易的结果到策略胜率统计"""
    magic = closed_position.get("magic", 0)
    profit = float(closed_position.get("profit", 0))
    
    magic_to_strategy = {
        20250231: "pullback",
        20250232: "breakout_retest",
        20250233: "divergence",
        20250234: "breakout_pyramid",
        20250235: "counter_pullback",
        20250236: "range",
    }
    strategy = magic_to_strategy.get(magic)
    if not strategy:
        return
    
    stats = acc.get("strategy_accuracy", {}).get(strategy, {"wins": 0, "losses": 0})
    if profit > 0:
        stats["wins"] = stats.get("wins", 0) + 1
    else:
        stats["losses"] = stats.get("losses", 0) + 1
    
    if "strategy_accuracy" not in acc:
        acc["strategy_accuracy"] = {}
    acc["strategy_accuracy"][strategy] = stats
    logger.info(f"[{acc.get('account_id')}] 策略胜率更新: {strategy} | wins={stats['wins']} losses={stats['losses']}")


# P3: 新开仓推送飞书通知
def _notify_new_order(acc_id, pos):
    """新开仓订单推送飞书 webhook 通知"""
    from gold_bolt_server.utils.feishu_notify import FEISHU_WEBHOOK_URL, FEISHU_SECRET
    
    ticket = pos.get("ticket", 0)
    direction = pos.get("direction", "UNKNOWN")
    lots = pos.get("lots", 0)
    entry_price = pos.get("entry_price", 0)
    strategy = pos.get("strategy", "unknown")
    magic = pos.get("magic", 0)
    sl = pos.get("sl", 0)
    tp = pos.get("tp", 0)
    
    # 方向图标和颜色
    if direction == "BUY":
        dir_icon = "🟢"
        dir_text = "做多"
        template = "green"
    elif direction == "SELL":
        dir_icon = "🔴"
        dir_text = "做空"
        template = "red"
    else:
        dir_icon = "⚪"
        dir_text = direction
        template = "blue"
    
    # 策略中文名
    strategy_names = {
        "pullback": "趋势回调",
        "breakout_retest": "突破回踩",
        "divergence": "RSI背离",
        "breakout_pyramid": "突破加仓",
        "counter_pullback": "反向回调",
        "range": "震荡区间",
    }
    strategy_cn = strategy_names.get(strategy, strategy)
    
    # 构建卡片
    title = f"📊 新开仓 | {acc_id} | XAUUSD"
    content = (
        f"**账户**: `{acc_id}`\n"
        f"**订单号**: #{ticket}\n"
        f"**方向**: {dir_icon} **{dir_text}**\n"
        f"**手数**: {lots} lot\n"
        f"**入场价**: {entry_price}\n"
        f"**策略**: {strategy_cn} (`{magic}`)\n"
        f"**止损**: {sl if sl > 0 else '—'} | **止盈**: {tp if tp > 0 else '—'}"
    )
    
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    # 发送飞书卡片
    import time
    import hmac
    import hashlib
    import base64
    import requests
    
    ts = str(int(time.time()))
    sign_str = ts + "\n" + FEISHU_SECRET
    sign = base64.b64encode(
        hmac.new(sign_str.encode(), digestmod=hashlib.sha256).digest()
    ).decode()
    
    payload = {
        "timestamp": ts,
        "sign": sign,
        "msg_type": "interactive",
        "card": {
            "header": {
                "title": {"tag": "plain_text", "content": title},
                "template": template,
            },
            "elements": [
                {"tag": "markdown", "content": content},
                {
                    "tag": "note",
                    "elements": [
                        {"tag": "plain_text", "content": f"⏰ {now} | Gold Bolt"}
                    ]
                }
            ]
        }
    }
    
    try:
        resp = requests.post(FEISHU_WEBHOOK_URL, json=payload, timeout=10)
        result = resp.json()
        if result.get("code") == 0 or result.get("StatusCode") == 0:
            logger.info(f"[{acc_id}] ✅ 新开仓推送成功: #{ticket} {direction} {lots}lot @ {entry_price}")
        else:
            logger.warning(f"[{acc_id}] ⚠️ 新开仓推送失败: {result}")
    except Exception as e:
        logger.error(f"[{acc_id}] ❌ 新开仓推送异常: {e}")


@app.route('/register', methods=['POST'])
@require_token
def api_register():
    """EA 启动时注册账户信息"""
    data = request.get_json(silent=True) or {}
    acc_id = data.get("account_id", "default")
    token = getattr(request, '_gb_token', '')
    
    with store.lock:
        acc = store.get(acc_id)
        acc["broker"] = data.get("broker", "")
        acc["server_name"] = data.get("server_name", "")
        acc["account_name"] = data.get("account_name", "")
        acc["account_type"] = data.get("account_type", "")
        acc["currency"] = data.get("currency", "USD")
        acc["leverage"] = data.get("leverage", 0)
        acc["connected"] = True
        acc["last_heartbeat"] = time.time()
        
        # P3: 存储策略映射配置(EA上报)
        strategy_mapping = data.get("strategy_mapping", {})
        if strategy_mapping:
            acc["strategy_mapping"] = strategy_mapping
            logger.info(f"[{acc_id}] 策略映射更新: {strategy_mapping}")
    
    # Bind token to account (auto-persist)
    token_mgr.bind_account(token, acc_id)
    
    logger.info(
        f"[{acc_id}] 📋 注册: broker={acc['broker']} server={acc['server_name']} "
        f"name={acc['account_name']} leverage=1:{acc['leverage']}"
    )
    
    # Push to frontend
    socketio.emit('account_registered', {
        "account_id": acc_id,
        "broker": acc["broker"],
        "server_name": acc["server_name"],
        "account_name": acc["account_name"],
        "account_type": acc["account_type"],
        "currency": acc["currency"],
        "leverage": acc["leverage"],
    })
    
    return jsonify({"status": "OK", "message": "registered"})


@app.route('/heartbeat', methods=['POST'])
@require_token
def api_heartbeat():
    """EA 心跳 + 账户数据"""
    raw = request.get_data()
    data = request.get_json(silent=True) or {}
    acc_id = data.get("account_id", "default")
    token = getattr(request, '_gb_token', '')
    logger.info(f"[HB] acc_id={acc_id} raw_len={len(raw)} ct={request.content_type} raw_head={raw[:200]}")
    
    # Auto-bind
    token_mgr.bind_account(token, acc_id)
    
    # 解析 MT4 市场状态
    mt4_server_time  = data.get("server_time", "")
    is_trade_allowed = data.get("is_trade_allowed", True)
    market_open      = data.get("market_open", True)

    with store.lock:
        acc = store.get(acc_id)
        acc["equity"] = data.get("equity", acc["equity"])
        acc["balance"] = data.get("balance", acc["balance"])
        acc["margin"] = data.get("margin", 0)
        acc["free_margin"] = data.get("free_margin", 0)
        acc["last_heartbeat"] = time.time()
        acc["connected"] = True
        # MT4 市场状态
        acc["mt4_server_time"]  = mt4_server_time
        acc["is_trade_allowed"] = is_trade_allowed
        acc["market_open"]      = market_open
    
    socketio.emit('account_update', {
        "account_id": acc_id,
        "equity": acc["equity"],
        "balance": acc["balance"],
        "margin": acc["margin"],
        "free_margin": acc["free_margin"],
        "market_open": market_open,
        "is_trade_allowed": is_trade_allowed,
        "mt4_server_time": mt4_server_time,
        "time": datetime.now().strftime("%H:%M:%S"),
    })
    
    return jsonify({"status": "OK", "server_time": time.time()})


@app.route('/tick', methods=['POST'])
@require_token
def api_tick():
    """EA 实时报价"""
    data = request.get_json(silent=True) or {}
    acc_id = data.get("account_id", "default")
    
    with store.lock:
        acc = store.get(acc_id)
        acc["tick"] = {
            "symbol": data.get("symbol", "XAUUSD"),
            "bid": data.get("bid", 0),
            "ask": data.get("ask", 0),
            "spread": data.get("spread", 0),
            "time": data.get("time", ""),
        }
    
    socketio.emit('tick_update', {
        "account_id": acc_id,
        "bid": data.get("bid", 0),
        "ask": data.get("ask", 0),
        "spread": data.get("spread", 0),
        "time": datetime.now().strftime("%H:%M:%S.%f")[:12],
    })
    
    return jsonify({"status": "OK"})


@app.route('/bars', methods=['POST'])
@require_token
def api_bars():
    """EA 发送K线数据"""
    data = request.get_json(silent=True) or {}
    acc_id = data.get("account_id", "default")
    tf = data.get("timeframe", "H1")
    bars = data.get("bars", [])
    
    raw_len = len(request.get_data() or b'')
    logger.info(f"[BARS] acc_id={acc_id} tf={tf} bars_count={len(bars)} raw_bytes={raw_len}")
    
    with store.lock:
        acc = store.get(acc_id)
        acc["bars"][tf] = bars
    
    if acc_id not in data_managers:
        data_managers[acc_id] = DataManager()
        logger.info(f"[{acc_id}] 创建DataManager")
    data_managers[acc_id].update_from_bars(tf, bars)
    logger.info(f"[{acc_id}] 收到 {tf} K线 {len(bars)}根 | DM keys: {list(data_managers.keys())}")
    
    return jsonify({"status": "OK", "received": len(bars)})


@app.route('/positions', methods=['POST'])
@require_token
def api_positions():
    """EA 发送持仓"""
    data = request.get_json(silent=True) or {}
    acc_id = data.get("account_id", "default")
    positions = data.get("positions", [])
    
    with store.lock:
        acc = store.get(acc_id)
        # P2: 检测平仓并记录胜率
        old_tickets = set(acc.get("positions", {}).keys())
        new_tickets = {p["ticket"] for p in positions}
        closed_tickets = old_tickets - new_tickets
        for ticket in closed_tickets:
            closed_pos = acc["positions"].get(ticket, {})
            if closed_pos:
                _track_strategy_accuracy(acc, closed_pos)
        
        # P3: 检测新开仓并推送飞书通知
        opened_tickets = new_tickets - old_tickets
        for ticket in opened_tickets:
            new_pos = next((p for p in positions if p["ticket"] == ticket), None)
            if new_pos:
                _notify_new_order(acc_id, new_pos)
        
        # 更新持仓
        acc["positions"] = {p["ticket"]: p for p in positions}
    
    total_profit = sum(p.get("profit", 0) for p in positions)
    socketio.emit('positions_update', {
        "account_id": acc_id,
        "count": len(positions),
        "total_profit": total_profit,
        "positions": positions,
        "time": datetime.now().strftime("%H:%M:%S"),
    })
    
    return jsonify({"status": "OK", "count": len(positions)})


@app.route('/poll', methods=['POST'])
@require_token
def api_poll():
    """EA 轮询获取交易指令"""
    data = request.get_json(silent=True) or {}
    acc_id = data.get("account_id", "default")
    
    with store.lock:
        acc = store.get(acc_id)
        commands = acc["pending_commands"].copy()
        acc["pending_commands"].clear()
    
    return jsonify({
        "status": "OK",
        "commands": commands,
        "count": len(commands),
    })


@app.route('/order_result', methods=['POST'])
@require_token
def api_order_result():
    """EA 回报指令执行结果"""
    data = request.get_json(silent=True) or {}
    acc_id = data.get("account_id", "default")
    cmd_id = data.get("command_id", "")
    result = data.get("result", "")
    ticket = data.get("ticket", 0)
    error = data.get("error", "")
    
    log_entry = {
        "time": datetime.now().strftime("%H:%M:%S"),
        "type": "order_result",
        "command_id": cmd_id,
        "result": result,
        "ticket": ticket,
        "error": error,
    }
    
    with store.lock:
        acc = store.get(acc_id)
        acc["history"].append(log_entry)
        if len(acc["history"]) > 100:
            acc["history"] = acc["history"][-100:]
    
    socketio.emit('order_result', {"account_id": acc_id, **log_entry})
    
    if result == "OK":
        logger.info(f"[{acc_id}] ✅ 指令 {cmd_id} 成功 | ticket={ticket}")
    else:
        logger.error(f"[{acc_id}] ❌ 指令 {cmd_id} 失败: {error}")
    
    return jsonify({"status": "OK"})


# ============================================
# Web 前端 & API
# ============================================

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/status')
@require_token
def api_status():
    """全局状态 API — 按 Token 过滤账户"""
    token = getattr(request, '_gb_token', '')
    allowed = token_mgr.get_allowed_accounts(token)
    
    accounts = {}
    for acc_id in store.all_ids():
        # 权限过滤
        if allowed is not None and acc_id not in allowed:
            continue
        
        acc = store.get(acc_id)
        alive = time.time() - acc["last_heartbeat"] < 120
        accounts[acc_id] = {
            "connected": alive,
            "equity": acc["equity"],
            "balance": acc["balance"],
            "positions": len(acc["positions"]),
            "tick": acc["tick"],
            "last_heartbeat": acc["last_heartbeat"],
            "broker": acc.get("broker", ""),
            "server_name": acc.get("server_name", ""),
            "account_name": acc.get("account_name", ""),
            "account_type": acc.get("account_type", ""),
            "currency": acc.get("currency", ""),
            "leverage": acc.get("leverage", 0),
        }
    
    return jsonify({
        "status": "OK",
        "accounts": accounts,
        "strategies": {k: v["name"] for k, v in STRATEGY.items() if v["enabled"]},
        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "is_admin": token_mgr.is_admin(token),
    })


@app.route('/api/history/<account_id>')
@require_token
def api_history(account_id):
    token = getattr(request, '_gb_token', '')
    allowed = token_mgr.get_allowed_accounts(token)
    if allowed is not None and account_id not in allowed:
        return jsonify({"status": "ERROR", "message": "forbidden"}), 403
    
    acc = store.get(account_id)
    return jsonify({"history": acc["history"]})


@app.route('/health')
def health():
    return jsonify({"status": "OK", "time": time.time()})


# ============================================
# EA 自动更新
# ============================================
EA_VERSION_FILE = os.path.join(os.path.dirname(__file__), "mt4_ea", "version.json")
EA_FILE_PATH = os.path.join(os.path.dirname(__file__), "mt4_ea", "GoldBolt_Client.mq4")


def _get_ea_version_info():
    """读取 EA 版本信息"""
    if os.path.exists(EA_VERSION_FILE):
        try:
            with open(EA_VERSION_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return {"version": "0.0.0", "build": 0, "changelog": ""}


@app.route('/api/ea/version')
def api_ea_version():
    """EA 检查版本"""
    info = _get_ea_version_info()
    return jsonify({
        "status": "OK",
        "version": info.get("version", "0.0.0"),
        "build": info.get("build", 0),
        "changelog": info.get("changelog", ""),
    })


@app.route('/api/ea/download')
def api_ea_download():
    """EA 下载最新 .mq4 文件"""
    if not os.path.exists(EA_FILE_PATH):
        return jsonify({"status": "ERROR", "message": "file not found"}), 404
    from flask import send_file
    return send_file(EA_FILE_PATH, as_attachment=True, download_name="GoldBolt_Client.mq4")


# ============================================
# Token 管理 API（仅 Admin）
# ============================================

def require_admin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _extract_token()
        if not token_mgr.is_admin(token):
            return jsonify({"status": "ERROR", "message": "admin only"}), 403
        return f(*args, **kwargs)
    return decorated


@app.route('/api/tokens', methods=['GET'])
@require_admin
def api_list_tokens():
    """列出所有 Token"""
    return jsonify({"status": "OK", "tokens": token_mgr.list_tokens()})


@app.route('/api/tokens', methods=['POST'])
@require_admin
def api_create_token():
    """生成新 Token"""
    data = request.get_json(silent=True) or {}
    name = data.get("name", "")
    accounts = data.get("accounts", [])
    token = token_mgr.generate_token(name=name, accounts=accounts)
    return jsonify({"status": "OK", "token": token, "name": name, "accounts": accounts})


@app.route('/api/tokens/<token_prefix>', methods=['DELETE'])
@require_admin
def api_revoke_token(token_prefix):
    """通过前缀撤销 Token"""
    all_tokens = token_mgr.list_tokens()
    for masked, info in all_tokens.items():
        if info["full_token"].startswith(token_prefix) or masked == token_prefix:
            token_mgr.revoke_token(info["full_token"])
            return jsonify({"status": "OK", "revoked": masked})
    return jsonify({"status": "ERROR", "message": "token not found"}), 404


# ============================================
# WebSocket
# ============================================

@socketio.on('connect')
def ws_connect():
    logger.debug("WebSocket 客户端连接")
    for acc_id in store.all_ids():
        acc = store.get(acc_id)
        socketio.emit('account_update', {
            "account_id": acc_id,
            "equity": acc["equity"],
            "balance": acc["balance"],
            "margin": acc["margin"],
            "free_margin": acc["free_margin"],
        })
        if acc["tick"]:
            socketio.emit('tick_update', {"account_id": acc_id, **acc["tick"]})


# ============================================
# 策略分析后台线程
# ============================================

# 净持仓方向冲突检查（P1优化）
def _check_net_position_conflict(acc, new_signal):
    """检查新信号是否与账户净持仓方向冲突"""
    strategy = new_signal.get("strategy", "")
    side = new_signal.get("side", "")
    magic_map = {
        "pullback": 20250231,
        "breakout_retest": 20250232,
        "divergence": 20250233,
        "breakout_pyramid": 20250234,
        "counter_pullback": 20250235,
        "range": 20250236,
    }
    target_magic = magic_map.get(strategy)
    if not target_magic:
        return None
    positions = acc.get("positions", {})
    strat_pos = {t: p for t, p in positions.items() if p.get("magic") == target_magic}
    if not strat_pos:
        return None
    net = sum(1 if p.get("type", "").upper() == "BUY" else -1 for p in strat_pos.values())
    new_dir = 1 if side == "BUY" else -1
    if new_dir > 0 and net < 0:
        return f"做多{strategy}但现有净空头持仓"
    if new_dir < 0 and net > 0:
        return f"做空{strategy}但现有净多头持仓"
    return None


def analysis_loop():
    """每30秒技术面分析"""
    logger.info("📊 技术面分析线程已启动 (30s间隔)")
    while True:
        try:
            time.sleep(30)
            
            all_ids = store.all_ids()
            logger.info(f"📊 技术分析轮次 | 账户数:{len(all_ids)}")
            
            for acc_id in all_ids:
                acc = store.get(acc_id)
                
                hb_age = time.time() - acc["last_heartbeat"]
                if hb_age > 120:
                    if acc["connected"]:
                        acc["connected"] = False
                        socketio.emit('account_disconnect', {"account_id": acc_id})
                    continue
                
                if acc_id not in data_managers:
                    continue
                dm = data_managers[acc_id]
                
                has_tick = bool(acc["tick"])
                has_bars = bool(acc["bars"])
                bar_keys = list(acc["bars"].keys()) if acc["bars"] else []

                if not has_tick or not has_bars:
                    continue

                # 市场关闭时跳过策略分析
                if not acc.get("market_open", True):
                    logger.info(f"[{acc_id}] 市场关闭 (market_open=false)，跳过策略分析")
                    continue
                if not acc.get("is_trade_allowed", True):
                    logger.info(f"[{acc_id}] 交易不可用 (is_trade_allowed=false)，跳过策略分析")
                    continue
                
                # === 持仓管理 ===
                try:
                    pos_commands = position_manager.analyze(acc, dm)
                    for cmd in pos_commands:
                        cmd["command_id"] = f"pm_{int(time.time())}_{cmd['ticket']}"
                        with store.lock:
                            acc["pending_commands"].append(cmd)
                            acc["history"].append({
                                "time": datetime.now().strftime("%H:%M:%S"),
                                "type": "position_mgr", **cmd,
                            })
                        socketio.emit('position_action', {"account_id": acc_id, **cmd})
                        logger.info(
                            f"[{acc_id}] 📋 持仓管理: {cmd['action']} #{cmd['ticket']} "
                            f"{cmd.get('lots', '')}手 | {cmd.get('reason', '')}"
                        )
                except Exception as e:
                    logger.error(f"[{acc_id}] 持仓管理异常: {e}", exc_info=True)
                
                # === 技术面策略分析（不含AI） ===
                try:
                    signal, analysis_logs = strategy_engine.analyze(dm, acc)
                    log_count = len(analysis_logs) if analysis_logs else 0
                    logger.info(f"[{acc_id}] 📊 技术分析完成 | 日志:{log_count} | 信号:{signal is not None}")
                    
                    if analysis_logs:
                        socketio.emit('analysis_log', {
                            "account_id": acc_id,
                            "time": datetime.now().strftime("%H:%M:%S"),
                            "logs": analysis_logs,
                            "source": "technical",
                        })
                except Exception as e:
                    logger.error(f"[{acc_id}] 策略分析异常: {e}", exc_info=True)
                    signal = None
                
                if not signal:
                    continue
                
                # 防重复
                if time.time() - acc["last_signal_time"] < SIGNAL["min_signal_interval"]:
                    continue

                # P1净持仓冲突检查
                conflict = _check_net_position_conflict(acc, signal)
                if conflict:
                    logger.warning(f"[{acc_id}] 信号跳过: {conflict}")
                    socketio.emit("signal_rejected", {"account_id": acc_id, "reason": conflict, "signal": signal})
                    continue
                
                cmd_id = f"sig_{int(time.time())}_{acc_id}"
                command = {
                    "command_id": cmd_id,
                    "action": "SIGNAL",
                    "type": signal["side"],
                    "symbol": "XAUUSD",
                    "entry": signal["entry"],
                    "sl": signal["stop_loss"],
                    "tp1": signal["tp1"],
                    "tp2": signal.get("tp2", 0),
                    "score": signal["score"],
                    "strategy": signal["strategy"],
                    "atr": signal.get("atr", 0),
                }
                
                with store.lock:
                    acc["pending_commands"].append(command)
                    acc["last_signal"] = command
                    acc["last_signal_time"] = time.time()
                    acc["history"].append({
                        "time": datetime.now().strftime("%H:%M:%S"),
                        "type": "signal", **command,
                    })
                
                socketio.emit('new_signal', {"account_id": acc_id, **command})
                logger.info(
                    f"[{acc_id}] 📤 信号: {signal['side']} @ {signal['entry']:.2f} | "
                    f"SL={signal['stop_loss']:.2f} | TP1={signal['tp1']:.2f} | {signal['strategy']} | 评分:{signal['score']}"
                )
                
        except Exception as e:
            logger.error(f"技术分析循环异常: {e}", exc_info=True)
            time.sleep(10)





# ============================================
# Aurex AI Agent 接口
# ============================================

@app.route('/api/trigger_ai', methods=['POST'])
@require_token
def api_trigger_ai():
    """
    [已废弃] AI 分析已迁移至 Gateway Cron 任务
    此接口保留仅作兼容，返回提示信息
    """
    return jsonify({
        "status": "OK",
        "message": "AI analysis is now handled by Gateway Cron tasks. This endpoint is deprecated.",
        "deprecated": True
    })


@app.route('/api/debug/dm/<account_id>')
@require_token
def api_debug_dm(account_id):
    """调试：检查 DataManager 状态"""
    acc = store.get(account_id)
    dm = data_managers.get(account_id)
    
    result = {
        "account_id": account_id,
        "bars_keys": list(acc.get("bars", {}).keys()) if acc.get("bars") else [],
        "tick": acc.get("tick", {}),
        "market_open": acc.get("market_open"),
        "dm_exists": dm is not None,
    }
    
    if dm:
        result["dm_data"] = {}
        for tf in ["M15", "M30", "H1", "H4", "D1"]:
            df = dm.get_dataframe(tf)
            if df is not None and len(df) > 0:
                result["dm_data"][tf] = {
                    "rows": len(df),
                    "has_ema20": "ema20" in df.columns,
                    "has_rsi": "rsi" in df.columns,
                }
            else:
                result["dm_data"][tf] = None
    
    return jsonify(result)


@app.route('/api/analysis_payload/<account_id>')
@require_token
def api_analysis_payload(account_id):
    """
    GET /api/analysis_payload/<account_id>
    用途： Aurex AI Agent 获取账户的行情分析数据（持仓 + 技术指标）
    说明： GB Server push 到此端点，供 Aurex 拉取分析
          返回持仓详情 + 多周期技术指标
    """
    token = getattr(request, '_gb_token', '')
    allowed = token_mgr.get_allowed_accounts(token)
    if allowed is not None and account_id not in allowed:
        return jsonify({"status": "ERROR", "message": "forbidden"}), 403

    with store.lock:
        acc = store.get(account_id)

    # ---- 持仓数据 ----
    positions = []
    for ticket_str, pos in acc.get("positions", {}).items():
        try:
            entry_price = float(pos.get("open_price", 0) or pos.get("price", 0))
            current_price = acc.get("tick", {}).get("ask", 0) or 0
            profit = float(pos.get("profit", 0))
            lots = float(pos.get("lots", 0))

            # 从 comment 解析策略类型 (e.g. "GB_breakout_pyramid_S8")
            comment = pos.get("comment", "")
            magic = int(pos.get("magic", 0))

            # P3: 使用动态策略映射
            strategy_mapping = acc.get("strategy_mapping", {})
            if not strategy_mapping:
                # 默认映射
                strategy_mapping = {
                    "20250231": "pullback",
                    "20250232": "breakout_retest",
                    "20250233": "divergence",
                    "20250234": "breakout_pyramid",
                    "20250235": "counter_pullback",
                    "20250236": "range",
                }
            strategy = strategy_mapping.get(str(magic), "unknown")

            # 计算持仓时长（秒）
            open_time = pos.get("open_time", 0)
            hold_seconds = time.time() - open_time if open_time else 0

            # 计算浮盈百分比
            if entry_price > 0 and lots > 0:
                pnl_pct = (profit / (entry_price * lots)) * 100
            else:
                pnl_pct = 0.0

            positions.append({
                "ticket": int(ticket_str) if str(ticket_str).isdigit() else ticket_str,
                "strategy": strategy,
                "magic": magic,
                "direction": pos.get("type", "").upper(),
                "entry_price": entry_price,
                "current_price": current_price,
                "lots": lots,
                "profit": profit,
                "pnl_percent": round(pnl_pct, 4),
                "sl": float(pos.get("sl", 0) or 0),
                "tp": float(pos.get("tp", 0) or 0),
                "hold_seconds": int(hold_seconds),
                "hold_hours": round(hold_seconds / 3600, 2),
                "comment": comment,
            })
        except Exception as e:
            logger.warning(f"[{account_id}] 解析持仓 {ticket_str} 异常: {e}")

    # ---- 技术指标（从 data_managers 获取）----
    indicators = {}
    dm = data_managers.get(account_id)
    if dm:
        for tf in ["M15", "M30", "H1", "H4", "D1"]:
            df = dm.get_dataframe(tf)
            if df is not None and len(df) >= 20:
                last = df.iloc[-1]
                indicators[tf] = {
                    "close": float(last.get("close", 0)),
                    "open": float(last.get("open", 0)),
                    "high": float(last.get("high", 0)),
                    "low": float(last.get("low", 0)),
                    "ema20": float(last.get("ema20", 0)),
                    "ema50": float(last.get("ema50", 0)),
                    "rsi": float(last.get("rsi", 0)),
                    "adx": float(last.get("adx", 0)),
                    "atr": float(last.get("atr", 0)),
                    "macd_hist": float(last.get("macd_hist", 0)),
                    "bb_upper": float(last.get("bb_upper", 0)),
                    "bb_middle": float(last.get("bb_middle", 0)),
                    "bb_lower": float(last.get("bb_lower", 0)),
                    "stoch_k": float(last.get("stoch_k", 0)),
                    "bars_count": len(df),
                }
            else:
                indicators[tf] = None

    # ---- 市场报价 ----
    tick = acc.get("tick", {})
    market = {
        "symbol": tick.get("symbol", "XAUUSD"),
        "bid": float(tick.get("bid", 0)),
        "ask": float(tick.get("ask", 0)),
        "spread": float(tick.get("spread", 0)),
        "time": tick.get("time", ""),
    }

    # ---- 账户摘要 ----
    account_summary = {
        "account_id": account_id,
        "equity": float(acc.get("equity", 0)),
        "balance": float(acc.get("balance", 0)),
        "margin": float(acc.get("margin", 0)),
        "free_margin": float(acc.get("free_margin", 0)),
        "currency": acc.get("currency", "USD"),
        "leverage": int(acc.get("leverage", 0)),
        "broker": acc.get("broker", ""),
        "server_name": acc.get("server_name", ""),
        "connected": acc.get("connected", False),
    }

    # 市场状态（供 AI Agent 判断是否跳过分析）
    market_status = {
        "market_open": acc.get("market_open", True),
        "is_trade_allowed": acc.get("is_trade_allowed", True),
        "mt4_server_time": acc.get("mt4_server_time", ""),
        "tradeable": acc.get("market_open", True) and acc.get("is_trade_allowed", True),
    }

    # P3: 策略映射配置(EA上报)
    strategy_mapping = acc.get("strategy_mapping", {})
    # 如果EA没有上报，使用默认映射
    if not strategy_mapping:
        strategy_mapping = {
            "20250231": "pullback",
            "20250232": "breakout_retest",
            "20250233": "divergence",
            "20250234": "breakout_pyramid",
            "20250235": "counter_pullback",
            "20250236": "range",
        }

    result = {
        "status": "OK",
        "timestamp": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "account": account_summary,
        "market": market,
        "positions": positions,
        "indicators": indicators,
        "market_status": market_status,
        "strategy_mapping": strategy_mapping,  # P3: 策略映射
    }

    logger.info(f"[{account_id}] analysis_payload 请求 | {len(positions)}个持仓 | tick={market['bid']}/{market['ask']}")
    return jsonify(result)


@app.route('/api/ai_result/<account_id>', methods=['POST'])
@require_token
def api_ai_result(account_id):
    """
    POST /api/ai_result/<account_id>
    用途： Aurex AI Agent 回传分析结果（combined_bias, confidence, exit_suggestion 等）
          GB Server 据此调整持仓或推送 WebSocket 更新
    """
    # AI 分析已禁用时，忽略结果
    if not ENABLE_AI:
        logger.info(f"[{account_id}] 🤖 AI 分析已禁用，忽略 AI 结果")
        return jsonify({"status": "OK", "received": False, "message": "AI analysis disabled"})

    token = getattr(request, '_gb_token', '')
    allowed = token_mgr.get_allowed_accounts(token)
    if allowed is not None and account_id not in allowed:
        return jsonify({"status": "ERROR", "message": "forbidden"}), 403

    data = request.get_json(silent=True) or {}

    # 解析 Aurex 输出字段
    combined_bias = data.get("combined_bias", "neutral")
    confidence = float(data.get("confidence", 0))
    reasoning = data.get("reasoning", "")
    exit_suggestion = data.get("exit_suggestion", "hold")
    risk_alert = bool(data.get("risk_alert", False))
    alert_reason = data.get("alert_reason", "")

    # 持仓差异化建议（可选）
    position_action = data.get("position_action", {})
    risk_metrics = data.get("risk_metrics", {})

    # P1: 分策略置信度（Aurex 可选返回）
    strategy_confidence = data.get("strategy_confidence", {})
    # 示例格式: {"pullback": 0.8, "divergence": 0.6, "breakout_pyramid": 0.4}

    with store.lock:
        acc = store.get(account_id)
        acc["last_signal"] = {
            "bias": combined_bias,
            "confidence": confidence,
            "exit_suggestion": exit_suggestion,
            "risk_alert": risk_alert,
            "time": datetime.now().strftime("%H:%M:%S"),
        }
        acc["last_signal_time"] = time.time()

    # 推送 WebSocket 更新
    socketio.emit('ai_result', {
        "account_id": account_id,
        "timestamp": datetime.now().strftime("%H:%M:%S"),
        "combined_bias": combined_bias,
        "confidence": confidence,
        "exit_suggestion": exit_suggestion,
        "risk_alert": risk_alert,
        "alert_reason": alert_reason,
        "position_action": position_action,
        "risk_metrics": risk_metrics,
        "reasoning": reasoning,
        "strategy_confidence": strategy_confidence,  # P1: 分策略置信度
    })

    # 风险警报 → 写入 pending_commands 供 EA 执行
    if risk_alert and exit_suggestion in ("close_partial", "close_all"):
        cmd_id = f"ai_close_{int(time.time())}"
        cmd = {
            "id": cmd_id,
            "action": "CLOSE_ALL" if exit_suggestion == "close_all" else "CLOSE_PARTIAL",
            "reason": f"AI风险警报: {alert_reason}",
            "confidence": confidence,
        }
        with store.lock:
            acc["pending_commands"].append(cmd)
        logger.warning(f"[{account_id}] AI风险警报 → 入队 {cmd['action']}: {alert_reason}")

    logger.info(
        f"[{account_id}] 🤖 AI结果 | bias={combined_bias} conf={confidence}% "
        f"exit={exit_suggestion} risk={risk_alert}"
    )
    return jsonify({"status": "OK", "received": True})


@app.route('/api/trailing_stop/<account_id>')
@require_token
def api_trailing_stop(account_id):
    """
    GET /api/trailing_stop/<account_id>
    用途： 查询账户所有持仓的追踪止损（Trailing Stop）状态
    说明： Aurex 可定期拉取此端点，评估是否需要调整止损
    """
    token = getattr(request, '_gb_token', '')
    allowed = token_mgr.get_allowed_accounts(token)
    if allowed is not None and account_id not in allowed:
        return jsonify({"status": "ERROR", "message": "forbidden"}), 403

    with store.lock:
        acc = store.get(account_id)

    dm = data_managers.get(account_id)
    current_atr = 0.0
    if dm:
        h1 = dm.get_dataframe("H1")
        if h1 is not None and len(h1) > 0:
            current_atr = float(h1.iloc[-1].get("atr", 0))

    tick = acc.get("tick", {})
    current_price = float(tick.get("ask", 0) or tick.get("bid", 0) or 0)

    trailing_data = []
    for ticket_str, pos in acc.get("positions", {}).items():
        try:
            entry_price = float(pos.get("open_price", 0) or pos.get("price", 0))
            current_sl = float(pos.get("sl", 0) or 0)
            profit = float(pos.get("profit", 0))
            direction = str(pos.get("type", "")).upper()

            # 基础 ATR 止损
            atr_mult = 1.5
            if current_atr > 0:
                atr_stop = current_price - (current_atr * atr_mult) if direction == "BUY" \
                          else current_price + (current_atr * atr_mult)

            # Trailing Stop: 只移动不退后
            if direction == "BUY":
                trailing_stop = max(current_sl, atr_stop) if current_sl > 0 else atr_stop
                profit_atr = profit / (current_atr * 100) if current_atr > 0 else 0
            else:
                trailing_stop = min(current_sl, atr_stop) if current_sl > 0 else atr_stop
                profit_atr = profit / (current_atr * 100) if current_atr > 0 else 0

            trailing_data.append({
                "ticket": int(ticket_str) if str(ticket_str).isdigit() else ticket_str,
                "direction": direction,
                "entry_price": entry_price,
                "current_price": current_price,
                "current_sl": current_sl,
                "suggested_sl": round(trailing_stop, 2),
                "atr": round(current_atr, 4),
                "profit": round(profit, 2),
                "profit_atr": round(profit_atr, 2),
                "has_position": True,
            })
        except Exception as e:
            logger.warning(f"[{account_id}] trailing_stop 解析 {ticket_str} 异常: {e}")

    result = {
        "status": "OK",
        "timestamp": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "account_id": account_id,
        "current_price": current_price,
        "atr": round(current_atr, 4),
        "positions": trailing_data,
    }

    logger.info(f"[{account_id}] trailing_stop | {len(trailing_data)}个持仓 | price={current_price} atr={current_atr:.4f}")
    return jsonify(result)


@app.route('/api/market/<symbol>')
@require_token
def api_market(symbol):
    """
    GET /api/market/<symbol>
    用途： 获取指定交易品种的实时市场快照
    说明： Aurex 可查询任意品种的当前市场状态（价格、波动率、趋势）
    """
    symbol = symbol.upper().strip()

    # 遍历所有账户找对应品种的报价
    best_tick = {}
    for acc_id in store.all_ids():
        with store.lock:
            acc = store.get(acc_id)
        tick = acc.get("tick", {})
        if tick.get("symbol", "").upper() == symbol:
            best_tick = {
                "bid": float(tick.get("bid", 0)),
                "ask": float(tick.get("ask", 0)),
                "spread": float(tick.get("spread", 0)),
                "time": tick.get("time", ""),
                "account_id": acc_id,
            }
            break  # 找到第一个匹配的就用

    if not best_tick:
        return jsonify({
            "status": "ERROR",
            "message": f"No market data for symbol {symbol}",
        }), 404

    # 从 data_managers 取技术指标（使用第一个有该品种数据的账户）
    indicators = {}
    for acc_id in store.all_ids():
        dm = data_managers.get(acc_id)
        if dm:
            for tf in ["M15", "M30", "H1", "H4", "D1"]:
                df = dm.get_dataframe(tf)
                if df is not None and len(df) >= 5:
                    last = df.iloc[-1]
                    indicators[tf] = {
                        "close": float(last.get("close", 0)),
                        "ema20": float(last.get("ema20", 0)),
                        "ema50": float(last.get("ema50", 0)),
                        "rsi": float(last.get("rsi", 0)),
                        "adx": float(last.get("adx", 0)),
                        "atr": float(last.get("atr", 0)),
                        "macd_hist": float(last.get("macd_hist", 0)),
                        "bb_upper": float(last.get("bb_upper", 0)),
                        "bb_lower": float(last.get("bb_lower", 0)),
                        "bars_count": len(df),
                    }

    # ATR 波动率评估
    atr_val = 0.0
    for tf_data in indicators.values():
        if tf_data:
            atr_val = tf_data.get("atr", 0)
            break

    mid = (best_tick["bid"] + best_tick["ask"]) / 2
    spread_pips = best_tick["spread"] * 100 if best_tick["spread"] > 0 else 0

    result = {
        "status": "OK",
        "timestamp": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "symbol": symbol,
        "bid": best_tick["bid"],
        "ask": best_tick["ask"],
        "mid": mid,
        "spread": best_tick["spread"],
        "spread_pips": round(spread_pips, 1),
        "time": best_tick["time"],
        "atr": round(atr_val, 4),
        "indicators": indicators,
    }

    logger.info(f"[market] {symbol} | bid={best_tick['bid']} ask={best_tick['ask']} spread={best_tick['spread']:.2f}")
    return jsonify(result)





# ============================================
# 启动
# ============================================

def main():
    setup_logging()
    logger.info("=" * 60)
    logger.info("Gold Bolt Server v1.1")
    logger.info(f"监听: {SERVER['host']}:{SERVER['port']}")
    logger.info(f"Admin Token: {'已设置' if ADMIN_TOKEN else '未设置'}")
    logger.info(f"策略: {', '.join(k for k,v in STRATEGY.items() if v['enabled'])}")
    logger.info("=" * 60)
    
    t1 = threading.Thread(target=analysis_loop, daemon=True)
    t1.start()
    
    socketio.run(
        app,
        host=SERVER['host'],
        port=SERVER['port'],
        debug=SERVER['debug'],
        allow_unsafe_werkzeug=True,
    )


if __name__ == "__main__":
    main()

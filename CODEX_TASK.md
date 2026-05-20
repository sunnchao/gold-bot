修改 gold-bot 实现动态自适应止损止盈（SL/TP）

## 任务目标

### 方案1: 策略引擎动态化 (strategy/engine.py)

当前问题：所有策略的 SL/TP 都是 ATR 固定倍数硬编码，需要改为动态计算。

在 StrategyEngine 类中新增方法 calculate_dynamic_sl_tp:

```python
def _calculate_dynamic_sl_tp(self, price: float, atr: float, side: str, 
                             market_context: dict) -> tuple:
    """
    动态计算止损止盈，综合考虑市场状态
    
    market_context 应包含:
    - adx: ADX值 (趋势强度)
    - rsi: RSI值
    - h4_trend: H4趋势 ("强多头"/"强空头"/"震荡"/"趋势不明")
    - strategy: 策略类型 ("pullback"/"breakout_retest"/"divergence"/"breakout_pyramid")
    - nearest_sr_distance: 最近支撑/阻力距离 (可选)
    
    返回: (stop_loss, tp1, tp2, adjustment_reason)
    """
    
    # 1. 基础 ATR 倍数 (策略默认值)
    base_sl_mult = {
        "pullback": 1.5,
        "breakout_retest": 1.0,
        "divergence": 0.5,
        "breakout_pyramid": 0.5,
    }
    base_tp1_mult = 1.5
    base_tp2_mult = 3.0
    
    strategy = market_context.get("strategy", "pullback")
    sl_mult = base_sl_mult.get(strategy, 1.5)
    tp1_mult = base_tp1_mult
    tp2_mult = base_tp2_mult
    
    adjustments = []
    
    # 2. 波动性调整 (ADX)
    adx = market_context.get("adx", 0)
    if adx > 35:  # 强趋势，波动大
        sl_mult *= 1.3  # 放宽止损 30%
        tp1_mult *= 1.2
        tp2_mult *= 1.5
        adjustments.append(f"ADX={adx:.1f}>35 放宽止损30%")
    elif adx < 20:  # 弱趋势/震荡
        sl_mult *= 0.8  # 收紧止损 20%
        tp1_mult *= 0.8
        adjustments.append(f"ADX={adx:.1f}<20 收紧止损20%")
    
    # 3. RSI 调整
    rsi = market_context.get("rsi", 50)
    if side == "BUY" and rsi < 30:  # 超卖区买入
        sl_mult *= 0.9  # 稍收紧，风险较低
        adjustments.append(f"RSI={rsi:.1f}<30 超卖区收紧止损")
    elif side == "SELL" and rsi > 70:  # 超买区卖出
        sl_mult *= 0.9
        adjustments.append(f"RSI={rsi:.1f}>70 超买区收紧止损")
    
    # 4. H4 趋势一致性调整
    h4_trend = market_context.get("h4_trend", "")
    if h4_trend in ["强多头", "强空头"]:
        # 顺势交易，TP 可以更远
        tp2_mult *= 1.3
        adjustments.append(f"H4={h4_trend} 扩大TP2")
    
    # 5. 计算 SL/TP
    if side == "BUY":
        stop_loss = price - atr * sl_mult
        tp1 = price + atr * tp1_mult
        tp2 = price + atr * tp2_mult
    else:  # SELL
        stop_loss = price + atr * sl_mult
        tp1 = price - atr * tp1_mult
        tp2 = price - atr * tp2_mult
    
    reason = "动态调整: " + "; ".join(adjustments) if adjustments else "默认ATR倍数"
    
    return (round(stop_loss, 2), round(tp1, 2), round(tp2, 2), reason)
```

然后修改各策略方法，在返回信号前调用此方法:

例如 _check_pullback 中，将:
```python
sl = price - atr * 1.5
return {
    "side": "BUY", "entry": price,
    "stop_loss": round(sl, 2),
    "tp1": round(price + atr * 1.5, 2),
    "tp2": round(price + atr * 3.0, 2),
    ...
}
```

改为:
```python
market_context = {
    "adx": adx, "rsi": rsi, "h4_trend": h4_trend,
    "strategy": "pullback"
}
sl, tp1, tp2, reason = self._calculate_dynamic_sl_tp(price, atr, "BUY", market_context)
return {
    "side": "BUY", "entry": price,
    "stop_loss": sl, "tp1": tp1, "tp2": tp2,
    "sl_adjustment": reason,  # 新增字段记录调整原因
    ...
}
```

同样修改 _check_breakout_retest, _check_divergence, _check_breakout_pyramid。

### 方案2: AI结果端点接收 suggestedSL/suggestedTP (app.py)

在 app.py 中新增端点 /api/v2/ai_result:

```python
@app.route('/api/v2/ai_result/<account_id>/<symbol>', methods=['POST'])
@require_token
def api_v2_ai_result(account_id, symbol):
    """
    POST /api/v2/ai_result/<account_id>/<symbol>
    用途: 接收 gold-analysis-agent 发来的 AI 分析结果
          包含 suggested_sl/suggested_tp 用于持仓调整
    """
    token = getattr(request, '_gb_token', '')
    allowed = token_mgr.get_allowed_accounts(token)
    if allowed is not None and account_id not in allowed:
        return jsonify({"status": "ERROR", "message": "forbidden"}), 403
    
    data = request.get_json(silent=True) or {}
    
    # 解析所有字段
    bias = data.get("bias", "neutral")
    confidence = float(data.get("confidence", 0))
    exit_suggestion = data.get("exit_suggestion", "hold")
    risk_alert = bool(data.get("risk_alert", False))
    alert_reason = data.get("alert_reason", "")
    
    # AI 动态 SL/TP 建议
    suggested_sl = float(data.get("suggested_sl", 0))
    suggested_tp = float(data.get("suggested_tp", 0))
    
    # 更新账户状态
    with store.lock:
        acc = store.get(account_id)
        acc["last_signal"] = {
            "bias": bias,
            "confidence": confidence,
            "exit_suggestion": exit_suggestion,
            "risk_alert": risk_alert,
            "suggested_sl": suggested_sl,
            "suggested_tp": suggested_tp,
            "time": datetime.now().strftime("%H:%M:%S"),
        }
        acc["last_signal_time"] = time.time()
        
        # 如果有 SL/TP 建议，生成 MODIFY 命令
        if suggested_sl > 0:
            # 找到对应 symbol 的持仓
            for ticket_str, pos in acc.get("positions", {}).items():
                pos_symbol = pos.get("symbol", "")
                if pos_symbol == symbol or pos_symbol.upper().replace("m#", "") == symbol.upper():
                    ticket = int(ticket_str) if str(ticket_str).isdigit() else ticket_str
                    current_sl = float(pos.get("sl", 0))
                    
                    # 只在建议止损更优时才修改 (BUY: 建议SL > 当前SL; SELL: 建议SL < 当前SL)
                    direction = str(pos.get("type", "")).upper()
                    should_modify = False
                    
                    if direction == "BUY":
                        if suggested_sl > current_sl:
                            should_modify = True
                    elif direction == "SELL":
                        if suggested_sl < current_sl or current_sl == 0:
                            should_modify = True
                    
                    if should_modify:
                        cmd = {
                            "id": f"ai_modify_{int(time.time())}_{ticket}",
                            "action": "MODIFY",
                            "ticket": ticket,
                            "new_sl": round(suggested_sl, 2),
                            "new_tp": round(suggested_tp, 2) if suggested_tp > 0 else 0,
                            "reason": f"AI建议: {alert_reason}",
                            "confidence": confidence,
                        }
                        acc["pending_commands"].append(cmd)
                        logger.info(f"[{account_id}] AI止损调整 → MODIFY #{ticket}: SL={suggested_sl:.2f}")
    
    # WebSocket 推送
    socketio.emit('ai_result', {
        "account_id": account_id,
        "symbol": symbol,
        "bias": bias,
        "confidence": confidence,
        "suggested_sl": suggested_sl,
        "suggested_tp": suggested_tp,
        "risk_alert": risk_alert,
        "alert_reason": alert_reason,
    })
    
    logger.info(f"[{account_id}/{symbol}] 🤖 AI结果 | bias={bias} conf={confidence}% SL={suggested_sl:.2f}")
    return jsonify({"status": "OK", "received": True})
```

## 文件位置
- strategy/engine.py: 策略引擎
- app.py: API 端点

## 注意事项
- 保持向后兼容：固定倍数作为 fallback
- 日志清晰：每次动态调整需记录原因
- 现有接口和 WebSocket 事件不变
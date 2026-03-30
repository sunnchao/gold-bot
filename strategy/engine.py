"""
策略引擎 - 分析数据并生成交易信号
服务端只负责信号生成,不负责风控和下单
"""
import time
import logging
import numpy as np
from typing import Optional, Dict, List
from gold_bolt_server.config import STRATEGY, SIGNAL
from gold_bolt_server.data.manager import DataManager
from gold_bolt_server.strategy.position_mgr import PositionManager

logger = logging.getLogger(__name__)


class StrategyEngine:
    """策略引擎 - 统一分析入口"""

    def __init__(self):
        pass

    def analyze(self, dm: DataManager, account: dict) -> tuple:
        """
        分析所有启用的策略,返回 (最优信号或None, 分析日志列表)

        日志格式: [{"level": "info/warn/signal", "strategy": "...", "msg": "..."}]
        """
        logs = []

        h1 = dm.get_dataframe("H1")
        m30 = dm.get_dataframe("M30")
        m15 = dm.get_dataframe("M15")
        h4 = dm.get_dataframe("H4")   # 主趋势周期(优先级最高)

        if h1 is None or len(h1) < 50:
            logs.append({"level": "warn", "strategy": "系统", "msg": f"H1数据不足: {len(h1) if h1 is not None else 0}/50"})
            return None, logs

        price = dm.current_price()
        atr = dm.current_atr("H1")
        if price <= 0 or atr <= 0:
            logs.append({"level": "warn", "strategy": "系统", "msg": f"价格或ATR异常: price={price:.2f}, ATR={atr:.2f}"})
            return None, logs

        last = h1.iloc[-1]

        # H4 主趋势判断
        h4_trend = "未知"
        h4_adx = 0
        h4_filter_dir = None  # None=不过滤, "BUY"=只做多, "SELL"=只做空
        if h4 is not None and len(h4) >= 50:
            h4_last = h4.iloc[-1]
            h4_ema20 = h4_last.get("ema20", 0)
            h4_ema50 = h4_last.get("ema50", 0)
            h4_adx = h4_last.get("adx", 0)
            h4_price = h4_last.get("close", 0)
            if h4_adx > 25:
                if h4_ema20 > h4_ema50 and h4_price > h4_ema20:
                    h4_trend = "强多头"
                    h4_filter_dir = "BUY"
                elif h4_ema20 < h4_ema50 and h4_price < h4_ema20:
                    h4_trend = "强空头"
                    h4_filter_dir = "SELL"
                else:
                    h4_trend = "趋势不明"
            else:
                h4_trend = "震荡"
        else:
            logs.append({"level": "warn", "strategy": "H4", "msg": f"H4数据不足,跳过主趋势过滤"})

        # 市场概况
        trend = "多头" if last.get("ema20", 0) > last.get("ema50", 0) else "空头"
        logs.append({
            "level": "info", "strategy": "市场",
            "msg": f"Price={price:.2f} | ATR={atr:.2f} | RSI={last.get('rsi', 0):.1f} | ADX={last.get('adx', 0):.1f} | EMA趋势(H1)={trend} | H4={h4_trend}(ADX={h4_adx:.1f}) | MACD柱={last.get('macd_hist', 0):.2f}"
        })

        signals = []

        # 策略1: 趋势回调
        if STRATEGY["pullback"]["enabled"]:
            sig, detail = self._check_pullback(h1, m15, price, atr, h4=h4)
            logs.append(detail)
            if sig:
                signals.append(sig)

        # 策略2: 突破回踩
        if STRATEGY["breakout_retest"]["enabled"]:
            sig, detail = self._check_breakout_retest(h1, m15, price, atr, h4=h4)
            logs.append(detail)
            if sig:
                signals.append(sig)

        # 策略3: RSI背离
        if STRATEGY["divergence"]["enabled"]:
            sig, detail = self._check_divergence(h1, m30, price, atr, h4=h4)
            logs.append(detail)
            if sig:
                signals.append(sig)

        # 策略4: 突破加仓
        if STRATEGY["breakout_pyramid"]["enabled"]:
            sig, detail = self._check_breakout_pyramid(h1, price, atr)
            logs.append(detail)
            if sig:
                signals.append(sig)

        if not signals:
            logs.append({"level": "info", "strategy": "汇总", "msg": "本轮无信号触发"})
            return None, logs

        # H4 主趋势过滤:强趋势市中只保留与 H4 方向一致的信号
        if h4_filter_dir is not None and signals:
            filtered = [s for s in signals if s.get("side") == h4_filter_dir]
            removed = len(signals) - len(filtered)
            if removed > 0:
                logs.append({"level": "warn", "strategy": "H4过滤",
                    "msg": f"H4={h4_trend},过滤掉 {removed} 个逆势信号,保留 {len(filtered)} 个"})
                signals = filtered
            if not signals:
                logs.append({"level": "info", "strategy": "H4过滤",
                    "msg": "H4趋势过滤后无信号"})
                return None, logs

        # 取最优
        best = max(signals, key=lambda s: s["score"])

        # 最低评分过滤
        if best["score"] < SIGNAL["min_score"]:
            logs.append({"level": "info", "strategy": "汇总", "msg": f"最优信号评分 {best['score']} < 最低要求 {SIGNAL['min_score']},过滤"})
            return None, logs

        # 防重复:检查已有持仓距离
        dup_atr = SIGNAL["duplicate_atr_filter"]
        for pos in account.get("positions", {}).values():
            op = pos.get("open_price", 0)
            if abs(best["entry"] - op) < atr * dup_atr:
                if pos.get("type") == best["side"]:
                    logs.append({"level": "warn", "strategy": "汇总", "msg": f"防重复: 已有同向持仓 @ {op:.2f},距离 < {dup_atr} ATR"})
                    return None, logs

        best["atr"] = atr
        # P1: 附加所有策略评分供 Aurex 参考
        best["all_strategies"] = [
            {"strategy": s["strategy"], "side": s["side"], "score": s["score"],
             "entry": s.get("entry", 0), "stop_loss": s.get("stop_loss", 0)}
            for s in signals
        ]
        logs.append({"level": "signal", "strategy": "汇总", "msg": f"✅ 发出信号: {best['side']} @ {best['entry']:.2f} | SL={best['stop_loss']:.2f} | 策略={best['strategy']} | 评分={best['score']}"})
        return best, logs

    # ============================================
    # 策略实现
    # ============================================

    def _check_pullback(self, h1, m15, price, atr, h4=None) -> tuple:
        """趋势回调策略"""
        last = h1.iloc[-1]
        cfg = STRATEGY["pullback"]
        name = "趋势回调"

        adx = last.get("adx", 0)
        if adx < cfg["min_adx"]:
            return None, {"level": "info", "strategy": name, "msg": f"ADX={adx:.1f} < {cfg['min_adx']},趋势不明显 ⏭"}

        ema20 = last["ema20"]
        ema50 = last["ema50"]
        rsi = last["rsi"]
        dist = abs(price - ema20)
        threshold = atr * 0.5

        # 多头回调
        if ema20 > ema50 and price > ema50:
            if dist >= threshold:
                return None, {"level": "info", "strategy": name, "msg": f"多头趋势 | 价格距EMA20={dist:.2f} > {threshold:.2f},未回调到位 ⏭"}
            if rsi >= cfg["rsi_overbought"]:
                return None, {"level": "info", "strategy": name, "msg": f"多头趋势 | RSI={rsi:.1f} ≥ {cfg['rsi_overbought']},超买 ⏭"}

            score = 5
            details = []
            if last["macd_hist"] > 0: score += 1; details.append("MACD柱>0")
            if rsi < 50: score += 1; details.append(f"RSI={rsi:.1f}<50")
            if adx > 25: score += 1; details.append(f"ADX={adx:.1f}>25")

            sl = price - atr * 1.5
            return {
                "side": "BUY", "entry": price,
                "stop_loss": round(sl, 2),
                "tp1": round(price + atr * 1.5, 2),
                "tp2": round(price + atr * 3.0, 2),
                "score": min(score, 10), "strategy": "pullback",
            }, {"level": "signal", "strategy": name, "msg": f"🟢 BUY 评分={score} | EMA20回调 dist={dist:.2f} | {' | '.join(details)}"}

        # 空头回调
        if ema20 < ema50 and price < ema50:
            if dist >= threshold:
                return None, {"level": "info", "strategy": name, "msg": f"空头趋势 | 价格距EMA20={dist:.2f} > {threshold:.2f},未回调到位 ⏭"}
            if rsi <= cfg["rsi_oversold"]:
                return None, {"level": "info", "strategy": name, "msg": f"空头趋势 | RSI={rsi:.1f} ≤ {cfg['rsi_oversold']},超卖 ⏭"}

            score = 5
            details = []
            if last["macd_hist"] < 0: score += 1; details.append("MACD柱<0")
            if rsi > 50: score += 1; details.append(f"RSI={rsi:.1f}>50")
            if adx > 25: score += 1; details.append(f"ADX={adx:.1f}>25")

            sl = price + atr * 1.5
            return {
                "side": "SELL", "entry": price,
                "stop_loss": round(sl, 2),
                "tp1": round(price - atr * 1.5, 2),
                "tp2": round(price - atr * 3.0, 2),
                "score": min(score, 10), "strategy": "pullback",
            }, {"level": "signal", "strategy": name, "msg": f"🔴 SELL 评分={score} | EMA20回调 dist={dist:.2f} | {' | '.join(details)}"}

        # 无趋势
        return None, {"level": "info", "strategy": name, "msg": f"EMA20={ema20:.2f} vs EMA50={ema50:.2f} | 价格={price:.2f} 不符合回调条件 ⏭"}

    def _check_breakout_retest(self, h1, m15, price, atr, h4=None) -> tuple:
        """突破回踩策略"""
        cfg = STRATEGY["breakout_retest"]
        lookback = cfg["lookback"]
        name = "突破回踩"

        if len(h1) < lookback + 5:
            return None, {"level": "info", "strategy": name, "msg": f"数据不足 {len(h1)}/{lookback+5} ⏭"}

        recent = h1.iloc[-(lookback+5):-5]
        last5 = h1.iloc[-5:]
        last = h1.iloc[-1]

        resistance = recent['high'].max()
        support = recent['low'].min()
        threshold = atr * 0.5

        # 向上突破后回踩
        broke_up = last5['high'].max() > resistance
        dist_res = abs(price - resistance)
        if broke_up and dist_res < threshold:
            score = 5
            details = []
            if last["macd_hist"] > 0: score += 1; details.append("MACD柱>0")
            if last.get("adx", 0) > 20: score += 1; details.append(f"ADX={last.get('adx', 0):.1f}")
            if last["rsi"] > 50: score += 1; details.append(f"RSI={last['rsi']:.1f}")

            return {
                "side": "BUY", "entry": price,
                "stop_loss": round(resistance - atr * 1.0, 2),
                "tp1": round(price + atr * 2.0, 2),
                "tp2": round(price + atr * 4.0, 2),
                "score": min(score, 10), "strategy": "breakout_retest",
            }, {"level": "signal", "strategy": name, "msg": f"🟢 BUY 评分={score} | 阻力位={resistance:.2f} 突破后回踩 dist={dist_res:.2f} | {' | '.join(details)}"}

        # 向下突破后回踩
        broke_down = last5['low'].min() < support
        dist_sup = abs(price - support)
        if broke_down and dist_sup < threshold:
            score = 5
            details = []
            if last["macd_hist"] < 0: score += 1; details.append("MACD柱<0")
            if last.get("adx", 0) > 20: score += 1; details.append(f"ADX={last.get('adx', 0):.1f}")
            if last["rsi"] < 50: score += 1; details.append(f"RSI={last['rsi']:.1f}")

            return {
                "side": "SELL", "entry": price,
                "stop_loss": round(support + atr * 1.0, 2),
                "tp1": round(price - atr * 2.0, 2),
                "tp2": round(price - atr * 4.0, 2),
                "score": min(score, 10), "strategy": "breakout_retest",
            }, {"level": "signal", "strategy": name, "msg": f"🔴 SELL 评分={score} | 支撑位={support:.2f} 突破后回踩 dist={dist_sup:.2f} | {' | '.join(details)}"}

        msg = f"阻力={resistance:.2f} 支撑={support:.2f}"
        if broke_up:
            msg += f" | 上破✓ 但回踩距离={dist_res:.2f} > {threshold:.2f}"
        elif broke_down:
            msg += f" | 下破✓ 但回踩距离={dist_sup:.2f} > {threshold:.2f}"
        else:
            msg += " | 未突破 ⏭"
        return None, {"level": "info", "strategy": name, "msg": msg}

    def _check_divergence(self, h1, m30, price, atr, h4=None) -> tuple:
        """RSI背离策略"""
        name = "RSI背离"
        if len(h1) < 30:
            return None, {"level": "info", "strategy": name, "msg": "数据不足 ⏭"}

        last = h1.iloc[-1]
        rsi = h1['rsi'].values
        close = h1['close'].values

        if len(close) < 20:
            return None, {"level": "info", "strategy": name, "msg": "数据不足20根 ⏭"}

        recent_low = close[-10:].min()
        prev_low = close[-20:-10].min()
        recent_rsi_low = rsi[-10:].min()
        prev_rsi_low = rsi[-20:-10].min()

        recent_high = close[-10:].max()
        prev_high = close[-20:-10].max()
        recent_rsi_high = rsi[-10:].max()
        prev_rsi_high = rsi[-20:-10].max()

        # 看涨背离
        bull_div = recent_low < prev_low and recent_rsi_low > prev_rsi_low
        if bull_div and last["rsi"] < 40:
            score = 6
            details = []
            if last["macd_hist"] > h1.iloc[-2]["macd_hist"]: score += 1; details.append("MACD改善")
            if last.get("stoch_k", 50) < 20: score += 1; details.append(f"StochK={last.get('stoch_k', 0):.0f}")

            sl_mult = 0.5
            return {
                "side": "BUY", "entry": price,
                "stop_loss": round(recent_low - atr * 0.5, 2),
                "tp1": round(price + atr * 2.0, 2),
                "tp2": round(price + atr * 4.0, 2),
                "score": min(score, 10), "strategy": "divergence", "atr_mult": sl_mult,
            }, {"level": "signal", "strategy": name, "msg": f"🟢 BUY 评分={score} | 看涨背离: 价格新低{recent_low:.2f}<{prev_low:.2f} RSI抬高{recent_rsi_low:.1f}>{prev_rsi_low:.1f} | {' | '.join(details)}"}

        # 看跌背离
        bear_div = recent_high > prev_high and recent_rsi_high < prev_rsi_high
        if bear_div and last["rsi"] > 60:
            score = 6
            details = []
            if last["macd_hist"] < h1.iloc[-2]["macd_hist"]: score += 1; details.append("MACD恶化")
            if last.get("stoch_k", 50) > 80: score += 1; details.append(f"StochK={last.get('stoch_k', 0):.0f}")

            sl_mult = 0.5
            return {
                "side": "SELL", "entry": price,
                "stop_loss": round(recent_high + atr * 0.5, 2),
                "tp1": round(price - atr * 2.0, 2),
                "tp2": round(price - atr * 4.0, 2),
                "score": min(score, 10), "strategy": "divergence", "atr_mult": sl_mult,
            }, {"level": "signal", "strategy": name, "msg": f"🔴 SELL 评分={score} | 看跌背离: 价格新高{recent_high:.2f}>{prev_high:.2f} RSI降低{recent_rsi_high:.1f}<{prev_rsi_high:.1f} | {' | '.join(details)}"}

        msg = f"RSI={last['rsi']:.1f}"
        if bull_div:
            msg += f" | 看涨背离检测到但RSI={last['rsi']:.1f} ≥ 40"
        elif bear_div:
            msg += f" | 看跌背离检测到但RSI={last['rsi']:.1f} ≤ 60"
        else:
            msg += " | 无背离 ⏭"
        return None, {"level": "info", "strategy": name, "msg": msg}

    def _check_breakout_pyramid(self, h1, price, atr) -> tuple:
        """突破加仓策略"""
        name = "突破加仓"
        if len(h1) < 30:
            return None, {"level": "info", "strategy": name, "msg": "数据不足 ⏭"}

        last = h1.iloc[-1]
        adx = last.get("adx", 0)

        if adx < 25:
            return None, {"level": "info", "strategy": name, "msg": f"ADX={adx:.1f} < 25,趋势不够强 ⏭"}

        bb_upper = last.get("bb_upper", 0)
        bb_lower = last.get("bb_lower", 0)

        # 突破布林上轨
        if price > bb_upper and last["ema20"] > last["ema50"]:
            score = 6
            details = []
            if adx > 30: score += 1; details.append(f"ADX={adx:.1f}>30")
            if last["rsi"] > 55 and last["rsi"] < 80: score += 1; details.append(f"RSI={last['rsi']:.1f}")
            if last["macd_hist"] > 0: score += 1; details.append("MACD柱>0")

            return {
                "side": "BUY", "entry": price,
                "stop_loss": round(last["ema20"] - atr * 0.5, 2),
                "tp1": round(price + atr * 2.0, 2),
                "tp2": round(price + atr * 5.0, 2),
                "score": min(score, 10), "strategy": "breakout_pyramid",
            }, {"level": "signal", "strategy": name, "msg": f"🟢 BUY 评分={score} | 突破布林上轨={bb_upper:.2f} | {' | '.join(details)}"}

        # 突破布林下轨
        if price < bb_lower and last["ema20"] < last["ema50"]:
            score = 6
            details = []
            if adx > 30: score += 1; details.append(f"ADX={adx:.1f}>30")
            if last["rsi"] < 45 and last["rsi"] > 20: score += 1; details.append(f"RSI={last['rsi']:.1f}")
            if last["macd_hist"] < 0: score += 1; details.append("MACD柱<0")

            return {
                "side": "SELL", "entry": price,
                "stop_loss": round(last["ema20"] + atr * 0.5, 2),
                "tp1": round(price - atr * 2.0, 2),
                "tp2": round(price - atr * 5.0, 2),
                "score": min(score, 10), "strategy": "breakout_pyramid",
            }, {"level": "signal", "strategy": name, "msg": f"🔴 SELL 评分={score} | 突破布林下轨={bb_lower:.2f} | {' | '.join(details)}"}

        msg = f"BB=[{bb_lower:.2f}, {bb_upper:.2f}] Price={price:.2f}"
        if price > bb_upper:
            msg += " | 突破上轨但EMA20<EMA50趋势不一致"
        elif price < bb_lower:
            msg += " | 突破下轨但EMA20>EMA50趋势不一致"
        else:
            msg += " | 在通道内 ⏭"
        return None, {"level": "info", "strategy": name, "msg": msg}



"""
持仓管理器 v2 - 智能出场策略
优化：波动率自适应、动态追踪、时间止损、关键价位、灵敏反转检测
"""
import time
import logging
from typing import List, Dict, Optional
from gold_bolt_server.config import SIGNAL

logger = logging.getLogger(__name__)


class PositionState:
    """持仓管理状态"""
    def __init__(self, ticket: int):
        self.ticket = ticket
        self.tp1_hit = False
        self.tp2_hit = False
        self.max_profit_atr = 0.0      # 最大盈利ATR数
        self.open_time = time.time()    # 开仓时间
        self.last_modify_time = 0
        self.be_moved = False           # 是否已移保本止损
        self.be_trigger_atr = 1.0       # 保本触发阈值（浮盈≥1 ATR）


class PositionManager:
    """服务端持仓管理 - 生成 MODIFY/CLOSE 指令"""
    
    def __init__(self):
        self.states: Dict[int, PositionState] = {}
    
    def _adaptive_atr_multis(self, dm) -> tuple:
        """波动率自适应 ATR 倍数"""
        h1 = dm.get_dataframe("H1")
        if h1 is None or len(h1) < 25:
            return 1.5, 3.0
        
        current_atr = h1.iloc[-1].get("atr", 0)
        avg_atr = h1["atr"].iloc[-20:].mean() if "atr" in h1.columns else current_atr
        
        if avg_atr <= 0:
            return 1.5, 3.0
        
        ratio = current_atr / avg_atr
        
        if ratio > 1.3:      # 高波动
            return 2.0, 4.0
        elif ratio < 0.7:    # 低波动
            return 1.0, 2.0
        else:
            return 1.5, 3.0
    
    def _nearest_key_level(self, price: float, side: str) -> float:
        """找最近的关键价位（整数关口）"""
        # 黄金以50为关口 (2900, 2950, 3000...)
        level_above = ((price // 50) + 1) * 50
        level_below = (price // 50) * 50
        
        if side == "BUY":
            return level_above
        else:
            return level_below
    
    def analyze(self, account: dict, data_mgr) -> List[dict]:
        """分析持仓，返回指令列表"""
        commands = []
        positions = account.get("positions", {})
        
        if not positions:
            return commands
        
        h1 = data_mgr.get_dataframe("H1")
        if h1 is None or len(h1) < 5:
            return commands
        
        atr = data_mgr.current_atr("H1")
        price = data_mgr.current_price()
        
        if atr <= 0 or price <= 0:
            return commands
        
        tp1_multi, tp2_multi = self._adaptive_atr_multis(data_mgr)
        
        for ticket_str, pos in positions.items():
            ticket = int(ticket_str) if isinstance(ticket_str, str) else ticket_str
            
            if ticket not in self.states:
                self.states[ticket] = PositionState(ticket)
            state = self.states[ticket]
            
            side = pos.get("type", "BUY")
            entry = pos.get("open_price", 0)
            lots = pos.get("lots", 0)
            
            if entry <= 0 or lots <= 0:
                continue
            
            # 计算盈利ATR数
            profit_pips = (price - entry) if side == "BUY" else (entry - price)
            profit_atr = profit_pips / atr
            
            # 更新最大盈利
            if profit_atr > state.max_profit_atr:
                state.max_profit_atr = profit_atr
            
            # === 按优先级检查出场条件 ===
            
            # 1. 时间止损
            cmd = self._check_time_stop(ticket, state, pos, side, lots, profit_atr)
            if cmd:
                commands.append(cmd)
                continue
            
            # 2. 保本止损（新增）
            cmd = self._check_breakeven(ticket, state, pos, side, price, entry,
                                         lots, atr, profit_atr, h1)
            if cmd:
                commands.append(cmd)
                # 保本后继续检查，不 continue
            
            # 3. 智能 TP1
            cmd = self._check_tp1(ticket, state, pos, side, price, entry,
                                   lots, atr, profit_atr, tp1_multi, h1)
            if cmd:
                commands.append(cmd)
                continue
            
            # 4. 关键价位止盈
            cmd = self._check_key_level_tp(ticket, state, pos, side, price, entry,
                                            lots, atr, profit_atr)
            if cmd:
                commands.append(cmd)
                continue
            
            # 5. 智能 TP2
            cmd = self._check_tp2(ticket, state, pos, side, price, entry,
                                   lots, atr, profit_atr, tp2_multi, h1)
            if cmd:
                commands.append(cmd)
                continue
            
            # 6. 趋势反转（双重确认版）
            cmd = self._check_trend_reversal(ticket, state, pos, side, price,
                                              lots, profit_atr, h1)
            if cmd:
                commands.append(cmd)
                continue
            
            # 7. 动态追踪保护
            cmd = self._check_dynamic_trailing(ticket, state, pos, side, price,
                                                lots, atr, profit_atr)
            if cmd:
                commands.append(cmd)
        
        # 清理已平仓状态
        active_tickets = set(int(t) if isinstance(t, str) else t for t in positions.keys())
        stale = [t for t in self.states if t not in active_tickets]
        for t in stale:
            del self.states[t]
        
        return commands
    
    def _check_time_stop(self, ticket, state, pos, side, lots, profit_atr) -> Optional[dict]:
        """
        时间止损：
        - 24h 盈利 < 0.5 ATR → 平仓
        - 48h 盈利 < 1.0 ATR → 平仓
        - 72h 无论如何减仓50%
        """
        hours = (time.time() - state.open_time) / 3600
        
        if hours > 72 and not state.tp2_hit:
            close_lots = round(lots * 0.5, 2) if lots > 0.02 else lots
            logger.info(f"#{ticket} ⏰ 72h超时减仓 | 盈利{profit_atr:.1f}ATR")
            return {
                "action": "CLOSE",
                "ticket": ticket,
                "lots": close_lots,
                "reason": f"time_72h_{profit_atr:.1f}ATR",
            }
        
        if hours > 48 and profit_atr < 1.0:
            logger.info(f"#{ticket} ⏰ 48h盈利不足 ({profit_atr:.1f}ATR < 1.0)，平仓")
            return {
                "action": "CLOSE",
                "ticket": ticket,
                "lots": lots,
                "reason": f"time_48h_{profit_atr:.1f}ATR",
            }
        
        if hours > 24 and profit_atr < 0.3:
            logger.info(f"#{ticket} ⏰ 24h盈利不足 ({profit_atr:.1f}ATR < 0.3)，平仓")
            return {
                "action": "CLOSE",
                "ticket": ticket,
                "lots": lots,
                "reason": f"time_24h_{profit_atr:.1f}ATR",
            }
        
        return None
    
    def _check_breakeven(self, ticket, state, pos, side, price, entry,
                         lots, atr, profit_atr, h1) -> Optional[dict]:
        """
        保本止损：浮盈 ≥ 1 ATR 时，将止损移至开仓价
        核心改进：不平仓，让利润继续跑
        """
        if state.be_moved:
            return None
        
        if profit_atr < state.be_trigger_atr:
            return None
        
        state.be_moved = True
        logger.info(f"#{ticket} 🔒 保本止损触发 | 浮盈{profit_atr:.1f}ATR，止损移至{entry:.2f}")
        
        return {
            "action": "MODIFY",
            "ticket": ticket,
            "new_sl": entry,
            "reason": f"breakeven_{profit_atr:.1f}ATR",
        }
    
    def _check_tp1(self, ticket, state, pos, side, price, entry,
                    lots, atr, profit_atr, tp1_multi, h1) -> Optional[dict]:
        """
        TP1: 自适应 ATR 倍数，或提前触发（0.8x + RSI极端）
        平仓 40%
        必须先触发保本止损（be_moved=True）才考虑 TP1
        """
        if state.tp1_hit:
            return None
        
        # 必须先保本
        if not state.be_moved:
            return None
        
        should_tp1 = profit_atr >= tp1_multi
        
        # 提前 TP1：0.8 * tp1_multi + RSI 极端信号
        early_threshold = tp1_multi * 0.6
        if not should_tp1 and profit_atr >= early_threshold and len(h1) >= 3:
            last = h1.iloc[-1]
            prev = h1.iloc[-2]
            
            if side == "BUY":
                if prev.get("rsi", 50) > 65 and last.get("rsi", 50) < 55:
                    should_tp1 = True
                    logger.info(f"#{ticket} RSI回落，提前TP1")
            else:
                if prev.get("rsi", 50) < 35 and last.get("rsi", 50) > 45:
                    should_tp1 = True
        
        if should_tp1:
            close_lots = round(lots * 0.4, 2)  # 40% 止盈
            if close_lots < 0.01:
                close_lots = lots
            
            state.tp1_hit = True
            logger.info(f"#{ticket} 🎯 TP1 平{close_lots}手 | 盈利{profit_atr:.1f}ATR (multi={tp1_multi})")
            
            return {
                "action": "CLOSE",
                "ticket": ticket,
                "lots": close_lots,
                "reason": f"TP1_{profit_atr:.1f}ATR",
            }
        
        return None
    
    def _check_key_level_tp(self, ticket, state, pos, side, price, entry,
                             lots, atr, profit_atr) -> Optional[dict]:
        """
        关键价位止盈：接近整数关口（50刻度）时部分止盈
        条件：盈利 > 1 ATR 且距离关口 < 0.2 ATR
        """
        if profit_atr < 1.0:
            return None
        
        key_level = self._nearest_key_level(price, side)
        dist = abs(price - key_level)
        
        if dist < atr * 0.2:
            # 接近关键价位
            if not state.tp1_hit:
                # 还没TP1，按TP1处理
                close_lots = round(lots * 0.4, 2)
                if close_lots < 0.01:
                    close_lots = lots
                state.tp1_hit = True
                logger.info(f"#{ticket} 🏁 关键价位{key_level:.0f}止盈 平{close_lots}手 | 距离{dist:.1f}")
                return {
                    "action": "CLOSE",
                    "ticket": ticket,
                    "lots": close_lots,
                    "reason": f"key_level_{key_level:.0f}",
                }
            elif state.tp1_hit and not state.tp2_hit and profit_atr > 2.0:
                # 已TP1，接近更高关口
                close_lots = round(lots * 0.4, 2)
                if close_lots < 0.01:
                    close_lots = lots
                state.tp2_hit = True
                logger.info(f"#{ticket} 🏁 关键价位{key_level:.0f}二次止盈 平{close_lots}手")
                return {
                    "action": "CLOSE",
                    "ticket": ticket,
                    "lots": close_lots,
                    "reason": f"key_level2_{key_level:.0f}",
                }
        
        return None
    
    def _check_tp2(self, ticket, state, pos, side, price, entry,
                    lots, atr, profit_atr, tp2_multi, h1) -> Optional[dict]:
        """
        TP2: 自适应 ATR 倍数，或提前（0.7x + 多重衰竭）
        平仓 40% 剩余
        """
        if not state.tp1_hit or state.tp2_hit:
            return None
        
        should_tp2 = profit_atr >= tp2_multi
        
        # 提前 TP2
        early_threshold = tp2_multi * 0.7
        if not should_tp2 and profit_atr >= early_threshold and len(h1) >= 3:
            last = h1.iloc[-1]
            prev = h1.iloc[-2]
            
            weakness = 0
            if side == "BUY":
                if last.get("macd_hist", 0) < prev.get("macd_hist", 0): weakness += 1
                if last.get("rsi", 50) < prev.get("rsi", 50) and last.get("rsi", 50) < 60: weakness += 1
                if last.get("adx", 30) < prev.get("adx", 30): weakness += 1
            else:
                if last.get("macd_hist", 0) > prev.get("macd_hist", 0): weakness += 1
                if last.get("rsi", 50) > prev.get("rsi", 50) and last.get("rsi", 50) > 40: weakness += 1
                if last.get("adx", 30) < prev.get("adx", 30): weakness += 1
            
            if weakness >= 2:
                should_tp2 = True
                logger.info(f"#{ticket} 动量衰竭{weakness}/3，提前TP2")
        
        if should_tp2:
            close_lots = round(lots * 0.4, 2)  # 40% 剩余
            if close_lots < 0.01:
                close_lots = lots
            
            state.tp2_hit = True
            logger.info(f"#{ticket} 🎯 TP2 平{close_lots}手 | 盈利{profit_atr:.1f}ATR (multi={tp2_multi})")
            
            return {
                "action": "CLOSE",
                "ticket": ticket,
                "lots": close_lots,
                "reason": f"TP2_{profit_atr:.1f}ATR",
            }
        
        return None
    
    def _check_trend_reversal(self, ticket, state, pos, side, price,
                               lots, profit_atr, h1) -> Optional[dict]:
        """
        趋势反转（双重确认版）— 必须已保本后才触发
        双重确认条件：
        - MACD histogram < -0.5（明显负值，不是刚转负）
        - 价格跌破 EMA20
        两个条件同时满足才触发退出
        """
        if not state.be_moved:
            return None
        
        if profit_atr < 0.3:
            return None
        
        if len(h1) < 4:
            return None
        
        last = h1.iloc[-1]
        prev = h1.iloc[-2]
        
        score = 0
        reasons = []
        
        if side == "BUY":
            # 双重确认：MACD histogram 明显负值 + 价格跌破 EMA20
            macd_hist = last.get("macd_hist", 0)
            ema20 = last.get("ema20", price)
            
            dual_confirm = macd_hist < -0.5 and price < ema20
            if dual_confirm:
                score += 3
                reasons.append(f"MACD={macd_hist:.2f}<-0.5且价格<EMA20")
            
            # RSI 跌破40
            if last.get("rsi", 50) < 40:
                score += 2
                reasons.append(f"RSI={last.get('rsi', 0):.0f}<40")
            # MACD 柱状图翻负
            if last.get("macd_hist", 0) < 0 and prev.get("macd_hist", 0) > 0:
                score += 1
                reasons.append("MACD翻负")
            # ADX 衰竭
            if last.get("adx", 25) < 20:
                score += 1
                reasons.append(f"ADX={last.get('adx', 0):.0f}<20")
            # EMA 死叉
            if last.get("ema20", 0) < last.get("ema50", 0) and prev.get("ema20", 0) >= prev.get("ema50", 0):
                score += 2
                reasons.append("EMA死叉")
        else:
            # 双重确认：MACD histogram 明显正值 + 价格突破 EMA20
            macd_hist = last.get("macd_hist", 0)
            ema20 = last.get("ema20", price)
            
            dual_confirm = macd_hist > 0.5 and price > ema20
            if dual_confirm:
                score += 3
                reasons.append(f"MACD={macd_hist:.2f}>0.5且价格>EMA20")
            
            if last.get("rsi", 50) > 60:
                score += 2
                reasons.append(f"RSI={last.get('rsi', 0):.0f}>60")
            if last.get("macd_hist", 0) > 0 and prev.get("macd_hist", 0) < 0:
                score += 1
                reasons.append("MACD翻正")
            if last.get("adx", 25) < 20:
                score += 1
                reasons.append(f"ADX={last.get('adx', 0):.0f}<20")
            if last.get("ema20", 0) > last.get("ema50", 0) and prev.get("ema20", 0) <= prev.get("ema50", 0):
                score += 2
                reasons.append("EMA金叉")
        
        if score >= 4:
            logger.info(f"#{ticket} 🔄 趋势反转(score={score}) 全平{lots}手 | {' '.join(reasons)}")
            return {
                "action": "CLOSE",
                "ticket": ticket,
                "lots": lots,
                "reason": f"reversal_s{score}_{' '.join(reasons)}",
            }
        
        return None
    
    def _check_dynamic_trailing(self, ticket, state, pos, side, price,
                                 lots, atr, profit_atr) -> Optional[dict]:
        """
        动态追踪保护：从最高盈利回撤超过阈值时平仓
        - TP1 后：回撤 > max_profit * 50% 且 profit < 0.5 ATR → 全平
        - TP2 后：回撤 > max_profit * 40% → 全平
        """
        if not state.tp1_hit:
            return None
        
        max_p = state.max_profit_atr
        if max_p <= 0:
            return None
        
        drawdown = max_p - profit_atr
        
        if state.tp2_hit:
            # TP2 后更紧的追踪
            if drawdown > max_p * 0.4:
                logger.info(f"#{ticket} 📉 TP2后回撤{drawdown:.1f}ATR (max={max_p:.1f})，保护平仓")
                return {
                    "action": "CLOSE",
                    "ticket": ticket,
                    "lots": lots,
                    "reason": f"trail_tp2_dd{drawdown:.1f}",
                }
        else:
            # TP1 后
            if drawdown > max_p * 0.5 and profit_atr < 0.5:
                logger.info(f"#{ticket} 📉 TP1后回撤严重 profit={profit_atr:.1f}ATR (max={max_p:.1f})，保护平仓")
                return {
                    "action": "CLOSE",
                    "ticket": ticket,
                    "lots": lots,
                    "reason": f"trail_tp1_dd{drawdown:.1f}",
                }
        
        return None

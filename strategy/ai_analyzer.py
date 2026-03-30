"""
AI 智能分析模块 v2
流程：技术分析 → 按周期汇总 → AI 分周期研判 → 合并最终策略
"""
import json
import time
import logging
import threading
import requests
from typing import Optional, List

logger = logging.getLogger(__name__)

AI_CONFIG = {
    "enabled": True,
    "interval": 60,
    "timeout": 60,
    "base_url": "https://api.wochirou.com/v1",
    "api_key": "sk-JyQaejQV8Q5xBAFLbBtQh2CSTffNtmSmDqu3oWCP6ZO2HkEH",
    "model": "qwen3.5-plus",
}


def _tf_summary(df, tf_name: str) -> dict:
    """提取单周期技术面摘要"""
    if df is None or len(df) < 20:
        return None
    
    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last
    
    trend = "多头" if last.get("ema20", 0) > last.get("ema50", 0) else "空头"
    macd_dir = "上升" if last.get("macd_hist", 0) > prev.get("macd_hist", 0) else "下降"
    
    # 最近5根K线简要
    bars_desc = []
    for i in range(-min(5, len(df)), 0):
        r = df.iloc[i]
        chg = r["close"] - r["open"]
        bars_desc.append(f"{'阳' if chg > 0 else '阴'}{abs(chg):.1f}")
    
    return {
        "timeframe": tf_name,
        "price": float(last.get("close", 0)),
        "ema20": float(last.get("ema20", 0)),
        "ema50": float(last.get("ema50", 0)),
        "rsi": float(last.get("rsi", 0)),
        "adx": float(last.get("adx", 0)),
        "macd_hist": float(last.get("macd_hist", 0)),
        "macd_direction": macd_dir,
        "atr": float(last.get("atr", 0)),
        "bb_upper": float(last.get("bb_upper", 0)),
        "bb_lower": float(last.get("bb_lower", 0)),
        "trend": trend,
        "recent_bars": " → ".join(bars_desc),
    }


class AIAnalyzer:
    """AI 辅助市场分析 v2"""
    
    def __init__(self):
        self.last_analysis_time = 0
        self.last_result = None
        self.lock = threading.Lock()
        self._running = False
    
    def should_analyze(self) -> bool:
        return time.time() - self.last_analysis_time >= AI_CONFIG["interval"]
    
    def analyze_with_technicals(self, dm, account: dict) -> Optional[dict]:
        """
        基于多周期技术面数据调用 AI 分析
        
        Returns:
            {
                "timeframes": {
                    "M15": {"bias":"...", "confidence":0-100, "summary":"..."},
                    "M30": {"bias":"...", "confidence":0-100, "summary":"..."},
                    "H1":  {"bias":"...", "confidence":0-100, "summary":"..."},
                },
                "combined": {
                    "bias": "bullish/bearish/neutral",
                    "confidence": 0-100,
                    "analysis": "...",
                    "exit_suggestion": "hold/tighten/close_partial/close_all",
                    "key_levels": [...],
                    "risk_warning": "..."
                }
            }
        """
        if not AI_CONFIG["enabled"]:
            return None
        
        # 收集各周期技术面数据
        tf_data = {}
        for tf_name, df in [("M15", dm.m15), ("M30", dm.m30), ("H1", dm.h1), ("H4", dm.h4)]:
            summary = _tf_summary(df, tf_name)
            if summary:
                tf_data[tf_name] = summary
        
        if not tf_data:
            return None
        
        # 持仓信息
        positions = []
        for pos in account.get("positions", {}).values():
            positions.append({
                "type": pos.get("type"),
                "lots": pos.get("lots"),
                "open_price": pos.get("open_price"),
                "profit": pos.get("profit", 0),
            })
        
        result = self._call_ai(tf_data, positions)
        if result:
            self.last_result = result
            self.last_analysis_time = time.time()
        
        return result
    
    def _build_prompt(self, tf_data: dict, positions: list) -> str:
        """构建多周期分析 prompt"""
        
        # 各周期技术面描述
        tf_sections = []
        for tf_name in ["M15", "M30", "H1", "H4"]:
            d = tf_data.get(tf_name)
            if not d:
                continue
            tf_sections.append(f"""### {tf_name} 周期
- 价格: {d['price']:.2f} | EMA20: {d['ema20']:.2f} | EMA50: {d['ema50']:.2f}
- RSI: {d['rsi']:.1f} | ADX: {d['adx']:.1f} | MACD柱: {d['macd_hist']:.3f} ({d['macd_direction']})
- ATR: {d['atr']:.2f} | 布林: [{d['bb_lower']:.2f}, {d['bb_upper']:.2f}]
- EMA趋势: {d['trend']}
- 最近K线: {d['recent_bars']}""")
        
        positions_str = "无持仓"
        if positions:
            positions_str = "\n".join([
                f"  - {p['type']} {p['lots']}手 @ {p['open_price']:.2f} 盈亏=${p.get('profit', 0):.2f}"
                for p in positions
            ])
        
        return f"""你是专业黄金(XAUUSD)量化交易分析师。请根据以下多周期技术面数据进行分析。

## 各周期技术面数据

{chr(10).join(tf_sections)}

## 当前持仓
{positions_str}

## 分析要求

请**分别**对每个时间周期进行独立研判，然后**综合**所有周期给出最终策略建议。

直接回复以下 JSON（不要 markdown 代码块，不要其他文字）：
{{"H4":{{"bias":"bullish/bearish/neutral","confidence":0-100,"summary":"一句话判断（主趋势周期，权重最高）"}},"M15":{{"bias":"bullish/bearish/neutral","confidence":0-100,"summary":"一句话判断"}},"M30":{{"bias":"bullish/bearish/neutral","confidence":0-100,"summary":"一句话判断"}},"H1":{{"bias":"bullish/bearish/neutral","confidence":0-100,"summary":"一句话判断"}},"combined":{{"bias":"bullish/bearish/neutral","confidence":0-100,"analysis":"综合多周期的最终判断","exit_suggestion":"hold/tighten/close_partial/close_all","exit_reason":"出场建议原因","key_levels":[关键价位数组],"risk_warning":"风险提示"}}}}"""
    
    def _call_ai(self, tf_data: dict, positions: list) -> Optional[dict]:
        """调用 AI API"""
        prompt = self._build_prompt(tf_data, positions)
        
        try:
            resp = requests.post(
                f"{AI_CONFIG['base_url']}/chat/completions",
                headers={
                    "Authorization": f"Bearer {AI_CONFIG['api_key']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": AI_CONFIG["model"],
                    "messages": [
                        {"role": "system", "content": "你是专业黄金交易分析师。只用纯JSON回复，不要markdown代码块，不要额外文字。"},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 800,
                },
                timeout=AI_CONFIG["timeout"],
            )
            
            if resp.status_code != 200:
                logger.warning(f"AI API 返回 {resp.status_code}: {resp.text[:200]}")
                return None
            
            content = resp.json()["choices"][0]["message"]["content"]
            content = content.strip()
            
            # 清理格式
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            if "<think>" in content:
                content = content.split("</think>")[-1].strip()
            
            result = json.loads(content.strip())
            
            # 验证结构
            combined = result.get("combined", {})
            bias = combined.get("bias", "neutral")
            conf = combined.get("confidence", 0)
            logger.info(f"🤖 AI多周期分析: 综合={bias}({conf}%) | H4={result.get('H4',{}).get('bias','?')} M15={result.get('M15',{}).get('bias','?')} M30={result.get('M30',{}).get('bias','?')} H1={result.get('H1',{}).get('bias','?')}")
            
            return result
            
        except requests.exceptions.Timeout:
            logger.warning("AI API 超时")
            return None
        except json.JSONDecodeError as e:
            logger.warning(f"AI 返回解析失败: {e}")
            return None
        except Exception as e:
            logger.error(f"AI API 异常: {e}")
            return None

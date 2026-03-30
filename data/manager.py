"""
数据管理器 - 服务端版
接收 EA 推送的K线数据，计算技术指标
"""
import logging
import pandas as pd
import numpy as np
from typing import Optional

logger = logging.getLogger(__name__)


class DataManager:
    """管理单个账户的行情数据"""
    
    def __init__(self):
        self.h1: Optional[pd.DataFrame] = None
        self.m30: Optional[pd.DataFrame] = None
        self.m15: Optional[pd.DataFrame] = None
        self.h4: Optional[pd.DataFrame] = None   # H4 主趋势周期
        self.d1: Optional[pd.DataFrame] = None   # D1 长周期结构
        self._current_price = 0
        self._current_atr = {}
    
    def update_from_bars(self, timeframe: str, bars: list):
        """从 EA 推送的K线数据更新"""
        if not bars:
            return
        
        df = pd.DataFrame(bars)
        
        # 确保数值类型
        for col in ['open', 'high', 'low', 'close']:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
        
        if 'volume' in df.columns:
            df['volume'] = pd.to_numeric(df['volume'], errors='coerce').fillna(0).astype(int)
        
        # 计算技术指标
        df = self._calc_indicators(df)
        
        if timeframe == "H1":
            self.h1 = df
        elif timeframe == "M30":
            self.m30 = df
        elif timeframe == "M15":
            self.m15 = df
        elif timeframe == "H4":
            self.h4 = df
        elif timeframe == "D1":
            self.d1 = df
        
        # 更新 ATR
        if len(df) >= 14:
            self._current_atr[timeframe] = df['atr'].iloc[-1]
        
        # 更新当前价格
        if len(df) > 0:
            self._current_price = df['close'].iloc[-1]
    
    def _calc_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """计算所有技术指标"""
        if len(df) < 20:
            return df
        
        close = df['close']
        high = df['high']
        low = df['low']
        
        # EMA
        df['ema20'] = close.ewm(span=20, adjust=False).mean()
        df['ema50'] = close.ewm(span=50, adjust=False).mean()
        df['ema200'] = close.ewm(span=200, adjust=False).mean() if len(df) >= 200 else np.nan
        
        # ATR(14)
        tr = pd.concat([
            high - low,
            (high - close.shift(1)).abs(),
            (low - close.shift(1)).abs(),
        ], axis=1).max(axis=1)
        df['atr'] = tr.rolling(14).mean()
        
        # RSI(14)
        delta = close.diff()
        gain = delta.where(delta > 0, 0).rolling(14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
        rs = gain / loss.replace(0, np.nan)
        df['rsi'] = 100 - (100 / (1 + rs))
        
        # MACD
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        df['macd'] = ema12 - ema26
        df['macd_signal'] = df['macd'].ewm(span=9, adjust=False).mean()
        df['macd_hist'] = df['macd'] - df['macd_signal']
        
        # ADX(14)
        df['adx'] = self._calc_adx(df, 14)
        
        # Bollinger Bands
        sma20 = close.rolling(20).mean()
        std20 = close.rolling(20).std()
        df['bb_upper'] = sma20 + 2 * std20
        df['bb_lower'] = sma20 - 2 * std20
        df['bb_mid'] = sma20
        
        # Stochastic
        low14 = low.rolling(14).min()
        high14 = high.rolling(14).max()
        df['stoch_k'] = 100 * (close - low14) / (high14 - low14).replace(0, np.nan)
        df['stoch_d'] = df['stoch_k'].rolling(3).mean()
        
        return df
    
    def _calc_adx(self, df: pd.DataFrame, period: int = 14) -> pd.Series:
        high = df['high']
        low = df['low']
        close = df['close']
        
        plus_dm = high.diff()
        minus_dm = -low.diff()
        plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0)
        minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0)
        
        tr = pd.concat([
            high - low,
            (high - close.shift(1)).abs(),
            (low - close.shift(1)).abs(),
        ], axis=1).max(axis=1)
        
        atr = tr.rolling(period).mean()
        plus_di = 100 * (plus_dm.rolling(period).mean() / atr.replace(0, np.nan))
        minus_di = 100 * (minus_dm.rolling(period).mean() / atr.replace(0, np.nan))
        
        dx = 100 * ((plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan))
        adx = dx.rolling(period).mean()
        
        return adx
    
    def current_price(self) -> float:
        return self._current_price
    
    def current_atr(self, timeframe: str = "H1") -> float:
        return self._current_atr.get(timeframe, 0)
    
    def get_dataframe(self, timeframe: str) -> Optional[pd.DataFrame]:
        if timeframe == "H1":
            return self.h1
        elif timeframe == "M30":
            return self.m30
        elif timeframe == "M15":
            return self.m15
        elif timeframe in ("H4", "4H"):
            return self.h4
        elif timeframe in ("D1", "1D"):
            return self.d1
        return None

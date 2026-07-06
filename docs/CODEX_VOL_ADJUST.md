# CODEX TASK: Add volatility-weighted lot sizing to AutoSpreadTrade

## Problem

Current `AutoSpreadTrade()` uses fixed `SpreadLots` for both legs (Brent and WTI). 
If Brent is more volatile than WTI (or vice versa), the dollar risk exposure is unequal between the two legs, 
reducing the effectiveness of the spread hedge.

## Solution

Use ATR (Average True Range, 14-period H1) to compute volatility ratio between the two symbols, 
then adjust lot sizes so each leg has equal dollar-volatility exposure.

## Formula

```
brentATR = iATR(SpreadSymbol1, PERIOD_H1, 14, 0)  // Brent 14-period H1 ATR
wtiATR   = iATR(SpreadSymbol2, PERIOD_H1, 14, 0)  // WTI 14-period H1 ATR

avgATR = (brentATR + wtiATR) / 2

// Adjust lots so each leg has ~equal volatility contribution
brentLots = SpreadLots * (avgATR / brentATR)
wtiLots   = SpreadLots * (avgATR / wtiATR)

// Normalize to broker lot step
brentLots = NormalizeVolume(SpreadSymbol1, brentLots)
wtiLots   = NormalizeVolume(SpreadSymbol2, wtiLots)
```

Example:
- Brent ATR = 1.20, WTI ATR = 1.00, SpreadLots = 0.05
- avgATR = 1.10
- brentLots = 0.05 * (1.10 / 1.20) = 0.0458 → normalized to 0.04
- wtiLots = 0.05 * (1.10 / 1.00) = 0.055 → normalized to 0.05

The higher-volatility leg gets slightly smaller lots, the lower-volatility leg gets slightly larger lots.

## File

Modify: `/root/gold-bot/mt4_ea/GoldBolt_Client.mq4`

## Changes

### 1. Replace fixed SpreadLots in AutoSpreadTrade()

In the `AutoSpreadTrade()` function, find the two places where `SpreadLots` is used for OrderSend:

**Place 1** — spread > EntryPts (around lines 2006-2014):
Replace:
```mql4
         int ticket1 = OrderSend(SpreadSymbol1, OP_SELL, SpreadLots, sellPrice, Slippage, 0, 0,
                                 "GB_SPREAD_SELL", SpreadMagicNumber, 0, clrRed);
```
With:
```mql4
         double volBrentLots = SpreadLots;
         double volWtiLots = SpreadLots;
         CalculateVolWeightedLots(volBrentLots, volWtiLots);
         int ticket1 = OrderSend(SpreadSymbol1, OP_SELL, volBrentLots, sellPrice, Slippage, 0, 0,
                                 "GB_SPREAD_SELL", SpreadMagicNumber, 0, clrRed);
```

And:
```mql4
         int ticket2 = OrderSend(SpreadSymbol2, OP_BUY, SpreadLots, buyPrice, Slippage, 0, 0,
                                 "GB_SPREAD_BUY", SpreadMagicNumber, 0, clrGreen);
```
With:
```mql4
         int ticket2 = OrderSend(SpreadSymbol2, OP_BUY, volWtiLots, buyPrice, Slippage, 0, 0,
                                 "GB_SPREAD_BUY", SpreadMagicNumber, 0, clrGreen);
```

**Place 2** — spread < -EntryPts (around lines 2027-2035):
Same pattern — replace `SpreadLots` with `volBrentLots` and `volWtiLots`.

Also update the Print() statements to show the actual lots used:
```mql4
         Print("✅ 价差开仓：#", ticket1, " ", SpreadSymbol1, " SELL ", volBrentLots, "手 @ ", sellPrice);
```
And similarly for the other OrderSend/Print calls.

### 2. Add CalculateVolWeightedLots() function

Add this NEW function BEFORE `AutoSpreadTrade()`:

```mql4
//+------------------------------------------------------------------+
//| 计算波动率加权手数（使用 H1 ATR）                                   |
//+------------------------------------------------------------------+
void CalculateVolWeightedLots(double &brentLots, double &wtiLots)
{
   double brentATR = iATR(SpreadSymbol1, PERIOD_H1, 14, 0);
   double wtiATR   = iATR(SpreadSymbol2, PERIOD_H1, 14, 0);
   
   // 如果 ATR 数据不可用，回退到原始手数
   if(brentATR <= 0 || wtiATR <= 0)
   {
      brentLots = NormalizeVolume(SpreadSymbol1, SpreadLots);
      wtiLots   = NormalizeVolume(SpreadSymbol2, SpreadLots);
      return;
   }
   
   double avgATR = (brentATR + wtiATR) / 2.0;
   
   // 调整：波动率大的腿手数缩小，波动率小的腿手数放大
   brentLots = SpreadLots * (avgATR / brentATR);
   wtiLots   = SpreadLots * (avgATR / wtiATR);
   
   // 归一化到经纪商步长
   brentLots = NormalizeVolume(SpreadSymbol1, brentLots);
   wtiLots   = NormalizeVolume(SpreadSymbol2, wtiLots);
   
   // 确保不小于最小手数
   double brentMin = MarketInfo(SpreadSymbol1, MODE_MINLOT);
   double wtiMin   = MarketInfo(SpreadSymbol2, MODE_MINLOT);
   if(brentMin > 0 && brentLots < brentMin) brentLots = brentMin;
   if(wtiMin > 0 && wtiLots < wtiMin)       wtiLots   = wtiMin;
}
```

### 3. Print the ATR values for debugging

Add this log line at the beginning of `AutoSpreadTrade()` after the frequency check (after line 1945), to help monitor volatility:

```mql4
   // 输出波动率信息便于监控
   double debugBrentATR = iATR(SpreadSymbol1, PERIOD_H1, 14, 0);
   double debugWtiATR = iATR(SpreadSymbol2, PERIOD_H1, 14, 0);
   if(debugBrentATR > 0 && debugWtiATR > 0)
      Print("🛢️ 波动率 Brent ATR=", debugBrentATR, " WTI ATR=", debugWtiATR, " 比例=", (debugBrentATR/debugWtiATR));
```

## Verification

After changes:
- AutoSpreadTrade() still works the same way for direction logic
- The only difference is that each leg uses its volatility-adjusted lot size
- If ATR data is unavailable, falls back to fixed SpreadLots (safe failover)
- No changes to OnInit, OnTick, or any other function
- All existing server-driven functions (ExecuteOpen, ExecuteCloseAll etc.) remain unchanged

## IMPORTANT NOTES

1. `iATR()` in MQL4: `double iATR(string symbol, int timeframe, int period, int shift)`
   - timeframe = PERIOD_H1 (use the constant)
   - period = 14
   - shift = 0 (current bar)

2. The `CalculateVolWeightedLots` function uses reference parameters (`double &brentLots, double &wtiLots`) to return values.

3. Make sure to call `CalculateVolWeightedLots` BEFORE the OrderSend calls, not inside them.

4. The Print log line should go right after the frequency check (after `lastCheck = TimeCurrent();` on line 1945).

5. If ATR returns 0 (insufficient history), fall back to normal SpreadLots.

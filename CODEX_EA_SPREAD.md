# CODEX TASK: Auto Brent-WTI Spread Trading (EA-side)

## Mission

Add automatic Brent-WTI crude oil spread trading to the EA (`GoldBolt_Client.mq4`). 
The EA monitors the spread between UKOilCash (Brent) and USOilCash (WTI), and automatically opens/closes pair trades when the spread exceeds thresholds.

## Architecture Context

**File:** `/root/gold-bot/mt4_ea/GoldBolt_Client.mq4`

**Existing spread infrastructure already in the EA:**
- Line 69: `extern bool EnableSpread = false;` — master switch for spread features
- Line 70: `extern int SpreadMagicNumber = 20250224;`
- Line 71-72: `extern string SpreadSymbol1 = "UKOIL";` and `SpreadSymbol2 = "USOIL";` — need to update defaults
- Line 73: `extern double SpreadLots = 0.05;`
- Line 90: `bool spreadSymbolsReady = false;`
- Line 196-202: `IsSpreadSymbol()` — checks if symbol is spread leg
- Line 201: Currently checks `SpreadSymbol1` and `SpreadSymbol2`
- Lines 825-893: `ExecuteOpen()` — opens a spread leg (guarded by EnableSpread)
- Lines 1006-1078: `ExecuteCloseAll()` — closes spread positions
- Lines 351-369: OnInit checks spread symbols availability
- `spreadSymbolsReady` flag is set in OnInit

**OnTick() structure (lines 431-482):**
- Every tick: SendTick()
- Every N seconds: SendHeartbeat, SendPositions, PollAndExecute
- Every BarInterval seconds: SendAllBars

## Requirements

### 1. Update Spread Symbol Defaults

Change `SpreadSymbol1` default from `"UKOIL"` to `"UKOilCash"` (line 71).
Change `SpreadSymbol2` default from `"USOIL"` to `"USOilCash"` (line 72).

### 2. Add New Extern Parameters (after line 73, before the communication config block)

Insert after `extern double SpreadLots = 0.05;`:

```mql4
// 自动价差交易参数
extern bool     AutoSpreadTrade      = true;     // 🛢️ 启用自动价差交易
extern int      SpreadEntryPts       = 150;      // 开仓阈值（点数），价差偏离超过此值开仓
extern int      SpreadExitPts        = 50;       // 平仓阈值（点数），价差回归到此时平仓
extern int      SpreadTradeInterval  = 60;       // 检查间隔（秒）
```

### 3. Add AutoSpreadTrade() Function

Add this NEW function near the end of the file (before the last closing brace, around line 1920):

```mql4
//+------------------------------------------------------------------+
//| 自动价差交易（Brent-WTI spread）                                    |
//+------------------------------------------------------------------+
void AutoSpreadTrade()
{
   if(!AutoSpreadTrade) return;
   if(!EnableSpread) return;
   if(!spreadSymbolsReady) return;
   
   // 频率控制
   static datetime lastCheck = 0;
   if(TimeCurrent() - lastCheck < SpreadTradeInterval) return;
   lastCheck = TimeCurrent();
   
   // 获取双腿价格
   double brentBid = MarketInfo(SpreadSymbol1, MODE_BID);
   double brentAsk = MarketInfo(SpreadSymbol1, MODE_ASK);
   double wtiBid   = MarketInfo(SpreadSymbol2, MODE_BID);
   double wtiAsk   = MarketInfo(SpreadSymbol2, MODE_ASK);
   
   if(brentBid <= 0 || brentAsk <= 0 || wtiBid <= 0 || wtiAsk <= 0)
   {
      Print("🛢️ 原油价差：价格数据不可用");
      return;
   }
   
   double brentMid = (brentBid + brentAsk) / 2;
   double wtiMid   = (wtiBid + wtiAsk) / 2;
   double spread = brentMid - wtiMid;  // Brent - WTI spread
   
   // 获取经纪商价格精度
   int brentDigits = (int)MarketInfo(SpreadSymbol1, MODE_DIGITS);
   int wtiDigits   = (int)MarketInfo(SpreadSymbol2, MODE_DIGITS);
   double brentPoint = MarketInfo(SpreadSymbol1, MODE_POINT);
   double wtiPoint   = MarketInfo(SpreadSymbol2, MODE_POINT);
   
   // 检查已有价差持仓
   int spreadLongCount = 0;  // UKOilCash BUY + USOilCash SELL
   int spreadShortCount = 0; // UKOilCash SELL + USOilCash BUY
   double ukLongLots = 0, usShortLots = 0;
   double ukShortLots = 0, usLongLots = 0;
   
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderMagicNumber() != SpreadMagicNumber) continue;
      
      string sym = OrderSymbol();
      int type = OrderType();
      
      if(sym == SpreadSymbol1) // UKOilCash leg
      {
         if(type == OP_BUY)  { spreadLongCount++;  ukLongLots  += OrderLots(); }
         if(type == OP_SELL) { spreadShortCount++; ukShortLots += OrderLots(); }
      }
      else if(sym == SpreadSymbol2) // USOilCash leg
      {
         if(type == OP_BUY)  { spreadShortCount++; usLongLots  += OrderLots(); }
         if(type == OP_SELL) { spreadLongCount++;  usShortLots += OrderLots(); }
      }
   }
   
   // 计算价差点数（标准化到WTI点数）
   double spreadPoints = spread / wtiPoint;
   int spreadPointsInt = (int)MathRound(spreadPoints);
   
   // ====== 开仓逻辑 ======
   if(spreadLongCount == 0 && spreadShortCount == 0)
   {
      // 价差过大：Brent >> WTI → SELL Brent, BUY WTI（做窄价差）
      if(spreadPointsInt > SpreadEntryPts)
      {
         Print("🛢️ 价差过大 ", spreadPointsInt, "点 > ", SpreadEntryPts, "点 → 做窄价差：SELL ", SpreadSymbol1, " + BUY ", SpreadSymbol2);
         
         double sellPrice = MarketInfo(SpreadSymbol1, MODE_BID);
         double buyPrice  = MarketInfo(SpreadSymbol2, MODE_ASK);
         
         int ticket1 = OrderSend(SpreadSymbol1, OP_SELL, SpreadLots, sellPrice, Slippage, 0, 0,
                                 "GB_SPREAD_SELL", SpreadMagicNumber, 0, clrRed);
         if(ticket1 > 0)
            Print("✅ 价差开仓：#", ticket1, " ", SpreadSymbol1, " SELL ", SpreadLots, "手 @ ", sellPrice);
         else
            Print("❌ 价差开仓失败 SELL ", SpreadSymbol1, " Error#", GetLastError());
         
         int ticket2 = OrderSend(SpreadSymbol2, OP_BUY, SpreadLots, buyPrice, Slippage, 0, 0,
                                 "GB_SPREAD_BUY", SpreadMagicNumber, 0, clrGreen);
         if(ticket2 > 0)
            Print("✅ 价差开仓：#", ticket2, " ", SpreadSymbol2, " BUY ", SpreadLots, "手 @ ", buyPrice);
         else
            Print("❌ 价差开仓失败 BUY ", SpreadSymbol2, " Error#", GetLastError());
      }
      // 价差过小（负价差）：Brent << WTI → BUY Brent, SELL WTI（做阔价差）
      else if(spreadPointsInt < -SpreadEntryPts)
      {
         Print("🛢️ 价差过小 ", spreadPointsInt, "点 < -", SpreadEntryPts, "点 → 做阔价差：BUY ", SpreadSymbol1, " + SELL ", SpreadSymbol2);
         
         double buyPrice  = MarketInfo(SpreadSymbol1, MODE_ASK);
         double sellPrice = MarketInfo(SpreadSymbol2, MODE_BID);
         
         int ticket1 = OrderSend(SpreadSymbol1, OP_BUY, SpreadLots, buyPrice, Slippage, 0, 0,
                                 "GB_SPREAD_BUY", SpreadMagicNumber, 0, clrGreen);
         if(ticket1 > 0)
            Print("✅ 价差开仓：#", ticket1, " ", SpreadSymbol1, " BUY ", SpreadLots, "手 @ ", buyPrice);
         else
            Print("❌ 价差开仓失败 BUY ", SpreadSymbol1, " Error#", GetLastError());
         
         int ticket2 = OrderSend(SpreadSymbol2, OP_SELL, SpreadLots, sellPrice, Slippage, 0, 0,
                                 "GB_SPREAD_SELL", SpreadMagicNumber, 0, clrRed);
         if(ticket2 > 0)
            Print("✅ 价差开仓：#", ticket2, " ", SpreadSymbol2, " SELL ", SpreadLots, "手 @ ", sellPrice);
         else
            Print("❌ 价差开仓失败 SELL ", SpreadSymbol2, " Error#", GetLastError());
      }
   }
   
   // ====== 平仓逻辑 ======
   if(spreadLongCount > 0 && spreadShortCount == 0)
   {
      // 做窄价差持仓（SELL Brent + BUY WTI）：价差回归到 ExitPts 以内时平仓
      if(MathAbs(spreadPointsInt) <= SpreadExitPts)
      {
         Print("🛢️ 价差回归 ", spreadPointsInt, "点 ≤ ", SpreadExitPts, "点 → 平仓价差持仓");
         CloseAllSpreadPositions();
      }
   }
   else if(spreadShortCount > 0 && spreadLongCount == 0)
   {
      // 做阔价差持仓（BUY Brent + SELL WTI）：价差回归到 ExitPts 以内时平仓
      if(MathAbs(spreadPointsInt) <= SpreadExitPts)
      {
         Print("🛢️ 价差回归 ", spreadPointsInt, "点 ≤ ", SpreadExitPts, "点 → 平仓价差持仓");
         CloseAllSpreadPositions();
      }
   }
}

//+------------------------------------------------------------------+
//| 平仓所有价差持仓                                                  |
//+------------------------------------------------------------------+
void CloseAllSpreadPositions()
{
   int closed = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderMagicNumber() != SpreadMagicNumber) continue;
      
      int ticket = OrderTicket();
      string symbol = OrderSymbol();
      double lots = OrderLots();
      double closePrice = (OrderType() == OP_BUY) ? MarketInfo(symbol, MODE_BID) : MarketInfo(symbol, MODE_ASK);
      color clr = (OrderType() == OP_BUY) ? clrRed : clrGreen;
      
      if(OrderClose(ticket, lots, closePrice, Slippage, clr))
      {
         Print("✅ 平仓成功：#", ticket, " ", symbol, " ", lots, "手");
         closed++;
      }
      else
      {
         Print("❌ 平仓失败：#", ticket, " ", symbol, " Error#", GetLastError());
      }
   }
   Print("🛢️ 价差平仓完成：共平 ", closed, " 单");
}
```

### 4. Call AutoSpreadTrade() in OnTick()

Insert the call in OnTick() after the existing poll logic block (after line 464, before bar sending), INSIDE the `if(gbRegistered)` block:

```mql4
      // 自动价差交易
      AutoSpreadTrade();
```

Add it AFTER `lastPollTime = now;` (line 463) and BEFORE `}` that closes the poll block (line 464).

Specifically, the code structure around line 458-464 should become:

```mql4
    if(gbRegistered && now - lastPollTime >= PollInterval)
    {
       SendHeartbeat();
       SendPositions();
       PollAndExecute();
       AutoSpreadTrade();  // <-- ADD THIS LINE
       lastPollTime = now;
    }
```

### 5. Update SpreadSymbol Check in Existing Functions

The existing `IsSpreadSymbol()` (line 196-202) and `ExecuteOpen()` already use `SpreadSymbol1` and `SpreadSymbol2` variables, so they will automatically work with the new defaults. No changes needed to those functions.

## Verification

After changes, verify the EA compiles:
- The EA file should parse without syntax errors
- All existing functions (ExecuteOpen, ExecuteCloseAll, PollAndExecute, OnTick) should remain unchanged
- The new AutoSpreadTrade() and CloseAllSpreadPositions() should be the only additions

## IMPORTANT NOTES

1. **MQL4 syntax**: Use `StringLen()` not `.length()`, `MathAbs()` not `abs()`, `MathRound()` not `round()`
2. **OrderSend return value**: Returns ticket number (>0 = success) or -1 (failure)
3. **GetLastError()**: Call immediately after failed OrderSend/OrderClose to get error code
4. **Do NOT modify** existing ExecuteOpen/ExecuteCloseAll/ExecuteClosePartial functions — they're kept for server-driven mode compatibility
5. **Do NOT modify** OnInit() or the existing registration/symbol checking logic
6. **Spread calculation**: Brent - WTI difference in points. WTI is typically quoted with 2 decimal places (0.01), Brent also 2 decimals
7. **OrderSelect loop**: Always iterate backwards (`i = OrdersTotal() - 1; i >= 0; i--`) when closing/modifying within loop
8. **The `spreadSymbolsReady` flag** is already set in OnInit() when both symbols are available

## Files

Modify: `/root/gold-bot/mt4_ea/GoldBolt_Client.mq4`

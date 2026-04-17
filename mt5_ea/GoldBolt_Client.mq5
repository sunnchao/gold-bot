//+------------------------------------------------------------------+
//| GoldBolt_Client.mq5                                               |
//| 纯执行器 - 所有策略逻辑在服务端                                     |
//| EA 只负责：风控参数 + 执行指令 + 推送数据                           |
//| v2.5: 服务器重启自动恢复连接                                        |
//+------------------------------------------------------------------+
#property copyright "Gold Bolt"
#property version   "2.8"
#property strict

// 引入交易库
#include <Trade/Trade.mqh>

// ============ 版本信息 ============
#define EA_VERSION  "2.8.0"
#define EA_BUILD    6

CTrade trade;

//+------------------------------------------------------------------+
//| 服务器连接配置                                                      |
//+------------------------------------------------------------------+
input string   ServerURL       = "http://127.0.0.1:8880";  // 服务端地址
input string   AccountID       = "account_A";              // 账户 ID
input string   ApiToken        = "";                       // API Token

//+------------------------------------------------------------------+
//| 风控参数配置（用户自行调整）                                        |
//+------------------------------------------------------------------+
input double   MaxRiskPercent  = 2.0;      // 单笔最大风险 %
input int      MaxPositions    = 5;        // 最大持仓数
input double   MaxDailyLoss    = 5.0;      // 日最大亏损 %
input double   MaxSpread       = 5.0;      // 最大点差（points）
input int      MaxSameDir      = 3;        // 同方向最大持仓数
input double   MaxFloatLoss    = 3.0;      // 最大浮亏 %
input bool     UseFixedLots    = true;     // 优先固定手数
input double   FixedLots       = 0.10;     // 固定手数（UseFixedLots=true 时生效）

//+------------------------------------------------------------------+
//| 策略启用配置（EA 端控制）                                           |
//+------------------------------------------------------------------+
input group "===== 策略开关与Magic编号 ====="
input bool     EnablePullback      = true;     // 📈 趋势回调策略
input int      PullbackMagic       = 20250231; //趋势回调 Magic

input bool     EnableBreakout      = true;     // 🔥 突破回踩策略
input int      BreakoutMagic       = 20250232; // 突破回踩 Magic

input bool     EnableDivergence    = true;     // 📊 RSI 背离策略
input int      DivergenceMagic     = 20250233; // RSI 背离 Magic

input bool     EnablePyramid       = true;     // 🏗️ 突破加仓策略
input int      PyramidMagic        = 20250234; // 突破加仓 Magic

input bool     EnableCounter       = false;    // 🔄 反向回调加仓
input int      CounterMagic        = 20250235; // 反向回调 Magic

input bool     EnableRange         = false;    // 📊 震荡市区间策略
input int      RangeMagic          = 20250236; // 震荡市区间 Magic

//+------------------------------------------------------------------+
//| 原油对冲套利配置                                                   |
//+------------------------------------------------------------------+
input group "===== 原油对冲套利 ====="
input bool     EnableSpread        = false;    // 🛢️ 启用原油对冲套利
input int      SpreadMagicNumber   = 20250224; // 原油策略魔术号
input string   SpreadSymbol1       = "UKOIL";  // 腿 1: Brent (布伦特)
input string   SpreadSymbol2       = "USOIL";  // 腿 2: WTI (美国)
input double   SpreadLots          = 0.05;     // 每腿交易手数

//+------------------------------------------------------------------+
//| 通信参数配置                                                       |
//+------------------------------------------------------------------+
input int      PollInterval        = 5;        // 轮询间隔（秒）
input int      BarInterval         = 60;       // K 线发送间隔（秒）
input int      BarCount            = 50;       // K 线数量
input string   Symbol_             = "XAUUSD"; // 主交易品种
input int      Slippage            = 3;        // 滑点（点数）

// ============ 全局变量 ============
datetime lastPollTime      = 0;
datetime lastBarTime       = 0;
double   dailyStartEquity  = 0;
int      httpTimeout       = 5000;
bool     spreadSymbolsReady = false;  // 原油品种是否可用

// ========== 连接状态跟踪（v2.8 新增） ==========
bool     gbConnected      = false;        // 当前连接状态
datetime lastSuccessTime  = 0;            // 最后成功通信时间
int      failCount        = 0;            // 连续失败次数
datetime lastReconnectTry = 0;            // 上次重连尝试时间
datetime lastRegisterTry  = 0;            // 上次注册尝试时间（每5秒重试）
bool     gbRegistered     = false;        // 注册是否成功

//+------------------------------------------------------------------+
//| 根据策略名称获取对应的 MagicNumber                                  |
//+------------------------------------------------------------------+
int GetStrategyMagic(string strategy)
{
   if(strategy == "pullback") return PullbackMagic;
   if(strategy == "breakout_retest") return BreakoutMagic;
   if(strategy == "divergence") return DivergenceMagic;
   if(strategy == "breakout_pyramid") return PyramidMagic;
   if(strategy == "counter_pullback") return CounterMagic;
   if(strategy == "range") return RangeMagic;
   return 0;
}

//+------------------------------------------------------------------+
bool IsStrategyEnabled(string strategy)
{
   if(strategy == "pullback") return EnablePullback;
   if(strategy == "breakout_retest") return EnableBreakout;
   if(strategy == "divergence") return EnableDivergence;
   if(strategy == "breakout_pyramid") return EnablePyramid;
   if(strategy == "counter_pullback") return EnableCounter;
   if(strategy == "range") return EnableRange;
   return false;
}

//+------------------------------------------------------------------+
bool SelectPositionByIndex(int index)
{
   if(index < 0 || index >= PositionsTotal())
      return false;

   ulong ticket = PositionGetTicket(index);
   if(ticket == 0)
      return false;

   return PositionSelectByTicket(ticket);
}

//+------------------------------------------------------------------+
bool IsOurMagic(long magic)
{
   if(magic == PullbackMagic) return true;
   if(magic == BreakoutMagic) return true;
   if(magic == DivergenceMagic) return true;
   if(magic == PyramidMagic) return true;
   if(magic == CounterMagic) return true;
   if(magic == RangeMagic) return true;
   if(magic == SpreadMagicNumber) return true;
   return false;
}

//+------------------------------------------------------------------+
bool IsPrimarySymbol(string symbol)
{
   return (symbol == Symbol_);
}

//+------------------------------------------------------------------+
bool IsSpreadSymbol(string symbol)
{
   if(StringLen(symbol) == 0)
      return false;

   return (symbol == SpreadSymbol1 || symbol == SpreadSymbol2);
}

//+------------------------------------------------------------------+
bool IsAllowedSymbol(string symbol)
{
   return (IsPrimarySymbol(symbol) || IsSpreadSymbol(symbol));
}

//+------------------------------------------------------------------+
bool IsTrackedSymbol(string symbol)
{
   return IsAllowedSymbol(symbol);
}

//+------------------------------------------------------------------+
double GetSymbolPoint(string symbol)
{
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0)
      point = _Point;
   return point;
}

//+------------------------------------------------------------------+
double GetCurrentSpreadPoints(string symbol)
{
   double currentSpread = (double)SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   if(currentSpread > 0)
      return currentSpread;

   double point = GetSymbolPoint(symbol);
   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   if(point <= 0 || bid <= 0 || ask <= 0)
      return -1.0;

   currentSpread = (ask - bid) / point;
   return currentSpread;
}

//+------------------------------------------------------------------+
int GetVolumeDigits(string symbol)
{
   double stepLots = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(stepLots <= 0)
      return 2;

   int digits = 0;
   while(digits < 8)
   {
      double rounded = MathRound(stepLots);
      if(MathAbs(stepLots - rounded) < 0.00000001)
         break;

      stepLots *= 10.0;
      digits++;
   }

   return digits;
}

//+------------------------------------------------------------------+
double NormalizeVolume(string symbol, double lots)
{
   double minLots  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLots  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double stepLots = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

   if(stepLots <= 0) stepLots = 0.01;
   if(minLots <= 0) minLots = stepLots;
   if(maxLots <= 0) maxLots = lots;

   lots = MathMax(minLots, MathMin(maxLots, lots));
   lots = MathFloor(lots / stepLots) * stepLots;
   return NormalizeDouble(MathMax(minLots, lots), GetVolumeDigits(symbol));
}

//+------------------------------------------------------------------+
double NormalizeCloseVolume(string symbol, double lots)
{
   double minLots  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLots  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double stepLots = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

   if(stepLots <= 0) stepLots = 0.01;
   if(minLots <= 0) minLots = stepLots;
   if(maxLots <= 0) maxLots = lots;

   lots = MathMax(0.0, MathMin(maxLots, lots));
   double normalizedLots = MathFloor((lots + 0.0000001) / stepLots) * stepLots;
   if(normalizedLots + 0.0000001 < minLots)
      return 0.0;

   return NormalizeDouble(normalizedLots, GetVolumeDigits(symbol));
}

//+------------------------------------------------------------------+
void PrepareTrade(string symbol, long magic)
{
   trade.SetExpertMagicNumber((ulong)magic);
   trade.SetDeviationInPoints((ulong)Slippage);
   trade.SetTypeFillingBySymbol(symbol);
}

//+------------------------------------------------------------------+
bool IsTradeRetcodeSuccess()
{
   uint retcode = trade.ResultRetcode();
   return (retcode == TRADE_RETCODE_DONE ||
           retcode == TRADE_RETCODE_PLACED);
}

//+------------------------------------------------------------------+
bool TradeOperationSucceeded(bool requestSent)
{
   return (requestSent && IsTradeRetcodeSuccess());
}

//+------------------------------------------------------------------+
bool IsTradeRetcodePartialFill()
{
   return (trade.ResultRetcode() == TRADE_RETCODE_DONE_PARTIAL);
}

//+------------------------------------------------------------------+
bool TradeOperationPartiallyFilled(bool requestSent)
{
   return (requestSent && IsTradeRetcodePartialFill());
}

//+------------------------------------------------------------------+
int GetTradeErrorCode()
{
   int err = (int)trade.ResultRetcode();
   if(err == 0)
      err = GetLastError();
   return err;
}

//+------------------------------------------------------------------+
string FormatLongValue(long value)
{
   return StringFormat("%I64d", value);
}

//+------------------------------------------------------------------+
string FormatULongValue(ulong value)
{
   return StringFormat("%I64u", value);
}

//+------------------------------------------------------------------+
ulong FindLatestPositionTicket(string symbol, long magic, ENUM_POSITION_TYPE posType)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!SelectPositionByIndex(i))
         continue;

      if(PositionGetString(POSITION_SYMBOL) != symbol)
         continue;

      if(PositionGetInteger(POSITION_MAGIC) != magic)
         continue;

      if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) != posType)
         continue;

      return (ulong)PositionGetInteger(POSITION_TICKET);
   }

   return 0;
}

//+------------------------------------------------------------------+
bool SelectedPositionMatches(string symbol, long magic, ENUM_POSITION_TYPE posType)
{
   if(PositionGetString(POSITION_SYMBOL) != symbol)
      return false;

   if(PositionGetInteger(POSITION_MAGIC) != magic)
      return false;

   if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) != posType)
      return false;

   return true;
}

//+------------------------------------------------------------------+
ulong FindPositionTicketByIdentifier(long positionId, string symbol, long magic, ENUM_POSITION_TYPE posType)
{
   if(positionId <= 0)
      return 0;

   ulong matchedTicket = 0;
   int matchedCount = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!SelectPositionByIndex(i))
         continue;

      if(PositionGetInteger(POSITION_IDENTIFIER) != positionId)
         continue;

      if(!SelectedPositionMatches(symbol, magic, posType))
         continue;

      matchedTicket = (ulong)PositionGetInteger(POSITION_TICKET);
      matchedCount++;
      if(matchedCount > 1)
      {
         Print("⚠️ position identifier 对应多个实时持仓，拒绝继续: id=", FormatLongValue(positionId));
         return 0;
      }
   }

   if(matchedCount == 1)
      return matchedTicket;

   return 0;
}

//+------------------------------------------------------------------+
ulong FindUniquePositionTicket(string symbol, long magic, ENUM_POSITION_TYPE posType)
{
   ulong matchedTicket = 0;
   int matchedCount = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!SelectPositionByIndex(i))
         continue;

      if(!SelectedPositionMatches(symbol, magic, posType))
         continue;

      matchedTicket = (ulong)PositionGetInteger(POSITION_TICKET);
      matchedCount++;
      if(matchedCount > 1)
      {
         Print("⚠️ 存在多个同 symbol/magic/type 持仓，无法安全解析目标持仓: ", symbol,
               " | Magic=", magic, " | Type=", (int)posType);
         return 0;
      }
   }

   if(matchedCount == 1)
      return matchedTicket;

   return 0;
}

//+------------------------------------------------------------------+
ulong ResolvePositionTicket(ulong rawTicket, string symbol, long magic, ENUM_POSITION_TYPE posType)
{
   if(rawTicket != 0 && PositionSelectByTicket(rawTicket) && SelectedPositionMatches(symbol, magic, posType))
      return rawTicket;

   ulong dealTicket = (ulong)trade.ResultDeal();
   if(dealTicket != 0 && HistoryDealSelect(dealTicket))
   {
      long positionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
      ulong ticketByIdentifier = FindPositionTicketByIdentifier(positionId, symbol, magic, posType);
      if(ticketByIdentifier != 0)
         return ticketByIdentifier;
   }

   return FindUniquePositionTicket(symbol, magic, posType);
}

//+------------------------------------------------------------------+
ulong ResolveLivePositionTicket(ulong rawTicket, string symbol, long magic, ENUM_POSITION_TYPE posType)
{
   ulong ticket = ResolvePositionTicket(rawTicket, symbol, magic, posType);
   if(ticket == 0)
      return 0;

   if(!PositionSelectByTicket(ticket))
      return 0;

   if(!SelectedPositionMatches(symbol, magic, posType))
      return 0;

   return ticket;
}

//+------------------------------------------------------------------+
string EnsureSignalProtectionAttached(ulong ticket, string type_str, double sl, double tp1)
{
   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      Print("⚠️ 开仓后未能选中持仓 #", FormatULongValue(ticket), "，无法安全附加保护止损");
      return "position_resolve_incomplete";
   }

   string positionSymbol = PositionGetString(POSITION_SYMBOL);
   long positionMagic = PositionGetInteger(POSITION_MAGIC);
   double current_sl = PositionGetDouble(POSITION_SL);
   double current_tp = PositionGetDouble(POSITION_TP);

   if(current_sl == 0.0 || current_tp == 0.0)
   {
      double min_stop = (double)SymbolInfoInteger(positionSymbol, SYMBOL_TRADE_STOPS_LEVEL) * GetSymbolPoint(positionSymbol);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double final_sl = sl;
      double final_tp = tp1;

      if(min_stop > 0)
      {
         if(MathAbs(openPrice - sl) < min_stop)
         {
            if(type_str == "BUY") final_sl = openPrice - min_stop;
            else final_sl = openPrice + min_stop;
         }

         if(MathAbs(tp1 - openPrice) < min_stop)
         {
            if(type_str == "BUY") final_tp = openPrice + min_stop;
            else final_tp = openPrice - min_stop;
         }
      }

      if(final_sl != current_sl || final_tp != current_tp)
      {
         PrepareTrade(positionSymbol, positionMagic);
         if(TradeOperationSucceeded(trade.PositionModify(ticket, final_sl, final_tp)))
            Print("📝 开仓后设置 TP/SL: SL=", final_sl, " TP=", final_tp);
         else
         {
            int mod_err = GetTradeErrorCode();
            Print("⚠️ 开仓成功但保护止损附加失败: #", FormatULongValue(ticket), " Error#", mod_err);
            return "protection_attach_failed";
         }
      }
   }

   if(!PositionSelectByTicket(ticket))
   {
      Print("⚠️ 开仓后无法重新选中持仓 #", FormatULongValue(ticket), "，保护状态未确认");
      return "position_resolve_incomplete";
   }

   if(PositionGetDouble(POSITION_SL) == 0.0 || PositionGetDouble(POSITION_TP) == 0.0)
   {
      Print("⚠️ 开仓后保护止损未完整附加: #", FormatULongValue(ticket));
      return "protection_attach_incomplete";
   }

   return "";
}

//+------------------------------------------------------------------+
int OnInit()
{
   Print("=== Gold Bolt Client v", EA_VERSION, " (Build ", EA_BUILD, ") ===");
   Print("服务器：", ServerURL);
   Print("账户 ID: ", AccountID);
   Print("策略Magic: 趋势回调=", PullbackMagic, " 突破回踩=", BreakoutMagic,
         " RSI背离=", DivergenceMagic, " 突破加仓=", PyramidMagic,
         " 反向回调=", CounterMagic, " 震荡区间=", RangeMagic);
   Print("风控：",
         (UseFixedLots ? ("固定手数=" + DoubleToString(FixedLots, 2)) : ("风险=" + DoubleToString(MaxRiskPercent, 1) + "%")),
         " | 持仓上限", MaxPositions,
         " | 日亏损", MaxDailyLoss, "% | 浮亏", MaxFloatLoss, "%");

   if(!IsSymbolAvailable(Symbol_))
   {
      Print("❌ 主交易品种不可用：", Symbol_);
      return INIT_FAILED;
   }

   if(_Symbol != Symbol_)
   {
      Print("❌ 图表品种与 Symbol_ 不一致 | Chart=", _Symbol, " | Symbol_=", Symbol_);
      return INIT_FAILED;
   }

   PrepareTrade(Symbol_, PullbackMagic);

   long marginMode = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   if(marginMode != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
   {
      Print("❌ 当前 MT5 账户不是 Hedging 模式，无法等价复刻 MQ4 多策略/多持仓逻辑");
      Print("   当前模式=", (int)marginMode, " | 需要 ACCOUNT_MARGIN_MODE_RETAIL_HEDGING");
      return INIT_FAILED;
   }

   if(EnableSpread)
   {
      Print("🛢️ 原油对冲套利：启用");
      Print("   Magic: ", SpreadMagicNumber);
      Print("   腿 1: ", SpreadSymbol1, " (BUY)");
      Print("   腿 2: ", SpreadSymbol2, " (SELL)");
      Print("   手数：", SpreadLots);

      if(IsSymbolAvailable(SpreadSymbol1) && IsSymbolAvailable(SpreadSymbol2))
      {
         spreadSymbolsReady = true;
         Print("   ✅ 品种可用");
      }
      else
      {
         spreadSymbolsReady = false;
         Print("   ⚠️ 品种不可用，请检查经纪商是否支持");
      }
   }
   else
   {
      Print("🛢️ 原油对冲套利：禁用");
   }

   Print("📊 扫描已有持仓...");
   int pullbackCount = 0, breakoutCount = 0, divergenceCount = 0;
   int pyramidCount = 0, counterCount = 0, rangeCount = 0, spreadCount = 0;

   for(int i = 0; i < PositionsTotal(); i++)
   {
      if(!SelectPositionByIndex(i))
         continue;

      string positionSymbol = PositionGetString(POSITION_SYMBOL);
      if(!IsAllowedSymbol(positionSymbol))
         continue;

      long magic = PositionGetInteger(POSITION_MAGIC);
      string type = ((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL");
      string info = positionSymbol + " " + type + " " +
                    DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) +
                    " 手 | Ticket=" + FormatLongValue(PositionGetInteger(POSITION_TICKET));

      if(magic == PullbackMagic)      { pullbackCount++;  Print("   📈 趋势回调: ", info); }
      else if(magic == BreakoutMagic) { breakoutCount++;  Print("   🔥 突破回踩: ", info); }
      else if(magic == DivergenceMagic){ divergenceCount++; Print("   📊 RSI背离: ", info); }
      else if(magic == PyramidMagic)  { pyramidCount++;   Print("   🏗️ 突破加仓: ", info); }
      else if(magic == CounterMagic)  { counterCount++;   Print("   🔄 反向回调: ", info); }
      else if(magic == RangeMagic)    { rangeCount++;     Print("   📊 震荡区间: ", info); }
      else if(magic == SpreadMagicNumber){ spreadCount++; Print("   🛢️ 原油对冲: ", info); }
   }

   Print("   趋势回调: ", pullbackCount, " 单 | 突破回踩: ", breakoutCount, " 单 | RSI背离: ", divergenceCount, " 单");
   Print("   突破加仓: ", pyramidCount, " 单 | 反向回调: ", counterCount, " 单 | 震荡区间: ", rangeCount, " 单");
   Print("   原油对冲: ", spreadCount, " 单");
   Print("=============================================");

   dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);

   CheckForUpdate();

   if(!RegisterAccount())
   {
      gbRegistered = false;
      Print("⚠️ 注册失败，OnTick 将每 5 秒重试...");
   }
   else
   {
      SendHeartbeat();
      SendAllBars();
      SendPositions();
   }

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnTick()
{
   datetime now = TimeCurrent();

   static bool firstTick = false;
   if(!firstTick)
   {
      Print("📡 首次 Tick 收到");
      firstTick = true;
   }

   SendTick();

   if(!gbRegistered && now - lastRegisterTry >= 5)
   {
      lastRegisterTry = now;
      Print("🔄 尝试注册 GB Server...");
      if(RegisterAccount())
      {
         Print("✅ 注册成功，发送初始数据...");
         SendHeartbeat();
         SendAllBars();
         SendPositions();
      }
   }

   if(gbRegistered && now - lastPollTime >= PollInterval)
   {
      SendHeartbeat();
      SendPositions();
      PollAndExecute();
      lastPollTime = now;
   }

   if(gbRegistered && now - lastBarTime >= BarInterval)
   {
      SendAllBars();
      lastBarTime = now;
   }

   static int lastDay = -1;
   MqlDateTime tm;
   TimeToStruct(now, tm);
   int today = tm.day;
   if(today != lastDay)
   {
      dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      lastDay = today;
      Print("📅 日切重置 | 起始权益：", dailyStartEquity);
   }
}

//+------------------------------------------------------------------+
//| 注册账户信息（含 broker 信息，服务端用于识别账户类型）               |
//+------------------------------------------------------------------+
bool RegisterAccount()
{
   string broker = AccountInfoString(ACCOUNT_COMPANY);
   string server = AccountInfoString(ACCOUNT_SERVER);
   string name = AccountInfoString(ACCOUNT_NAME);
   string type = "standard";
   if(StringFind(broker, "ECN") >= 0 || StringFind(server, "ECN") >= 0)
      type = "ecn";
   else if(StringFind(broker, "Pro") >= 0 || StringFind(server, "Pro") >= 0)
      type = "pro";

   int leverage = (int)AccountInfoInteger(ACCOUNT_LEVERAGE);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   if(StringLen(currency) == 0) currency = "USD";

   string json = StringFormat(
      "{"
      "\"account_id\":\"%s\"," 
      "\"symbol\":\"%s\"," 
      "\"magic\":%d," 
      "\"broker\":\"%s\"," 
      "\"server_name\":\"%s\"," 
      "\"account_name\":\"%s\"," 
      "\"account_type\":\"%s\"," 
      "\"currency\":\"%s\"," 
      "\"leverage\":%d," 
      "\"spread_enabled\":%s"
      "}",
      AccountID, Symbol_, PullbackMagic, broker, server, name, type, currency, leverage,
      (EnableSpread ? "true" : "false")
   );

   string resp = HttpPost("/register", json);
   if(StringLen(resp) > 0 && StringFind(resp, "OK") >= 0)
   {
      gbRegistered = true;
      gbConnected = true;
      lastSuccessTime = TimeCurrent();
      failCount = 0;
      Print("📋 账户注册成功 | Broker:", broker, " | Leverage:1:", leverage);
      return true;
   }

   Print("❌ 账户注册失败");
   return false;
}

//+------------------------------------------------------------------+
// 发送心跳（附带账户基础信息）
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   int pullbackPos = 0, breakoutPos = 0, divergencePos = 0;
   int pyramidPos = 0, counterPos = 0, rangePos = 0;

   for(int i = 0; i < PositionsTotal(); i++)
   {
      if(!SelectPositionByIndex(i))
         continue;

      if(!IsAllowedSymbol(PositionGetString(POSITION_SYMBOL)))
         continue;

      long m = PositionGetInteger(POSITION_MAGIC);
      if(m == PullbackMagic) pullbackPos++;
      else if(m == BreakoutMagic) breakoutPos++;
      else if(m == DivergenceMagic) divergencePos++;
      else if(m == PyramidMagic) pyramidPos++;
      else if(m == CounterMagic) counterPos++;
      else if(m == RangeMagic) rangePos++;
   }

   string json = StringFormat(
      "{"
      "\"account_id\":\"%s\"," 
      "\"symbol\":\"%s\"," 
      "\"magic\":%d," 
      "\"balance\":%.2f," 
      "\"equity\":%.2f," 
      "\"margin\":%.2f," 
      "\"free_margin\":%.2f," 
      "\"currency\":\"%s\"," 
      "\"strategies\":{"
      "\"pullback\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"breakout_retest\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"divergence\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"breakout_pyramid\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"counter_pullback\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"range\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d}"
      "}"
      "}",
      AccountID, Symbol_, PullbackMagic,
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      AccountInfoString(ACCOUNT_CURRENCY),
      (EnablePullback ? "true" : "false"), PullbackMagic, pullbackPos,
      (EnableBreakout ? "true" : "false"), BreakoutMagic, breakoutPos,
      (EnableDivergence ? "true" : "false"), DivergenceMagic, divergencePos,
      (EnablePyramid ? "true" : "false"), PyramidMagic, pyramidPos,
      (EnableCounter ? "true" : "false"), CounterMagic, counterPos,
      (EnableRange ? "true" : "false"), RangeMagic, rangePos
   );

   HttpPost("/heartbeat", json);
}

//+------------------------------------------------------------------+
// 发送实时报价（包含多品种价格）
//+------------------------------------------------------------------+
void SendTick()
{
   static datetime lastSend = 0;
   if(TimeCurrent() - lastSend < 1)
      return;

   lastSend = TimeCurrent();

   double bid = SymbolInfoDouble(Symbol_, SYMBOL_BID);
   double ask = SymbolInfoDouble(Symbol_, SYMBOL_ASK);
   double spread = GetCurrentSpreadPoints(Symbol_);
   if(spread < 0)
      spread = 0.0;

   string symbols_json = "";

   if(EnableSpread && spreadSymbolsReady)
   {
       double leg1_bid = SymbolInfoDouble(SpreadSymbol1, SYMBOL_BID);
       double leg2_bid = SymbolInfoDouble(SpreadSymbol2, SYMBOL_BID);
       double leg1_ask = SymbolInfoDouble(SpreadSymbol1, SYMBOL_ASK);
       double leg2_ask = SymbolInfoDouble(SpreadSymbol2, SYMBOL_ASK);

       if(leg1_ask <= 0)
          leg1_ask = leg1_bid + GetSymbolPoint(SpreadSymbol1) * 10.0;
       if(leg2_ask <= 0)
          leg2_ask = leg2_bid + GetSymbolPoint(SpreadSymbol2) * 10.0;

       if(leg1_bid > 0 && leg2_bid > 0)
       {
          double spread_val = leg1_bid - leg2_bid;
          symbols_json = StringFormat(
             ",\"symbols\":{"
             "\"%s\":{\"price\":%.2f,\"bid\":%.2f,\"ask\":%.2f},"
             "\"%s\":{\"price\":%.2f,\"bid\":%.2f,\"ask\":%.2f},"
             "\"SPREAD\":%.2f"
             "}",
             SpreadSymbol1, leg1_bid, leg1_bid, leg1_ask,
             SpreadSymbol2, leg2_bid, leg2_bid, leg2_ask,
             spread_val
          );
          Print("🛢️ 原油价格：", SpreadSymbol1, "=", leg1_bid, " | ", SpreadSymbol2, "=", leg2_bid,
                " | 价差=", DoubleToString(spread_val, 2));
       }
    }

   string json = StringFormat(
      "{"
      "\"account_id\":\"%s\"," 
      "\"magic\":%d," 
      "\"symbol\":\"%s\"," 
      "\"bid\":%.5f," 
      "\"ask\":%.5f," 
      "\"spread\":%.3f," 
      "\"time\":\"%s\"%s"
      "}",
      AccountID, PullbackMagic, Symbol_, bid, ask, spread, TimeToString(TimeCurrent(), TIME_SECONDS), symbols_json
   );

   HttpPost("/tick", json);
}

//+------------------------------------------------------------------+
// 发送所有 K 线数据
//+------------------------------------------------------------------+
void SendAllBars()
{
   SendBars("M1", PERIOD_M1);
   SendBars("M5", PERIOD_M5);
   SendBars("M15", PERIOD_M15);
   SendBars("M30", PERIOD_M30);
   SendBars("H1", PERIOD_H1);
   SendBars("H4", PERIOD_H4);
   SendBars("D1", PERIOD_D1);
}

//+------------------------------------------------------------------+
void SendBars(string tf_str, ENUM_TIMEFRAMES tf_period)
{
   string bars = "";
   for(int i = BarCount - 1; i >= 0; i--)
   {
      datetime t = iTime(Symbol_, tf_period, i);
      if(t == 0)
         continue;

      double o = iOpen(Symbol_, tf_period, i);
      double h = iHigh(Symbol_, tf_period, i);
      double l = iLow(Symbol_, tf_period, i);
      double c = iClose(Symbol_, tf_period, i);
      long   v = iVolume(Symbol_, tf_period, i);

      if(bars != "") bars += ",";
      bars += StringFormat(
         "{\"time\":%d,\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%d}",
         (int)t, o, h, l, c, (int)v
      );
   }

   string json = "{\"account_id\":\"" + AccountID +
                 "\",\"symbol\":\"" + Symbol_ +
                 "\",\"magic\":" + IntegerToString(PullbackMagic) +
                 ",\"timeframe\":\"" + tf_str +
                 "\",\"bars\":[" + bars + "]}";

   HttpPost("/bars", json);
}

//+------------------------------------------------------------------+
// 发送持仓信息
//+------------------------------------------------------------------+
void SendPositions()
{
   string positions = "";

   for(int i = 0; i < PositionsTotal(); i++)
   {
      if(!SelectPositionByIndex(i))
         continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      if(!IsAllowedSymbol(symbol))
         continue;

      long magic = PositionGetInteger(POSITION_MAGIC);
      if(!IsOurMagic(magic))
         continue;

      if(positions != "") positions += ",";

      string type = ((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL");
      positions += "{\"ticket\":" + FormatLongValue(PositionGetInteger(POSITION_TICKET)) +
                   ",\"symbol\":\"" + symbol +
                   "\",\"type\":\"" + type +
                   "\",\"lots\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) +
                   ",\"open_price\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 5) +
                   ",\"sl\":" + DoubleToString(PositionGetDouble(POSITION_SL), 5) +
                   ",\"tp\":" + DoubleToString(PositionGetDouble(POSITION_TP), 5) +
                   ",\"profit\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) +
                   ",\"open_time\":" + FormatLongValue(PositionGetInteger(POSITION_TIME)) +
                   ",\"comment\":\"" + PositionGetString(POSITION_COMMENT) +
                   "\",\"magic\":" + FormatLongValue(magic) + "}";
   }

   string json = StringFormat(
      "{\"account_id\":\"%s\",\"symbol\":\"%s\",\"magic\":%d,\"positions\":[%s]}",
      AccountID, Symbol_, PullbackMagic, positions
   );

   HttpPost("/positions", json);
}

// ============================================================
// 轮询并执行服务端指令
// EA 只是执行器，不做任何策略判断
// ============================================================
void PollAndExecute()
{
   string json = StringFormat("{\"account_id\":\"%s\",\"symbol\":\"%s\",\"magic\":%d}", AccountID, Symbol_, PullbackMagic);
   string response = HttpPost("/poll", json);

   if(StringLen(response) == 0) return;

   int count = GetJsonInt(response, "count");
   if(count == 0) return;

   Print("📨 收到 ", count, " 条指令");
   string commands_str = GetJsonArray(response, "commands");

   for(int i = 0; i < count; i++)
   {
      string cmd = GetArrayElement(commands_str, i);
      if(StringLen(cmd) == 0) continue;

      string action = GetJsonString(cmd, "action");
      string cmd_id = GetJsonString(cmd, "command_id");

      if(action == "SIGNAL")
         ExecuteSignal(cmd, cmd_id);
      else if(action == "MODIFY")
         ExecuteModify(cmd, cmd_id);
      else if(action == "CLOSE")
         ExecuteClose(cmd, cmd_id);
      else if(action == "CLOSE_PARTIAL")
         ExecuteClosePartial(cmd, cmd_id);
      else if(action == "CLOSE_ALL")
         ExecuteCloseAll(cmd, cmd_id);
      else if(action == "OPEN")
         ExecuteOpen(cmd, cmd_id);
      else if(action == "ADD")
         ExecuteAdd(cmd, cmd_id);
      else
         Print("未知指令类型：", action);
   }
}

// ============================================================
// 执行开仓指令 (用于价差交易)
// ============================================================
void ExecuteOpen(string cmd, string cmd_id)
{
   string symbol = GetJsonString(cmd, "symbol");
   string side   = GetJsonString(cmd, "side");
   double lots   = GetJsonDouble(cmd, "lots");
   string reason = GetJsonString(cmd, "reason");

   Print("🛢️ 价差开仓：", symbol, " ", side, " ", lots, "手 | ", reason);

   if(!EnableSpread)
   {
      Print("❌ 原油对冲套利未启用");
      ReportResult(cmd_id, "ERROR", 0, "spread_disabled");
      return;
   }

   if(!IsSpreadSymbol(symbol))
   {
      Print("❌ 非法价差腿品种：", symbol);
      ReportResult(cmd_id, "ERROR", 0, "spread_symbol_not_allowed");
      return;
   }

   if(!IsSymbolAvailable(symbol))
   {
      Print("❌ 品种不可用：", symbol);
      ReportResult(cmd_id, "ERROR", 0, "symbol_not_available");
      return;
   }

   if(side != "BUY" && side != "SELL")
   {
      Print("❌ 非法价差开仓方向：", side);
      ReportResult(cmd_id, "ERROR", 0, "invalid_side");
      return;
   }

   lots = NormalizeVolume(symbol, lots);
   string comment = "GB_SPREAD_" + reason;
   PrepareTrade(symbol, SpreadMagicNumber);

   bool result = false;
   ENUM_POSITION_TYPE posType = POSITION_TYPE_BUY;
   if(side == "BUY")
   {
      posType = POSITION_TYPE_BUY;
      result = trade.Buy(lots, symbol, 0.0, 0.0, 0.0, comment);
   }
   else if(side == "SELL")
   {
      posType = POSITION_TYPE_SELL;
      result = trade.Sell(lots, symbol, 0.0, 0.0, 0.0, comment);
   }

   if(TradeOperationSucceeded(result))
   {
      ulong rawTicket = (ulong)trade.ResultOrder();
      ulong ticket = ResolveLivePositionTicket(rawTicket, symbol, SpreadMagicNumber, posType);
      if(ticket == 0)
      {
         Print("⚠️ 价差开仓成交但未能解析实时持仓：order#", FormatULongValue(rawTicket), " ", symbol, " ", side, " ", lots, "手");
         ReportResult(cmd_id, "ERROR", (long)rawTicket, "position_resolve_incomplete");
         return;
      }

      Print("✅ 价差开仓成功：#", FormatULongValue(ticket), " ", symbol, " ", side, " ", lots, "手");
      ReportResult(cmd_id, "OK", (long)ticket, "");
   }
   else if(TradeOperationPartiallyFilled(result))
   {
      ulong rawTicket = (ulong)trade.ResultOrder();
      ulong ticket = ResolveLivePositionTicket(rawTicket, symbol, SpreadMagicNumber, posType);
      ulong reportTicket = ticket;
      if(reportTicket == 0)
         reportTicket = rawTicket;

      Print("⚠️ 价差开仓部分成交：#", FormatULongValue(reportTicket), " ", symbol, " ", side, " ", lots, "手");
      if(ticket == 0)
      {
         ReportResult(cmd_id, "ERROR", (long)reportTicket, "position_resolve_incomplete");
         return;
      }

      ReportResult(cmd_id, "ERROR", (long)ticket, "open_incomplete");
   }
   else
   {
      int err = GetTradeErrorCode();
      Print("❌ 价差开仓失败：Error#", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 执行加仓指令 (用于价差交易)
// ============================================================
void ExecuteAdd(string cmd, string cmd_id)
{
   ExecuteOpen(cmd, cmd_id);
}

// ============================================================
// 执行部分平仓指令 (用于价差交易)
// ============================================================
void ExecuteClosePartial(string cmd, string cmd_id)
{
   string symbol = GetJsonString(cmd, "symbol");
   double lots   = GetJsonDouble(cmd, "lots");
   string reason = GetJsonString(cmd, "reason");

   Print("🛢️ 价差部分平仓：", symbol, " ", lots, "手 | ", reason);

   if(!EnableSpread)
   {
      Print("❌ 原油对冲套利未启用");
      ReportResult(cmd_id, "ERROR", 0, "spread_disabled");
      return;
   }

   if(!IsSpreadSymbol(symbol))
   {
      Print("❌ 非法价差腿品种：", symbol);
      ReportResult(cmd_id, "ERROR", 0, "spread_symbol_not_allowed");
      return;
   }

   double remainingLots = lots;
   bool matchedPosition = false;
   bool closedAny = false;
   bool closeFailed = false;
   ulong lastTicket = 0;
   ulong failedTicket = 0;

   for(int i = PositionsTotal() - 1; i >= 0 && remainingLots > 0.0000001; i--)
   {
      if(!SelectPositionByIndex(i))
         continue;

      if(PositionGetString(POSITION_SYMBOL) != symbol)
         continue;

       long magic = PositionGetInteger(POSITION_MAGIC);
       if(magic != SpreadMagicNumber)
          continue;

       matchedPosition = true;

        ulong ticket = (ulong)PositionGetInteger(POSITION_TICKET);
        double positionVolumeBefore = PositionGetDouble(POSITION_VOLUME);
        double closeLots = MathMin(remainingLots, positionVolumeBefore);
        closeLots = NormalizeCloseVolume(symbol, closeLots);
        if(closeLots <= 0)
           continue;

      PrepareTrade(symbol, magic);

      bool result = trade.PositionClosePartial(ticket, closeLots, (ulong)Slippage);
       if(TradeOperationSucceeded(result))
       {
          remainingLots -= closeLots;
          remainingLots = MathMax(0.0, remainingLots);
          closedAny = true;
          lastTicket = ticket;
          Print("✅ 部分平仓成功：#", FormatULongValue(ticket), " ", symbol, " ", closeLots,
                "手 | 剩余=", DoubleToString(MathMax(0.0, remainingLots), 2));
       }
       else if(TradeOperationPartiallyFilled(result))
       {
          double filledLots = 0.0;
          if(PositionSelectByTicket(ticket))
             filledLots = NormalizeCloseVolume(symbol, MathMax(0.0, positionVolumeBefore - PositionGetDouble(POSITION_VOLUME)));

          if(filledLots > 0.0)
          {
             remainingLots -= filledLots;
             remainingLots = MathMax(0.0, remainingLots);
             closedAny = true;
             lastTicket = ticket;
          }

          Print("⚠️ 部分平仓部分成交：#", FormatULongValue(ticket), " ", symbol,
                " | 请求=", DoubleToString(closeLots, GetVolumeDigits(symbol)),
                "手 | 实际成交=", DoubleToString(filledLots, GetVolumeDigits(symbol)),
                "手 | 剩余请求=", DoubleToString(MathMax(0.0, remainingLots), GetVolumeDigits(symbol)), "手");
          ReportResult(cmd_id, "ERROR", (long)ticket, "partial_close_incomplete");
          return;
       }
       else
       {
          int err = GetTradeErrorCode();
          closeFailed = true;
          failedTicket = ticket;
          Print("❌ 部分平仓失败：#", FormatULongValue(ticket), " ", symbol, " ", closeLots,
                "手 | Error#", err);
          break;
       }
    }

    if(!matchedPosition)
    {
       Print("❌ 未找到对应持仓");
       ReportResult(cmd_id, "ERROR", 0, "position_not_found");
       return;
    }

    if(closeFailed)
    {
       ReportResult(cmd_id, "ERROR", (long)failedTicket, "close_failed");
       return;
    }

    if(remainingLots <= 0.0000001)
    {
       ReportResult(cmd_id, "OK", (long)lastTicket, "");
       return;
    }

   if(closedAny)
   {
      Print("⚠️ 部分平仓未完成：剩余 ", DoubleToString(MathMax(0.0, remainingLots), 2), " 手未成交");
       ReportResult(cmd_id, "ERROR", (long)lastTicket, "partial_close_incomplete");
       return;
    }

    Print("⚠️ 部分平仓未完成：请求手数无法完全执行，剩余 ", DoubleToString(MathMax(0.0, remainingLots), 2), " 手");
    ReportResult(cmd_id, "ERROR", 0, "partial_close_incomplete");
}

// ============================================================
// 执行全部平仓指令 (用于价差交易)
// ============================================================
void ExecuteCloseAll(string cmd, string cmd_id)
{
   string symbol = GetJsonString(cmd, "symbol");
   double lots   = GetJsonDouble(cmd, "lots");
   string reason = GetJsonString(cmd, "reason");

   Print("🛢️ 价差全部平仓：", symbol, " ", lots, "手 | ", reason);

   if(!EnableSpread)
   {
      Print("❌ 原油对冲套利未启用");
      ReportResult(cmd_id, "ERROR", 0, "spread_disabled");
      return;
   }

   if(!IsSpreadSymbol(symbol))
   {
      Print("❌ 非法价差腿品种：", symbol);
      ReportResult(cmd_id, "ERROR", 0, "spread_symbol_not_allowed");
      return;
   }

   int closedCount = 0;
   bool matchedPosition = false;
   bool closeFailed = false;
   bool closeIncomplete = false;
   ulong failedTicket = 0;
   ulong incompleteTicket = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!SelectPositionByIndex(i))
         continue;

      if(PositionGetString(POSITION_SYMBOL) != symbol)
         continue;

       long magic = PositionGetInteger(POSITION_MAGIC);
       if(magic != SpreadMagicNumber)
          continue;

       matchedPosition = true;

       ulong ticket = (ulong)PositionGetInteger(POSITION_TICKET);
        PrepareTrade(symbol, magic);

        bool result = trade.PositionClose(ticket, (ulong)Slippage);
       if(TradeOperationSucceeded(result))
        {
           Print("✅ 平仓成功：#", FormatULongValue(ticket), " ", symbol);
           closedCount++;
        }
       else if(TradeOperationPartiallyFilled(result))
       {
          closeIncomplete = true;
          incompleteTicket = ticket;
          Print("⚠️ 全部平仓未完成：#", FormatULongValue(ticket), " ", symbol, " | broker 部分成交，仍有剩余仓位");
       }
        else
        {
           int err = GetTradeErrorCode();
           closeFailed = true;
           failedTicket = ticket;
          Print("❌ 全部平仓失败：#", FormatULongValue(ticket), " ", symbol, " | Error#", err);
       }
    }

    if(!matchedPosition)
    {
       ReportResult(cmd_id, "ERROR", 0, "no_position_found");
       return;
    }

     if(closeFailed)
     {
        ReportResult(cmd_id, "ERROR", (long)failedTicket, "close_failed");
        return;
     }

     if(closeIncomplete)
     {
        ReportResult(cmd_id, "ERROR", (long)incompleteTicket, "close_incomplete");
        return;
     }

     if(closedCount > 0)
        ReportResult(cmd_id, "OK", closedCount, "");
}

// ============================================================
// 执行开仓信号（风控在本地，策略在服务端）
// ============================================================
void ExecuteSignal(string cmd, string cmd_id)
{
   string symbol   = GetJsonString(cmd, "symbol");
   string type_str = GetJsonString(cmd, "type");
   double sl       = GetJsonDouble(cmd, "sl");
   double tp1      = GetJsonDouble(cmd, "tp1");
   int    score    = GetJsonInt(cmd, "score");
   string strategy = GetJsonString(cmd, "strategy");

   Print("📡 信号：", type_str, " | SL=", sl, " TP=", tp1,
         " | ", strategy, " 评分:", score);

   if(StringLen(symbol) > 0 && !IsPrimarySymbol(symbol))
   {
      Print("❌ 信号品种不匹配：", symbol, " | 本实例=", Symbol_);
      ReportResult(cmd_id, "ERROR", 0, "symbol_mismatch");
      return;
   }

   if(type_str != "BUY" && type_str != "SELL")
   {
      Print("❌ 非法信号方向：", type_str);
      ReportResult(cmd_id, "ERROR", 0, "invalid_type");
      return;
   }

   int magicForOrder = GetStrategyMagic(strategy);
   if(magicForOrder <= 0)
   {
      Print("❌ 未知策略：", strategy);
      ReportResult(cmd_id, "ERROR", 0, "invalid_strategy");
      return;
   }

   if(!IsStrategyEnabled(strategy))
   {
      Print("❌ 策略未启用：", strategy);
      ReportResult(cmd_id, "ERROR", 0, "strategy_disabled");
      return;
   }

   if(!CheckRisk(type_str))
   {
      ReportResult(cmd_id, "REJECTED", 0, "risk_check_failed");
      return;
   }

   double price = 0.0;
   ENUM_POSITION_TYPE posType = POSITION_TYPE_BUY;
   if(type_str == "BUY")
   {
      posType = POSITION_TYPE_BUY;
      price = SymbolInfoDouble(Symbol_, SYMBOL_ASK);
   }
   else if(type_str == "SELL")
   {
      posType = POSITION_TYPE_SELL;
      price = SymbolInfoDouble(Symbol_, SYMBOL_BID);
   }

   double sl_distance = MathAbs(price - sl);
   double lots = CalcLots(sl_distance);
   string comment = "GB_" + strategy + "_S" + IntegerToString(score);

   PrepareTrade(Symbol_, magicForOrder);

   bool result = false;
   if(type_str == "BUY")
      result = trade.Buy(lots, Symbol_, 0.0, 0.0, 0.0, comment);
   else
      result = trade.Sell(lots, Symbol_, 0.0, 0.0, 0.0, comment);

   ulong rawTicket = (ulong)trade.ResultOrder();

   if(TradeOperationSucceeded(result))
   {
      ulong ticket = ResolveLivePositionTicket(rawTicket, Symbol_, magicForOrder, posType);
      if(ticket == 0)
      {
         Print("⚠️ 开仓成交但未能解析实时持仓：order#", FormatULongValue(rawTicket), " ", type_str, " ", lots, "手");
         ReportResult(cmd_id, "ERROR", (long)rawTicket, "position_resolve_incomplete");
         return;
      }

      string protectionStatus = EnsureSignalProtectionAttached(ticket, type_str, sl, tp1);
      if(protectionStatus != "")
      {
         ReportResult(cmd_id, "ERROR", (long)ticket, protectionStatus);
         return;
      }

      Print("✅ 开仓：#", FormatULongValue(ticket), " ", type_str, " ", lots, "手 @ ", price,
            " | Magic=", magicForOrder, " (", strategy, ")");
      ReportResult(cmd_id, "OK", (long)ticket, "");
   }
   else if(TradeOperationPartiallyFilled(result))
   {
      ulong ticket = ResolveLivePositionTicket(rawTicket, Symbol_, magicForOrder, posType);
      ulong reportTicket = ticket;
      if(reportTicket == 0)
         reportTicket = rawTicket;

      Print("⚠️ 开仓部分成交：#", FormatULongValue(reportTicket), " ", type_str, " ", lots, "手 @ ", price,
            " | Magic=", magicForOrder, " (", strategy, ")");

      if(ticket == 0)
      {
         ReportResult(cmd_id, "ERROR", (long)reportTicket, "position_resolve_incomplete");
         return;
      }

      string protectionStatus = EnsureSignalProtectionAttached(ticket, type_str, sl, tp1);
      if(protectionStatus != "")
      {
         ReportResult(cmd_id, "ERROR", (long)ticket, protectionStatus);
         return;
      }

      ReportResult(cmd_id, "ERROR", (long)ticket, "open_incomplete");
      return;
   }
   else
   {
      int err = GetTradeErrorCode();
      Print("❌ 开仓失败：Error#", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 执行改单指令（服务端决定止损止盈值）
// ============================================================
void ExecuteModify(string cmd, string cmd_id)
{
   ulong ticket = (ulong)GetJsonDouble(cmd, "ticket");
   double sl    = GetJsonDouble(cmd, "sl");
   double tp    = GetJsonDouble(cmd, "tp");

   Print("📝 改单：#", FormatULongValue(ticket), " SL=", sl, " TP=", tp);

   if(!PositionSelectByTicket(ticket))
   {
      Print("❌ 未找到订单 #", FormatULongValue(ticket));
      ReportResult(cmd_id, "ERROR", 0, "order_not_found");
      return;
   }

   string symbol = PositionGetString(POSITION_SYMBOL);
   if(!IsAllowedSymbol(symbol))
   {
      Print("❌ 订单品种不属于本实例：", symbol);
      ReportResult(cmd_id, "ERROR", 0, "symbol_not_allowed");
      return;
   }

   if(!IsOurMagic(PositionGetInteger(POSITION_MAGIC)))
   {
      Print("❌ 订单不属于本 EA：Magic=", FormatLongValue(PositionGetInteger(POSITION_MAGIC)));
      ReportResult(cmd_id, "ERROR", 0, "order_not_owned");
      return;
   }

   PrepareTrade(symbol, PositionGetInteger(POSITION_MAGIC));
   bool result = trade.PositionModify(ticket, sl, tp);
   if(TradeOperationSucceeded(result))
   {
      Print("✅ 改单成功");
      ReportResult(cmd_id, "OK", (long)ticket, "");
   }
   else
   {
      int err = GetTradeErrorCode();
      Print("❌ 改单失败：", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 执行平仓指令
// ============================================================
void ExecuteClose(string cmd, string cmd_id)
{
   ulong ticket = (ulong)GetJsonDouble(cmd, "ticket");
   string reason = GetJsonString(cmd, "reason");

   Print("📤 平仓：#", FormatULongValue(ticket), " | ", reason);

   if(!PositionSelectByTicket(ticket))
   {
      Print("❌ 未找到订单 #", FormatULongValue(ticket));
      ReportResult(cmd_id, "ERROR", 0, "order_not_found");
      return;
   }

   string sym = PositionGetString(POSITION_SYMBOL);
   if(!IsAllowedSymbol(sym))
   {
      Print("❌ 订单品种不属于本实例：", sym);
      ReportResult(cmd_id, "ERROR", 0, "symbol_not_allowed");
      return;
   }

   if(!IsOurMagic(PositionGetInteger(POSITION_MAGIC)))
   {
      Print("❌ 订单不属于本 EA：Magic=", FormatLongValue(PositionGetInteger(POSITION_MAGIC)));
      ReportResult(cmd_id, "ERROR", 0, "order_not_owned");
      return;
   }

   long magic = PositionGetInteger(POSITION_MAGIC);
   PrepareTrade(sym, magic);

   bool result = trade.PositionClose(ticket, (ulong)Slippage);
   if(TradeOperationSucceeded(result))
   {
      Print("✅ 平仓成功");
      ReportResult(cmd_id, "OK", (long)ticket, "");
   }
   else if(TradeOperationPartiallyFilled(result))
   {
      Print("⚠️ 平仓未完成：#", FormatULongValue(ticket), " | broker 部分成交，仍有剩余仓位");
      ReportResult(cmd_id, "ERROR", (long)ticket, "close_incomplete");
   }
   else
   {
      int err = GetTradeErrorCode();
      Print("❌ 平仓失败：", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 检查本地风控
// ============================================================
bool CheckRisk(string type_str)
{
   double currentSpread = GetCurrentSpreadPoints(Symbol_);
   if(currentSpread < 0)
   {
      Print("⚠️ 风控：无法获取有效报价/点差");
      return false;
   }

   if(currentSpread > MaxSpread)
   {
      Print("⚠️ 风控：点差过高 ", DoubleToString(currentSpread, 2), " > ", DoubleToString(MaxSpread, 2));
      return false;
   }

   int managedPositions = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      if(!SelectPositionByIndex(i))
         continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      if(!IsAllowedSymbol(symbol))
         continue;

      if(!IsOurMagic(PositionGetInteger(POSITION_MAGIC)))
         continue;

      managedPositions++;
   }

   if(managedPositions >= MaxPositions)
   {
      Print("⚠️ 风控：达到最大持仓数 ", MaxPositions);
      return false;
   }

   int sameDir = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      if(!SelectPositionByIndex(i))
         continue;

      if(!IsPrimarySymbol(PositionGetString(POSITION_SYMBOL)))
          continue;

      if(!IsOurMagic(PositionGetInteger(POSITION_MAGIC)))
         continue;

      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      if((type_str == "BUY" && posType == POSITION_TYPE_BUY) ||
         (type_str == "SELL" && posType == POSITION_TYPE_SELL))
      {
         sameDir++;
      }
   }

   if(sameDir >= MaxSameDir)
   {
      Print("⚠️ 风控：同方向持仓达到上限 ", MaxSameDir);
      return false;
   }

   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double dailyPnL = equity - dailyStartEquity;
   double dailyPnL_pct = 0.0;
   if(dailyStartEquity > 0)
      dailyPnL_pct = (dailyPnL / dailyStartEquity) * 100.0;

   if(dailyPnL_pct < -MaxDailyLoss)
   {
      Print("⚠️ 风控：日亏损达到 ", DoubleToString(-dailyPnL_pct, 2), "% > ", MaxDailyLoss, "%");
      return false;
   }

   double totalProfit = 0.0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      if(!SelectPositionByIndex(i))
         continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      if(!IsAllowedSymbol(symbol))
         continue;

      if(!IsOurMagic(PositionGetInteger(POSITION_MAGIC)))
         continue;

      totalProfit += PositionGetDouble(POSITION_PROFIT);
   }

   double floatLoss_pct = 0.0;
   if(equity > 0)
      floatLoss_pct = (totalProfit / equity) * 100.0;

   if(floatLoss_pct < -MaxFloatLoss)
   {
      Print("⚠️ 风控：浮亏达到 ", DoubleToString(-floatLoss_pct, 2), "% > ", MaxFloatLoss, "%");
      return false;
   }

   return true;
}

// ============================================================
// 计算手数（基于固定手数或风险百分比）
// ============================================================
double CalcLots(double sl_distance)
{
   if(UseFixedLots)
      return NormalizeVolume(Symbol_, FixedLots);

   double riskAmount = AccountInfoDouble(ACCOUNT_EQUITY) * (MaxRiskPercent / 100.0);
   double tickValue = SymbolInfoDouble(Symbol_, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(Symbol_, SYMBOL_TRADE_TICK_SIZE);

   if(tickValue <= 0 || tickSize <= 0 || sl_distance <= 0)
      return NormalizeVolume(Symbol_, 0.01);

   double lots = riskAmount / (sl_distance / tickSize * tickValue);
   lots = NormalizeDouble(lots, 2);
   return NormalizeVolume(Symbol_, MathMax(0.01, lots));
}

// ============================================================
// 检查品种是否可用
// ============================================================
bool IsSymbolAvailable(string sym)
{
   if(!SymbolSelect(sym, true))
      return false;

   return (SymbolInfoDouble(sym, SYMBOL_BID) > 0);
}

// ============================================================
// 报告指令执行结果给服务端
// ============================================================
void ReportResult(string cmd_id, string result, long ticket, string error)
{
   string json = "{\"account_id\":\"" + AccountID +
                 "\",\"command_id\":\"" + cmd_id +
                 "\",\"result\":\"" + result +
                 "\",\"ticket\":" + FormatLongValue(ticket) +
                 ",\"error\":\"" + error + "\"}";

   HttpPost("/order_result", json);
}

// ============================================================
// HTTP POST 请求
// ============================================================
string HttpPost(string path, string data)
{
   string url = ServerURL + path;

   char post_data[];
   StringToCharArray(data, post_data, 0, StringLen(data), CP_UTF8);

   char result_data[];
   string headers = "Content-Type: application/json\r\n";
   if(ApiToken != "")
      headers += "X-API-Token: " + ApiToken + "\r\n";

   string result_headers = "";
   int timeout = httpTimeout;

   int code = WebRequest("POST", url, headers, timeout, post_data, result_data, result_headers);
   if(code >= 200 && code < 300)
   {
      gbConnected = true;
      lastSuccessTime = TimeCurrent();
      failCount = 0;
      return CharArrayToString(result_data);
   }

   Sleep(500);
   result_headers = "";
   code = WebRequest("POST", url, headers, timeout, post_data, result_data, result_headers);

   if(code >= 200 && code < 300)
   {
      gbConnected = true;
      lastSuccessTime = TimeCurrent();
      failCount = 0;
      return CharArrayToString(result_data);
   }

   failCount++;
   if(failCount >= 3 && gbConnected)
   {
      gbConnected = false;
      Print("⚠️ GB Server 断连 | 失败次数：", failCount, " | 路径：", path);
   }

   return "";
}

// ============================================================
// 检查更新
// ============================================================
void CheckForUpdate()
{
   string json = StringFormat("{\"version\":\"%s\",\"build\":%d}", EA_VERSION, EA_BUILD);
   string resp = HttpPost("/version_check", json);

   if(StringLen(resp) > 0)
   {
      string latest = GetJsonString(resp, "latest_version");
      int build = GetJsonInt(resp, "latest_build");
      bool force = GetJsonBool(resp, "force_update");

      if(latest != EA_VERSION || build > EA_BUILD)
      {
         Print("📢 发现新版本：", latest, " (Build ", build, ")");
         if(force)
            Print("⚠️ 强制更新，请更新后重启 EA");
      }
   }
}

// ============================================================
// JSON 解析辅助函数
// ============================================================
string GetJsonString(string json, string key)
{
   string pattern = "\"" + key + "\":\"";
   int pos = StringFind(json, pattern);
   if(pos < 0) return "";

   int start = pos + StringLen(pattern);
   int end = StringFind(json, "\"", start);
   if(end < 0) return "";

   return StringSubstr(json, start, end - start);
}

double GetJsonDouble(string json, string key)
{
   string pattern = "\"" + key + "\":";
   int pos = StringFind(json, pattern);
   if(pos < 0) return 0;

   int start = pos + StringLen(pattern);
   string rest = StringSubstr(json, start);

   string num_str = "";
   for(int i = 0; i < StringLen(rest); i++)
   {
      ushort c = StringGetCharacter(rest, i);
      if((c >= 48 && c <= 57) || c == 46 || c == 45 || c == 101 || c == 69 || c == 43)
         num_str += StringSubstr(rest, i, 1);
      else if(StringLen(num_str) > 0)
         break;
   }

   if(StringLen(num_str) == 0) return 0;
   return StringToDouble(num_str);
}

int GetJsonInt(string json, string key)
{
   return (int)GetJsonDouble(json, key);
}

bool GetJsonBool(string json, string key)
{
   string pattern = "\"" + key + "\":";
   int pos = StringFind(json, pattern);
   if(pos < 0) return false;

   int start = pos + StringLen(pattern);
   string rest = StringSubstr(json, start, 5);
   return (StringSubstr(rest, 0, 4) == "true");
}

string GetJsonArray(string json, string key)
{
   string pattern = "\"" + key + "\":[";
   int pos = StringFind(json, pattern);
   if(pos < 0) return "";

   int start = pos + StringLen(pattern) - 1;
   int bracket_count = 0;
   int end = start;

   for(int i = start; i < StringLen(json); i++)
   {
      ushort c = StringGetCharacter(json, i);
      if(c == '[') bracket_count++;
      else if(c == ']')
      {
         bracket_count--;
         if(bracket_count == 0)
         {
            end = i;
            break;
         }
      }
   }

   return StringSubstr(json, start + 1, end - start - 1);
}

string GetArrayElement(string array_str, int index)
{
   int brace_count = 0;
   int start = -1;
   int current_index = 0;

   for(int i = 0; i < StringLen(array_str); i++)
   {
      ushort c = StringGetCharacter(array_str, i);
      if(c == '{')
      {
         if(brace_count == 0) start = i;
         brace_count++;
      }
      else if(c == '}')
      {
         brace_count--;
         if(brace_count == 0 && current_index == index)
            return StringSubstr(array_str, start, i - start + 1);
      }
      else if(c == ',' && brace_count == 0)
      {
         current_index++;
      }
   }

   return "";
}

//+------------------------------------------------------------------+

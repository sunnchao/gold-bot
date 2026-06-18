//+------------------------------------------------------------------+
//| GoldBolt_Client.mq4                                              |
//| 纯执行器 - 所有策略逻辑在服务端                                     |
//| EA 只负责：风控参数 + 执行指令 + 推送数据                           |
//| v2.5: 服务器重启自动恢复连接                                        |
//+------------------------------------------------------------------+
#property copyright "Gold Bolt"
#property version   "2.8"
#property strict

// 引入标准库
#include <StdLib.mqh>

// ============ 版本信息 ============
#define EA_VERSION  "2.8.3"
#define EA_BUILD    9

//+------------------------------------------------------------------+
//| 服务器连接配置                                                      |
//+------------------------------------------------------------------+
extern string   ServerURL       = "http://127.0.0.1:8880";  // 服务端地址
extern string   AccountID       = "account_A";              // 账户 ID
extern string   ApiToken        = "";                       // API Token

//+------------------------------------------------------------------+
//| 风控参数配置（用户自行调整）                                        |
//+------------------------------------------------------------------+
extern double   MaxRiskPercent  = 2.0;      // 单笔最大风险 %
extern int      MaxPositions    = 5;        // 最大持仓数
extern double   MaxDailyLoss    = 5.0;      // 日最大亏损 %
extern double   MaxSpread       = 5.0;      // 最大点差（points）
extern int      MaxSameDir      = 3;        // 同方向最大持仓数
extern double   MaxFloatLoss    = 3.0;      // 最大浮亏 %
extern bool     UseFixedLots    = true;     // 优先固定手数
extern double   FixedLots       = 0.10;     // 固定手数（UseFixedLots=true 时生效）

//+------------------------------------------------------------------+
//| 策略启用配置（EA 端控制）                                           |
//+------------------------------------------------------------------+
input group "===== 策略开关与Magic编号 ====="
extern bool     EnablePullback      = true;     // 📈 趋势回调策略
extern int      PullbackMagic       = 20250231; //趋势回调 Magic

extern bool     EnableBreakout      = true;     // 🔥 突破回踩策略
extern int      BreakoutMagic       = 20250232; // 突破回踩 Magic

extern bool     EnableDivergence    = true;     // 📊 RSI 背离策略
extern int      DivergenceMagic     = 20250233; // RSI 背离 Magic

extern bool     EnablePyramid       = true;     // 🏗️ 突破加仓策略
extern int      PyramidMagic        = 20250234; // 突破加仓 Magic

extern bool     EnableCounter       = false;    // 🔄 反向回调加仓
extern int      CounterMagic        = 20250235; // 反向回调 Magic

extern bool     EnableRange        = false;    // 📊 震荡市区间策略
extern int      RangeMagic        = 20250236; // 震荡市区间 Magic

extern bool     EnableMomentumScalp       = false;    // ⚡ 动量剥头皮策略
extern int      MomentumScalpMagic        = 20250237; // 动量剥头皮 Magic
extern bool     MomentumScalpUseFixedLots = true;     // 动量剥头皮使用固定手数
extern double   MomentumScalpFixedLots    = 0.05;     // 动量剥头皮固定手数
extern double   MomentumScalpRiskPercent  = 0.5;      // 动量剥头皮单笔风险 %

extern bool     EnableAISignal      = true;     // 🤖 AI 信号挂单策略
extern int      AISignalMagic       = 20250238; // AI 信号 Magic

//+------------------------------------------------------------------+
//| 原油对冲套利配置                                                   |
//+------------------------------------------------------------------+
input group "===== 原油对冲套利 ====="
extern bool     EnableSpread        = false;    // 🛢️ 启用原油对冲套利
extern int      SpreadMagicNumber   = 20250224; // 原油策略魔术号
extern string   SpreadSymbol1       = "UKOilCash";  // 腿 1: Brent (布伦特)
extern string   SpreadSymbol2       = "USOilCash";  // 腿 2: WTI (美国)
extern double   SpreadLots          = 0.05;     // 每腿交易手数
// 自动价差交易参数
extern bool     EnableAutoSpreadTrade = true;    // 🛢️ 启用自动价差交易
extern int      SpreadEntryPts       = 150;      // 开仓阈值（点数），价差偏离超过此值开仓
extern int      SpreadExitPts        = 50;       // 平仓阈值（点数），价差回归到此时平仓
extern int      SpreadTradeInterval  = 60;       // 检查间隔（秒）

//+------------------------------------------------------------------+
//| 通信参数配置                                                       |
//+------------------------------------------------------------------+
extern int      PollInterval    = 5;        // 轮询间隔（秒）
extern int      BarInterval     = 60;       // K 线发送间隔（秒）
extern int      BarCount        = 50;  // K 线数量      // K 线数量
extern string   Symbols         = "XAUUSD"; // 交易品种（逗号分隔多个，如 XAUUSD,XAGUSD,USOIL）
extern string   SymbolSuffix    = "";       // 经纪商品种后缀（如 .m, m#, _m），留空=无后缀
extern int      Slippage        = 3;        // 滑点（点数）

// ============ 全局变量 ============
datetime lastPollTime   = 0;
datetime lastBarTime    = 0;
double   dailyStartEquity = 0;
int      httpTimeout    = 5000;
bool     spreadSymbolsReady = false;  // 原油品种是否可用

// ========== 多品种支持 ==========
string   g_symbols[];          // 解析后的品种列表
int      g_symbolCount = 0;    // 品种数量

// ========== 连接状态跟踪（v2.8 新增） ==========
bool     gbConnected      = false;        // 当前连接状态
datetime lastSuccessTime  = 0;            // 最后成功通信时间
int      failCount        = 0;            // 连续失败次数
datetime lastReconnectTry = 0;            // 上次重连尝试时间
datetime lastRegisterTry  = 0;            // 上次注册尝试时间（每5秒重试）
bool     gbRegistered     = false;        // 注册是否成功

//+------------------------------------------------------------------+
//| 根据策略名称获取对应的 MagicNumber|
//+------------------------------------------------------------------+
int GetStrategyMagic(string strategy)
{
   if(strategy == "pullback") return PullbackMagic;
   if(strategy == "breakout_retest") return BreakoutMagic;
   if(strategy == "divergence") return DivergenceMagic;
   if(strategy == "breakout_pyramid") return PyramidMagic;
   if(strategy == "counter_pullback") return CounterMagic;
   if(strategy == "range") return RangeMagic;
   if(strategy == "momentum_scalp") return MomentumScalpMagic;
   if(strategy == "ai_signal") return AISignalMagic;
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
   if(strategy == "momentum_scalp") return EnableMomentumScalp;
   if(strategy == "ai_signal") return EnableAISignal;
   return false;
}

//+------------------------------------------------------------------+
//| 多品种解析与查询                                                     |
//+------------------------------------------------------------------+
// 解析逗号分隔的品种字符串到数组
void ParseSymbols(string symbolList)
{
   g_symbolCount = 0;
   string remaining = symbolList;
   
   while(StringLen(remaining) > 0)
   {
      // 找逗号
      int pos = StringFind(remaining, ",");
      string token;
      if(pos < 0)
      {
         token = remaining;
         remaining = "";
      }
      else
      {
         token = StringSubstr(remaining, 0, pos);
         remaining = StringSubstr(remaining, pos + 1);
      }
      
      // 去空格
      token = StringTrimLeft(token);
      token = StringTrimRight(token);
      
      if(StringLen(token) > 0)
      {
         ArrayResize(g_symbols, g_symbolCount + 1);
         g_symbols[g_symbolCount] = token;
         g_symbolCount++;
      }
   }
}

// 获取经纪商品种名称（加后缀）
string GetBrokerSymbol(string baseSymbol)
{
   if(StringLen(SymbolSuffix) == 0)
      return baseSymbol;
   return baseSymbol + SymbolSuffix;
}

// 在数组中查找品种
bool FindSymbolInArray(string sym)
{
   for(int i = 0; i < g_symbolCount; i++)
   {
      if(g_symbols[i] == sym)
         return true;
   }
   return false;
}

//+------------------------------------------------------------------+
bool IsPrimarySymbol(string sym)
{
   return FindSymbolInArray(sym);
}

//+------------------------------------------------------------------+
bool IsSpreadSymbol(string sym)
{
   if(StringLen(sym) == 0)
      return false;

   return (sym == SpreadSymbol1 || sym == SpreadSymbol2);
}

//+------------------------------------------------------------------+
bool IsAllowedSymbol(string sym)
{
   return (IsPrimarySymbol(sym) || IsSpreadSymbol(sym));
}

//+------------------------------------------------------------------+
bool IsOurMagic(int magic)
{
   if(magic == PullbackMagic) return true;
   if(magic == BreakoutMagic) return true;
   if(magic == DivergenceMagic) return true;
   if(magic == PyramidMagic) return true;
   if(magic == CounterMagic) return true;
   if(magic == RangeMagic) return true;
   if(magic == MomentumScalpMagic) return true;
   if(magic == AISignalMagic) return true;
   if(magic == SpreadMagicNumber) return true;
   return false;
}

//+------------------------------------------------------------------+
double GetSymbolPoint(string sym)
{
   string brokerSym = GetBrokerSymbol(sym);
   double point = MarketInfo(brokerSym, MODE_POINT);
   if(point <= 0)
      point = Point;

   return point;
}

//+------------------------------------------------------------------+
double GetCurrentSpreadPoints(string sym)
{
   double currentSpread = MarketInfo(sym, MODE_SPREAD);
   if(currentSpread > 0)
      return currentSpread;

   double point = GetSymbolPoint(sym);
   double bid = MarketInfo(sym, MODE_BID);
   double ask = MarketInfo(sym, MODE_ASK);
   if(point <= 0 || bid <= 0 || ask <= 0)
      return -1.0;

   currentSpread = (ask - bid) / point;
   return currentSpread;
}

//+------------------------------------------------------------------+
int GetVolumeDigits(string sym)
{
   double stepLots = MarketInfo(sym, MODE_LOTSTEP);
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
double NormalizeVolume(string sym, double lots)
{
   double minLots  = MarketInfo(sym, MODE_MINLOT);
   double maxLots  = MarketInfo(sym, MODE_MAXLOT);
   double stepLots = MarketInfo(sym, MODE_LOTSTEP);

   if(stepLots <= 0) stepLots = 0.01;
   if(minLots <= 0) minLots = stepLots;
   if(maxLots <= 0) maxLots = lots;

   lots = MathMax(minLots, MathMin(maxLots, lots));
   lots = MathFloor(lots / stepLots) * stepLots;
   return NormalizeDouble(MathMax(minLots, lots), GetVolumeDigits(sym));
}

//+------------------------------------------------------------------+
double NormalizeCloseVolume(string sym, double lots)
{
   double minLots  = MarketInfo(sym, MODE_MINLOT);
   double maxLots  = MarketInfo(sym, MODE_MAXLOT);
   double stepLots = MarketInfo(sym, MODE_LOTSTEP);

   if(stepLots <= 0) stepLots = 0.01;
   if(minLots <= 0) minLots = stepLots;
   if(maxLots <= 0) maxLots = lots;

   lots = MathMax(0.0, MathMin(maxLots, lots));
   double normalizedLots = MathFloor((lots + 0.0000001) / stepLots) * stepLots;
   if(normalizedLots + 0.0000001 < minLots)
      return 0.0;

   return NormalizeDouble(normalizedLots, GetVolumeDigits(sym));
}

//+------------------------------------------------------------------+
int OnInit()
{
   Print("=== Gold Bolt Client v", EA_VERSION, " (Build ", EA_BUILD, ") ===");
   Print("服务器：", ServerURL);
   Print("账户 ID: ", AccountID);
   
   // 解析多品种
   ParseSymbols(Symbols);
   Print("交易品种(", g_symbolCount, "):");
   for(int s = 0; s < g_symbolCount; s++)
   {
      string brokerSym = GetBrokerSymbol(g_symbols[s]);
      bool avail = IsSymbolAvailable(brokerSym);
      Print("   ", s+1, ". ", g_symbols[s], " → ", brokerSym, " ", (avail ? "✅" : "❌"));
      if(!avail)
      {
         Print("❌ 品种不可用: ", brokerSym, " | 请检查是否已加入 Market Watch");
         return INIT_FAILED;
      }
   }
   Print("策略Magic: 趋势回调=", PullbackMagic, " 突破回踩=", BreakoutMagic,
         " RSI背离=", DivergenceMagic, " 突破加仓=", PyramidMagic,
         " 反向回调=", CounterMagic, " 震荡区间=", RangeMagic,
         " 动量剥头皮=", MomentumScalpMagic, " AI信号=", AISignalMagic);
   Print("风控：",
         (UseFixedLots ? ("固定手数=" + DoubleToString(FixedLots, 2)) : ("风险=" + DoubleToString(MaxRiskPercent, 1) + "%")),
         " | 持仓上限", MaxPositions,
         " | 日亏损", MaxDailyLoss, "% | 浮亏", MaxFloatLoss, "%");
   Print("动量剥头皮：",
         (EnableMomentumScalp ? "启用" : "禁用"),
         " | ",
         (MomentumScalpUseFixedLots ? ("固定手数=" + DoubleToString(MomentumScalpFixedLots, 2)) : ("风险=" + DoubleToString(MomentumScalpRiskPercent, 1) + "%")));

   // 图表品种检查：允许挂载任意已配置品种的图表
   string chartSym = Symbol();
   if(!FindSymbolInArray(chartSym))
   {
      Print("⚠️ 图表品种 ", chartSym, " 未在配置列表中 | 已配置: ", Symbols);
      Print("   EA 仍可运行，但建议挂载已配置品种的图表以获取最佳报价");
   }
   
   // 原油对冲套利配置
   if(EnableSpread)
   {
      Print("🛢️ 原油对冲套利：启用");
      Print("   Magic: ", SpreadMagicNumber);
      Print("   腿 1: ", SpreadSymbol1, " (BUY)");
      Print("   腿 2: ", SpreadSymbol2, " (SELL)");
      Print("   手数：", SpreadLots);
      
      // 检查品种是否可用
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
   
   // 扫描已有持仓（按策略分类）
   Print("📊 扫描已有持仓...");
   int pullbackCount = 0, breakoutCount = 0, divergenceCount = 0;
   int pyramidCount = 0, counterCount = 0, rangeCount = 0, momentumScalpCount = 0, aiSignalCount = 0, spreadCount = 0;
   
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
      {
         if(!IsAllowedSymbol(OrderSymbol()))
            continue;

         int magic = OrderMagicNumber();
         string type = (OrderType() == OP_BUY ? "BUY" : "SELL");
         string info = OrderSymbol() + " " + type + " " + DoubleToString(OrderLots(), 2) + " 手 | Ticket=" + IntegerToString(OrderTicket());
         
         if(magic == PullbackMagic){ pullbackCount++; Print("   📈 趋势回调: ", info); }
         else if(magic == BreakoutMagic){ breakoutCount++; Print("   🔥 突破回踩: ", info); }
         else if(magic == DivergenceMagic){ divergenceCount++; Print("   📊 RSI背离: ", info); }
         else if(magic == PyramidMagic){ pyramidCount++; Print("   🏗️ 突破加仓: ", info); }
         else if(magic == CounterMagic){ counterCount++; Print("   🔄 反向回调: ", info); }
         else if(magic == RangeMagic){ rangeCount++; Print("   📊 震荡区间: ", info); }
         else if(magic == MomentumScalpMagic){ momentumScalpCount++; Print("   ⚡ 动量剥头皮: ", info); }
         else if(magic == AISignalMagic){ aiSignalCount++; Print("   🤖 AI信号: ", info); }
         else if(magic == SpreadMagicNumber){ spreadCount++; Print("   🛢️ 原油对冲: ", info); }
      }
   }
   
   Print("   趋势回调: ", pullbackCount, " 单 | 突破回踩: ", breakoutCount, " 单 | RSI背离: ", divergenceCount, " 单");
   Print("   突破加仓: ", pyramidCount, " 单 | 反向回调: ", counterCount, " 单 | 震荡区间: ", rangeCount, " 单 | 动量剥头皮: ", momentumScalpCount, " 单 | AI信号: ", aiSignalCount, " 单");
   Print("   原油对冲: ", spreadCount, " 单");
   Print("=============================================");
   
   dailyStartEquity = AccountEquity();
   
   // 注册账户信息（含 broker 信息），失败时由 OnTick 每 5 秒重试
   if(!RegisterAccount())
   {
      gbRegistered = false;
      Print("⚠️ 注册失败，OnTick 将每 5 秒重试...");
   }
   else
   {
      // 注册成功后再发送初始数据
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
   
    // 首次 tick 提示
    static bool firstTick = false;
    if(!firstTick) { Print("📡 首次 Tick 收到"); firstTick = true; }
    
    // 每 tick 发送报价（包含多品种价格）
    SendTick();
    
    // ========== v2.8: 注册失败时每 5 秒重试 ==========
    if(!gbRegistered && now - lastRegisterTry >= 5)
    {
       lastRegisterTry = now;
       Print("🔄 尝试注册 GB Server...");
       if(RegisterAccount())
       {
          // 注册成功后发送初始数据
          Print("✅ 注册成功，发送初始数据...");
          SendHeartbeat();
          SendAllBars();
          SendPositions();
       }
    }

    // 定时：心跳 + 持仓 + 轮询指令（仅注册成功后执行）
    if(gbRegistered && now - lastPollTime >= PollInterval)
    {
       SendHeartbeat();
       SendPositions();
       PollAndExecute();
       CheckForUpdate();
       AutoSpreadTrade();
       lastPollTime = now;
    }
    
    // 定时发送 K 线（仅注册成功后执行）
    if(gbRegistered && now - lastBarTime >= BarInterval)
    {
       SendAllBars();
       lastBarTime = now;
    }
   
   // 日切重置
   static int lastDay = 0;
   int today = Day();
   if(today != lastDay)
   {
      dailyStartEquity = AccountEquity();
      lastDay = today;
      Print("📅 日切重置 | 起始权益：", dailyStartEquity);
   }
}

//+------------------------------------------------------------------+
//| 注册账户信息（含 broker 信息，服务端用于识别账户类型）               |
//+------------------------------------------------------------------+
bool RegisterAccount()
{
   string broker = AccountCompany();
   string server = AccountServer();
   string name = AccountName();
   string type = "standard";
   if(StringFind(broker, "ECN") >= 0 || StringFind(server, "ECN") >= 0)
      type = "ecn";
   else if(StringFind(broker, "Pro") >= 0 || StringFind(server, "Pro") >= 0)
      type = "pro";
   
   int leverage = AccountLeverage();
   string currency = AccountCurrency();
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
      "\"spread_enabled\":%s,"
      "\"strategy_mapping\":{"
      "\"pullback\":\"pullback\","
      "\"breakout_retest\":\"breakout_retest\","
      "\"divergence\":\"divergence\","
      "\"breakout_pyramid\":\"breakout_pyramid\","
      "\"counter_pullback\":\"counter_pullback\","
      "\"range\":\"range\","
      "\"momentum_scalp\":\"momentum_scalp\""
      "}"
      "}",
      AccountID, g_symbols[0], PullbackMagic, broker, server, name, type, currency, leverage,
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
   else
   {
      Print("❌ 账户注册失败");
      return false;
   }
}

//+------------------------------------------------------------------+
// 发送心跳（附带账户基础信息）
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   // ========== v2.8: MT4 服务器时间和交易状态 ==========
   string serverTime = TimeToStr(TimeCurrent(), TIME_DATE|TIME_MINUTES);
   bool isTradeAllowed = IsTradeAllowed();
   bool marketOpen = (MarketInfo(GetBrokerSymbol(g_symbols[0]), MODE_TRADEALLOWED) != 0);

   // 计算各策略的持仓数量
   int pullbackPos = 0, breakoutPos = 0, divergencePos = 0;
   int pyramidPos = 0, counterPos = 0, rangePos = 0, momentumScalpPos = 0;
   
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
      {
         if(!IsAllowedSymbol(OrderSymbol()))
            continue;

          int m = OrderMagicNumber();
          if(m == PullbackMagic) pullbackPos++;
          else if(m == BreakoutMagic) breakoutPos++;
         else if(m == DivergenceMagic) divergencePos++;
         else if(m == PyramidMagic) pyramidPos++;
         else if(m == CounterMagic) counterPos++;
         else if(m == RangeMagic) rangePos++;
         else if(m == MomentumScalpMagic) momentumScalpPos++;
      }
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
      "\"server_time\":\"%s\","
      "\"market_open\":%s,"
      "\"is_trade_allowed\":%s,"
      "\"strategies\":{"
      "\"pullback\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"breakout_retest\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"divergence\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"breakout_pyramid\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"counter_pullback\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"range\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d},"
      "\"momentum_scalp\":{\"enabled\":%s,\"magic\":%d,\"positions\":%d}"
      "}"
      "}",
      AccountID, g_symbols[0], PullbackMagic, AccountBalance(), AccountEquity(), 
      AccountMargin(), AccountFreeMargin(), AccountCurrency(), serverTime,
      (marketOpen ? "true" : "false"),
      (isTradeAllowed ? "true" : "false"),
      (EnablePullback ? "true" : "false"), PullbackMagic, pullbackPos,
      (EnableBreakout ? "true" : "false"), BreakoutMagic, breakoutPos,
      (EnableDivergence ? "true" : "false"), DivergenceMagic, divergencePos,
      (EnablePyramid ? "true" : "false"), PyramidMagic, pyramidPos,
      (EnableCounter ? "true" : "false"), CounterMagic, counterPos,
      (EnableRange ? "true" : "false"), RangeMagic, rangePos,
      (EnableMomentumScalp ? "true" : "false"), MomentumScalpMagic, momentumScalpPos
   );
   
   HttpPost("/heartbeat", json);
}

//+------------------------------------------------------------------+
// 发送实时报价（包含多品种价格）
//+------------------------------------------------------------------+
void SendTick()
{
   static datetime lastSend = 0;
   if(TimeCurrent() - lastSend < 1) return;
   lastSend = TimeCurrent();
   
   // 发送每个品种的报价
   for(int s = 0; s < g_symbolCount; s++)
   {
      string baseSymbol = g_symbols[s];
      string brokerSym = GetBrokerSymbol(baseSymbol);
      double bid = MarketInfo(brokerSym, MODE_BID);
      double ask = MarketInfo(brokerSym, MODE_ASK);
      double spread = GetCurrentSpreadPoints(brokerSym);
      if(spread < 0)
         spread = 0.0;
      
      string json = StringFormat(
         "{"
         "\"account_id\":\"%s\","
         "\"magic\":%d,"
         "\"symbol\":\"%s\","
         "\"bid\":%.5f,"
         "\"ask\":%.5f,"
         "\"spread\":%.3f,"
         "\"time\":\"%s\""
         "}",
         AccountID, PullbackMagic, baseSymbol, bid, ask, spread, TimeToStr(TimeCurrent(), TIME_SECONDS)
      );
      
      HttpPost("/tick", json);
   }
}

//+------------------------------------------------------------------+
// 发送所有 K 线数据（多品种）
//+------------------------------------------------------------------+
void SendAllBars()
{
   string tf_names[] = {"M1","M5","M15","M30","H1","H4","D1"};
   int    tf_periods[] = {PERIOD_M1,PERIOD_M5,PERIOD_M15,PERIOD_M30,PERIOD_H1,PERIOD_H4,PERIOD_D1};
   
   for(int s = 0; s < g_symbolCount; s++)
   {
      for(int t = 0; t < 7; t++)
      {
         SendBars(g_symbols[s], tf_names[t], tf_periods[t]);
      }
   }
}

//+------------------------------------------------------------------+
void SendBars(string baseSymbol, string tf_str, int tf_period)
{
   string brokerSym = GetBrokerSymbol(baseSymbol);
   string bars = "";
   for(int i = BarCount - 1; i >= 0; i--)
   {
      datetime t = iTime(brokerSym, tf_period, i);
      if(t == 0) continue;
      
      double o = iOpen(brokerSym, tf_period, i);
      double h = iHigh(brokerSym, tf_period, i);
      double l = iLow(brokerSym, tf_period, i);
      double c = iClose(brokerSym, tf_period, i);
      int    v = (int)iVolume(brokerSym, tf_period, i);
      
      if(bars != "") bars += ",";
      bars += StringFormat(
         "{\"time\":%d,\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%d}",
         t, o, h, l, c, v
      );
   }
   
   // 使用字符串拼接代替StringFormat，避免MQL4长度限制
   string json = "{\"account_id\":\"" + AccountID + 
                 "\",\"symbol\":\"" + baseSymbol + 
                 "\",\"magic\":" + IntegerToString(PullbackMagic) +
                 ",\"timeframe\":\"" + tf_str + 
                 "\",\"bars\":[" + bars + "]}";
   
   HttpPost("/bars", json);
}

//+------------------------------------------------------------------+
// 发送持仓信息（按品种分别发送）
//+------------------------------------------------------------------+
void SendPositions()
{
   // 动态初始化 MagicNumber 数组
   int magics[8];
   magics[0] = PullbackMagic;
   magics[1] = BreakoutMagic;
   magics[2] = DivergenceMagic;
   magics[3] = PyramidMagic;
   magics[4] = CounterMagic;
   magics[5] = RangeMagic;
   magics[6] = MomentumScalpMagic;
   magics[7] = SpreadMagicNumber;
   
   for(int s = 0; s < g_symbolCount; s++)
   {
      string positions = "";
      int count = 0;
      string baseSymbol = g_symbols[s];
      
      for(int i = 0; i < OrdersTotal(); i++)
      {
         if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         {
            // 品种匹配：仅当前品种的持仓
            string orderSym = OrderSymbol();
            if(orderSym != baseSymbol && orderSym != GetBrokerSymbol(baseSymbol))
               continue;
            
            // 检查是否属于任一策略
            bool isOurOrder = false;
            for(int j = 0; j < 8; j++)
            {
               if(OrderMagicNumber() == magics[j])
               {
                  isOurOrder = true;
                  break;
               }
            }
            if(!isOurOrder) continue;
            
            if(positions != "") positions += ",";
            positions += StringFormat(
               "{\"ticket\":%d,\"symbol\":\"%s\",\"type\":\"%s\",\"lots\":%.2f,\"open_price\":%.5f,"
               "\"sl\":%.5f,\"tp\":%.5f,\"profit\":%.2f,\"open_time\":%d,\"comment\":\"%s\",\"magic\":%d}",
               OrderTicket(), OrderSymbol(),
               (OrderType() == OP_BUY ? "BUY" : "SELL"),
               OrderLots(), OrderOpenPrice(),
               OrderStopLoss(), OrderTakeProfit(),
               OrderProfit(), OrderOpenTime(), OrderComment(),
               OrderMagicNumber()
            );
            count++;
         }
      }
      
      string json = StringFormat(
         "{\"account_id\":\"%s\",\"symbol\":\"%s\",\"magic\":%d,\"positions\":[%s]}",
         AccountID, baseSymbol, PullbackMagic, positions
      );
      
      HttpPost("/positions", json);
   }
}

// ============================================================
// 轮询并执行服务端指令（按品种分别轮询）
// EA 只是执行器，不做任何策略判断
// ============================================================
void PollAndExecute()
{
   for(int s = 0; s < g_symbolCount; s++)
   {
      string baseSymbol = g_symbols[s];
      string json = StringFormat("{\"account_id\":\"%s\",\"symbol\":\"%s\",\"magic\":%d}", AccountID, baseSymbol, PullbackMagic);
      string response = HttpPost("/poll", json);
      
      if(StringLen(response) == 0) continue;
      
      int count = GetJsonInt(response, "count");
      if(count == 0) continue;
      
      Print("📨 [", baseSymbol, "] 收到 ", count, " 条指令");
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
         else if(action == "PENDING")
            ExecutePending(cmd, cmd_id);
         else if(action == "CANCEL_PENDING")
            ExecuteCancelPending(cmd, cmd_id);
         else
            Print("未知指令类型：", action);
      }
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
    
   // 检查品种是否可用
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
   
   int op_type = OP_BUY;
   double price = 0.0;
   if(side == "BUY")
   {
      op_type = OP_BUY;
      price = MarketInfo(symbol, MODE_ASK);
   }
   else if(side == "SELL")
   {
      op_type = OP_SELL;
      price = MarketInfo(symbol, MODE_BID);
   }
   
   lots = NormalizeVolume(symbol, lots);
   string comment = "GB_SPREAD_" + reason;
    
   int ticket = OrderSend(symbol, op_type, lots, price, Slippage, 0, 0, comment, SpreadMagicNumber, 0,
                          (side == "BUY") ? clrGreen : clrRed);
   
   if(ticket > 0)
   {
      Print("✅ 价差开仓成功：#", ticket, " ", symbol, " ", side, " ", lots, "手 @ ", price);
      ReportResult(cmd_id, "OK", ticket, "");
   }
   else
   {
      int err = GetLastError();
      Print("❌ 价差开仓失败：Error#", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 执行加仓指令 (用于价差交易)
// ============================================================
void ExecuteAdd(string cmd, string cmd_id)
{
   ExecuteOpen(cmd, cmd_id);  // 加仓本质也是开仓
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
   int lastTicket = 0;
   int failedTicket = 0;

   for(int i = OrdersTotal() - 1; i >= 0 && remainingLots > 0.0000001; i--)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
      {
          if(OrderSymbol() != symbol) continue;

          if(OrderMagicNumber() != SpreadMagicNumber) continue;

          matchedPosition = true;

          double closeLots = MathMin(remainingLots, OrderLots());
          closeLots = NormalizeCloseVolume(symbol, closeLots);
          if(closeLots <= 0)
             continue;

         int ticket = OrderTicket();
         bool result = OrderClose(ticket, closeLots,
                                  (OrderType() == OP_BUY) ? MarketInfo(symbol, MODE_BID) : MarketInfo(symbol, MODE_ASK),
                                  Slippage,
                                  (OrderType() == OP_BUY) ? clrRed : clrGreen);
          if(result)
          {
             remainingLots -= closeLots;
             closedAny = true;
             lastTicket = ticket;
             Print("✅ 部分平仓成功：#", ticket, " ", symbol, " ", closeLots, "手 | 剩余=", DoubleToString(MathMax(0.0, remainingLots), 2));
          }
          else
          {
             int err = GetLastError();
             closeFailed = true;
             failedTicket = ticket;
             Print("❌ 部分平仓失败：#", ticket, " ", symbol, " ", closeLots, "手 | Error#", err);
             break;
          }
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
      ReportResult(cmd_id, "ERROR", failedTicket, "close_failed");
      return;
   }

   if(remainingLots <= 0.0000001)
   {
      ReportResult(cmd_id, "OK", lastTicket, "");
      return;
   }

   if(closedAny)
   {
      Print("⚠️ 部分平仓未完成：剩余 ", DoubleToString(MathMax(0.0, remainingLots), 2), " 手未成交");
      ReportResult(cmd_id, "ERROR", lastTicket, "partial_close_incomplete");
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
   int failedTicket = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
      {
          if(OrderSymbol() != symbol) continue;

          if(OrderMagicNumber() != SpreadMagicNumber) continue;

          matchedPosition = true;
           
          int ticket = OrderTicket();
          bool result = OrderClose(ticket, OrderLots(),
                                   (OrderType() == OP_BUY) ? MarketInfo(symbol, MODE_BID) : MarketInfo(symbol, MODE_ASK),
                                   Slippage,
                                   (OrderType() == OP_BUY) ? clrRed : clrGreen);
          if(result)
          {
             Print("✅ 平仓成功：#", ticket, " ", symbol);
             closedCount++;
          }
          else
          {
             int err = GetLastError();
             closeFailed = true;
             failedTicket = ticket;
             Print("❌ 全部平仓失败：#", ticket, " ", symbol, " | Error#", err);
          }
       }
   }

   if(!matchedPosition)
   {
      ReportResult(cmd_id, "ERROR", 0, "no_position_found");
      return;
   }

   if(closeFailed)
   {
      ReportResult(cmd_id, "ERROR", failedTicket, "close_failed");
      return;
   }

   if(closedCount > 0)
   {
      ReportResult(cmd_id, "OK", closedCount, "");
   }
}

// ============================================================
// 执行开仓信号（风控在本地，策略在服务端）
// ============================================================
void ExecuteSignal(string cmd, string cmd_id)
{
   string orderType = GetJsonString(cmd, "order_type");
   if(orderType == "BUY_LIMIT" || orderType == "BUY_STOP" || 
      orderType == "SELL_LIMIT" || orderType == "SELL_STOP")
   {
      ExecutePending(cmd, cmd_id);
      return;
   }
   
   string signalSymbol = GetJsonString(cmd, "symbol");
   string type_str = GetJsonString(cmd, "type");
   double sl       = GetJsonDouble(cmd, "sl");
   double tp1      = GetJsonDouble(cmd, "tp1");
   // 兼容 AI 信号的 tp 字段名
   if(tp1 == 0.0) tp1 = GetJsonDouble(cmd, "tp");
   int    score    = GetJsonInt(cmd, "score");
   string strategy = GetJsonString(cmd, "strategy");
   
   // 确定品种：使用信号自带的品种，否则用第一个配置品种
   string baseSymbol = signalSymbol;
   if(StringLen(baseSymbol) == 0)
      baseSymbol = g_symbols[0];
   
   // 获取经纪商品种名称（用于 MT4 API 调用）
   string brokerSymbol = GetBrokerSymbol(baseSymbol);
   
   Print("📡 信号：", type_str, " | 品种=", baseSymbol, " → ", brokerSymbol,
         " | SL=", sl, " TP=", tp1, " | ", strategy, " 评分:", score);

   if(StringLen(signalSymbol) > 0 && !IsPrimarySymbol(signalSymbol))
   {
      Print("❌ 信号品种不在配置列表：", signalSymbol, " | 已配置: ", Symbols);
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
   
   // 本地风控
   if(!CheckRisk(type_str))
   {
      ReportResult(cmd_id, "REJECTED", 0, "risk_check_failed");
      return;
   }
   
   // 计算手数
   double price = 0.0;
   int op_type = OP_BUY;
   if(type_str == "BUY")
   {
      op_type = OP_BUY;
      price = MarketInfo(brokerSymbol, MODE_ASK);
   }
   else if(type_str == "SELL")
   {
      op_type = OP_SELL;
      price = MarketInfo(brokerSymbol, MODE_BID);
   }
    
   double sl_distance = MathAbs(price - sl);
   double lots = CalcLotsForStrategy(strategy, sl_distance);
   // AI 信号使用服务端计算的手数（含减半逻辑）
   if(strategy == "ai_signal")
   {
      double cmdLots = GetJsonDouble(cmd, "lots");
      if(cmdLots > 0) lots = cmdLots;
   }
   lots = NormalizeVolume(brokerSymbol, lots);
    
   string comment = "GB_" + strategy + "_S" + IntegerToString(score);
   
   int ticket = OrderSend(brokerSymbol, op_type, lots, price, Slippage, 
                           0, 0, comment, magicForOrder, 0,
                           type_str == "BUY" ? clrGreen : clrRed);
   
   if(ticket > 0)
   {
      Print("✅ 开仓：#", ticket, " ", type_str, " ", lots, "手 @ ", price, 
            " | Magic=", magicForOrder, " (", strategy, ")");

      if(!OrderSelect(ticket, SELECT_BY_TICKET))
      {
         Print("⚠️ 开仓成交但未能选中订单 #", ticket, "，无法验证保护止损");
         ReportResult(cmd_id, "ERROR", ticket, "position_resolve_incomplete");
         return;
      }
      
      // 检查并设置 TP/SL（兼容 ECN/STP broker）
      double current_sl = OrderStopLoss();
      double current_tp = OrderTakeProfit();
      double open_price = OrderOpenPrice();

      // 如果 TP/SL 未设置，尝试单独设置
      if(current_sl == 0 || current_tp == 0)
      {
         double min_stop = MarketInfo(brokerSymbol, MODE_STOPLEVEL) * GetSymbolPoint(brokerSymbol);
         double final_sl = sl;
         double final_tp = tp1;
         
         // 确保 SL 距离符合要求
         if(min_stop > 0 && MathAbs(open_price - sl) < min_stop)
         {
            if(type_str == "BUY") final_sl = open_price - min_stop;
            else final_sl = open_price + min_stop;
         }
         
         // 确保 TP 距离符合要求
         if(min_stop > 0 && MathAbs(tp1 - open_price) < min_stop)
         {
            if(type_str == "BUY") final_tp = open_price + min_stop;
            else final_tp = open_price - min_stop;
         }
         
         if(final_sl != current_sl || final_tp != current_tp)
         {
            if(OrderModify(ticket, OrderOpenPrice(), final_sl, final_tp, 0, clrYellow))
            {
               Print("📝 开仓后设置 TP/SL: SL=", final_sl, " TP=", final_tp);
            }
            else
            {
               int mod_err = GetLastError();
               Print("⚠️ 开仓成功但保护止损附加失败: #", ticket, " Error#", mod_err);
               ReportResult(cmd_id, "ERROR", ticket, "protection_attach_failed");
               return;
            }
         }

         if(!OrderSelect(ticket, SELECT_BY_TICKET))
         {
            Print("⚠️ 开仓后无法重新选中订单 #", ticket, "，保护状态未确认");
            ReportResult(cmd_id, "ERROR", ticket, "position_resolve_incomplete");
            return;
         }
      }

      if(OrderStopLoss() == 0 || OrderTakeProfit() == 0)
      {
         Print("⚠️ 开仓后保护止损未完整附加: #", ticket);
         ReportResult(cmd_id, "ERROR", ticket, "protection_attach_incomplete");
         return;
      }
       
      ReportResult(cmd_id, "OK", ticket, "");

      // === 加仓后统一修改已有同方向仓位的 SL/TP ===
      double unifiedSL = GetJsonDouble(cmd, "unified_sl");
      if(unifiedSL > 0)
      {
         Print("📐 加仓统一SL: ", unifiedSL, " → 修改已有 ", type_str, " 仓位");
         int synced = 0;
         for(int j = OrdersTotal() - 1; j >= 0; j--)
         {
            if(!OrderSelect(j, SELECT_BY_POS, MODE_TRADES)) continue;
            if(OrderSymbol() != brokerSymbol) continue;
            if(OrderMagicNumber() != magicForOrder) continue;
            if(OrderTicket() == ticket) continue; // 跳过刚开的新仓

            int existingType = OrderType();
            if((type_str == "BUY" && existingType != OP_BUY) ||
               (type_str == "SELL" && existingType != OP_SELL))
               continue;

            double existSL = OrderStopLoss();
            double existTP = OrderTakeProfit();
            double newSL = unifiedSL;
            double newTP = tp1; // 统一 TP1

            // 确保 SL 距离符合 broker 最小要求
            double minDist = MarketInfo(brokerSymbol, MODE_STOPLEVEL) * GetSymbolPoint(brokerSymbol);
            if(minDist > 0)
            {
               if(type_str == "BUY" && MathAbs(OrderOpenPrice() - newSL) < minDist)
                  newSL = OrderOpenPrice() - minDist;
               if(type_str == "SELL" && MathAbs(newSL - OrderOpenPrice()) < minDist)
                  newSL = OrderOpenPrice() + minDist;
            }

            // SL 只能向盈利方向移动（BUY: new >= old, SELL: new <= old）
            bool slOK = false;
            if(type_str == "BUY" && newSL >= existSL)  slOK = true;
            if(type_str == "SELL" && newSL <= existSL)  slOK = true;

            if(slOK && (newSL != existSL || newTP != existTP))
            {
               if(OrderModify(OrderTicket(), OrderOpenPrice(), newSL, newTP, 0, clrYellow))
               {
                  synced++;
                  Print("  ✅ #", OrderTicket(), " SL: ", existSL, "→", newSL, " TP: ", existTP, "→", newTP);
               }
               else
               {
                  Print("  ⚠️ #", OrderTicket(), " 改单失败: ", GetLastError());
               }
            }
         }
         if(synced > 0)
            Print("📐 加仓统一SL完成: 同步 ", synced, " 个仓位");
      }
   }
   else
   {
      int err = GetLastError();
      Print("❌ 开仓失败：Error#", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 执行挂单指令（限价/止损单）
// ============================================================
void ExecutePending(string cmd, string cmd_id)
{
   string signalSymbol = GetJsonString(cmd, "symbol");
   string type_str     = GetJsonString(cmd, "type");
   string orderType    = GetJsonString(cmd, "order_type");
   double entry        = GetJsonDouble(cmd, "entry");
   double sl           = GetJsonDouble(cmd, "sl");
   double tp1          = GetJsonDouble(cmd, "tp1");
   int    score        = GetJsonInt(cmd, "score");
   string strategy     = GetJsonString(cmd, "strategy");
   datetime expiration = (datetime)GetJsonInt(cmd, "expiration");

   // 确定品种
   string baseSymbol = signalSymbol;
   if(StringLen(baseSymbol) == 0)
      baseSymbol = g_symbols[0];

   string brokerSymbol = GetBrokerSymbol(baseSymbol);

   Print("📡 挂单信号：", type_str, " | 品种=", baseSymbol, " → ", brokerSymbol,
         " | 入场=", entry, " SL=", sl, " TP=", tp1, " | ", strategy, " 评分:", score);

   // 验证品种
   if(StringLen(signalSymbol) > 0 && !IsPrimarySymbol(signalSymbol))
   {
      Print("❌ 挂单品种不在配置列表：", signalSymbol, " | 已配置: ", Symbols);
      ReportResult(cmd_id, "ERROR", 0, "symbol_mismatch");
      return;
   }

   // 验证方向
   if(type_str != "BUY" && type_str != "SELL")
   {
      Print("❌ 非法挂单方向：", type_str);
      ReportResult(cmd_id, "ERROR", 0, "invalid_type");
      return;
   }

   // 验证策略及magic
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

   double point = GetSymbolPoint(brokerSymbol);
   if(point <= 0) point = Point;

   // 确定挂单类型
   int pendingType = -1;
   if(orderType == "BUY_LIMIT")
      pendingType = OP_BUYLIMIT;
   else if(orderType == "BUY_STOP")
      pendingType = OP_BUYSTOP;
   else if(orderType == "SELL_LIMIT")
      pendingType = OP_SELLLIMIT;
   else if(orderType == "SELL_STOP")
      pendingType = OP_SELLSTOP;
   else
   {
      // 自动检测：entry 与当前价格的相对位置
      if(type_str == "BUY")
      {
         double ask = MarketInfo(brokerSymbol, MODE_ASK);
         if(entry <= ask + 5 * point)
            pendingType = OP_BUYLIMIT; // 低于或接近市价 → 限价买入
         else
            pendingType = OP_BUYSTOP;   // 高于市价 → 止损买入
      }
      else // SELL
      {
         double bid = MarketInfo(brokerSymbol, MODE_BID);
         if(entry >= bid - 5 * point)
            pendingType = OP_SELLLIMIT; // 高于或接近市价 → 限价卖出
         else
            pendingType = OP_SELLSTOP;  // 低于市价 → 止损卖出
      }
   }

   // 检查重复挂单（同品种、同方向、同magic）
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != brokerSymbol) continue;
      if(OrderMagicNumber() != magicForOrder) continue;

      int ot = OrderType();
      bool isBuyPending = (ot == OP_BUYLIMIT || ot == OP_BUYSTOP);
      bool isSellPending = (ot == OP_SELLLIMIT || ot == OP_SELLSTOP);
      bool newIsBuy = (pendingType == OP_BUYLIMIT || pendingType == OP_BUYSTOP);

      if((newIsBuy && isBuyPending) || (!newIsBuy && isSellPending))
      {
         Print("❌ 已有相同方向挂单：", brokerSymbol);
         ReportResult(cmd_id, "ERROR", 0, "duplicate_pending");
         return;
      }
   }

   // 计算手数
   double currentPrice = (type_str == "BUY") ? MarketInfo(brokerSymbol, MODE_ASK) : MarketInfo(brokerSymbol, MODE_BID);
   double sl_distance = MathAbs(currentPrice - sl);
   double lots = CalcLotsForStrategy(strategy, sl_distance);
   lots = NormalizeVolume(brokerSymbol, lots);

   string comment = "GB_" + strategy + "_S" + IntegerToString(score);

   // 设置过期时间：默认24小时
   if(expiration <= 0)
      expiration = TimeCurrent() + 24 * 60 * 60;

   int ticket = OrderSend(brokerSymbol, pendingType, lots, entry, Slippage,
                          0, 0, comment, magicForOrder, expiration,
                          type_str == "BUY" ? clrGreen : clrRed);

   if(ticket > 0)
   {
      Print("✅ 挂单成功：#", ticket, " ", type_str, " ", lots, "手 @ ", entry,
            " | Magic=", magicForOrder, " (", strategy, ")");

      // 尝试设置 SL/TP（部分经纪商可能拒绝，不影响挂单成功）
      if(sl > 0 || tp1 > 0)
      {
         if(OrderSelect(ticket, SELECT_BY_TICKET))
         {
            double final_sl = (sl > 0) ? sl : OrderStopLoss();
            double final_tp = (tp1 > 0) ? tp1 : OrderTakeProfit();
            if(OrderModify(ticket, entry, final_sl, final_tp, expiration, clrYellow))
            {
               Print("📝 挂单设置SL/TP: SL=", final_sl, " TP=", final_tp);
            }
            else
            {
               int mod_err = GetLastError();
               Print("⚠️ 挂单SL/TP设置失败: #", ticket, " Error#", mod_err);
               // 不影响挂单结果
            }
         }
      }

      ReportResult(cmd_id, "OK", ticket, "");
   }
   else
   {
      int err = GetLastError();
      Print("❌ 挂单失败：Error#", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 取消挂单指令
// ============================================================
void ExecuteCancelPending(string cmd, string cmd_id)
{
   int ticket = (int)GetJsonDouble(cmd, "ticket");
   string reason = GetJsonString(cmd, "reason");

   if(ticket <= 0)
   {
      Print("❌ 取消挂单：无效ticket");
      ReportResult(cmd_id, "ERROR", 0, "invalid_ticket");
      return;
   }

   if(!OrderSelect(ticket, SELECT_BY_TICKET))
   {
      Print("❌ 取消挂单：找不到订单 #", ticket);
      ReportResult(cmd_id, "ERROR", 0, "order_not_found");
      return;
   }

   int ot = OrderType();
   if(ot != OP_BUYLIMIT && ot != OP_BUYSTOP && ot != OP_SELLLIMIT && ot != OP_SELLSTOP)
   {
      Print("❌ 取消挂单：#", ticket, " 不是挂单（", ot, "）");
      ReportResult(cmd_id, "ERROR", 0, "not_pending");
      return;
   }

   if(OrderDelete(ticket))
   {
      Print("🗑️ 取消挂单：#", ticket, " | ", reason);
      ReportResult(cmd_id, "OK", ticket, "");
   }
   else
   {
      int err = GetLastError();
      Print("❌ 取消挂单失败：#", ticket, " Error#", err);
      ReportResult(cmd_id, "ERROR", ticket, IntegerToString(err));
   }
}

// ============================================================
// 执行改单指令（服务端决定止损止盈值）
// ============================================================
void ExecuteModify(string cmd, string cmd_id)
{
   int    ticket = (int)GetJsonDouble(cmd, "ticket");
   
   // 兼容两种字段名：new_sl（AI 止损）或 sl（传统）
   double sl = GetJsonDouble(cmd, "new_sl");
   if(sl == 0.0) sl = GetJsonDouble(cmd, "sl");
   
   // TP 保持原值，服务端不修改 TP
   double tp = GetJsonDouble(cmd, "tp");
   
   Print("📝 改单：#", ticket, " SL=", sl, " TP=", tp);
   
   if(!OrderSelect(ticket, SELECT_BY_TICKET))
   {
      Print("❌ 未找到订单 #", ticket);
      ReportResult(cmd_id, "ERROR", 0, "order_not_found");
      return;
   }

     if(!IsAllowedSymbol(OrderSymbol()))
     {
        Print("❌ 订单品种不属于本实例：", OrderSymbol());
        ReportResult(cmd_id, "ERROR", 0, "symbol_not_allowed");
        return;
     }

    if(!IsOurMagic(OrderMagicNumber()))
    {
       Print("❌ 订单不属于本 EA：Magic=", OrderMagicNumber());
       ReportResult(cmd_id, "ERROR", 0, "order_not_owned");
       return;
    }
     
   bool result = OrderModify(ticket, OrderOpenPrice(), sl, tp, 0, clrYellow);
   if(result)
   {
      Print("✅ 改单成功");
      ReportResult(cmd_id, "OK", ticket, "");
   }
   else
   {
      int err = GetLastError();
      Print("❌ 改单失败：", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 执行平仓指令
// ============================================================
void ExecuteClose(string cmd, string cmd_id)
{
   int ticket = (int)GetJsonDouble(cmd, "ticket");
   string reason = GetJsonString(cmd, "reason");
   
   Print("📤 平仓：#", ticket, " | ", reason);
   
   if(!OrderSelect(ticket, SELECT_BY_TICKET))
   {
      Print("❌ 未找到订单 #", ticket);
      ReportResult(cmd_id, "ERROR", 0, "order_not_found");
      return;
   }
    
   string sym = OrderSymbol();
   if(!IsAllowedSymbol(sym))
   {
      Print("❌ 订单品种不属于本实例：", sym);
      ReportResult(cmd_id, "ERROR", 0, "symbol_not_allowed");
      return;
   }

   if(!IsOurMagic(OrderMagicNumber()))
   {
      Print("❌ 订单不属于本 EA：Magic=", OrderMagicNumber());
      ReportResult(cmd_id, "ERROR", 0, "order_not_owned");
      return;
   }

   double closePrice = (OrderType() == OP_BUY) ? MarketInfo(sym, MODE_BID) : MarketInfo(sym, MODE_ASK);
   
   bool result = OrderClose(ticket, OrderLots(), closePrice, Slippage,
                            (OrderType() == OP_BUY) ? clrRed : clrGreen);
   if(result)
   {
      Print("✅ 平仓成功");
      ReportResult(cmd_id, "OK", ticket, "");
   }
   else
   {
      int err = GetLastError();
      Print("❌ 平仓失败：", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 检查本地风控
// ============================================================
bool CheckRisk(string type_str)
{
   double currentSpread = GetCurrentSpreadPoints(Symbol());
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

   // 检查同方向持仓数
   int sameDir = 0;
    
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
      {
         if(!IsPrimarySymbol(OrderSymbol())) continue;
         if(!IsOurMagic(OrderMagicNumber())) continue;
          
         if((type_str == "BUY" && OrderType() == OP_BUY) ||
            (type_str == "SELL" && OrderType() == OP_SELL))
            sameDir++;
      }
   }
   if(sameDir >= MaxSameDir)
   {
      Print("⚠️ 风控：同方向持仓达到上限 ", MaxSameDir);
      return false;
   }
   
   // 检查日亏损
   double dailyPnL = AccountEquity() - dailyStartEquity;
   double dailyPnL_pct = (dailyPnL / dailyStartEquity) * 100;
   if(dailyPnL_pct < -MaxDailyLoss)
   {
      Print("⚠️ 风控：日亏损达到 ", DoubleToString(-dailyPnL_pct, 2), "% > ", MaxDailyLoss, "%");
      return false;
   }
   
   // 检查浮亏
   double totalProfit = 0;
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
      {
         if(!IsAllowedSymbol(OrderSymbol()))
            continue;

         if(!IsOurMagic(OrderMagicNumber()))
            continue;

         totalProfit += OrderProfit();
      }
   }
   double floatLoss_pct = (totalProfit / AccountEquity()) * 100;
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
double CalcLotsWithConfig(bool useFixedLots, double fixedLots, double riskPercent, double sl_distance)
{
   if(useFixedLots)
      return NormalizeVolume(Symbol(), fixedLots);

   double riskAmount = AccountEquity() * (riskPercent / 100.0);
   double tickValue = MarketInfo(Symbol(), MODE_TICKVALUE);
   double tickSize = MarketInfo(Symbol(), MODE_TICKSIZE);

   if(tickValue <= 0 || tickSize <= 0 || sl_distance <= 0)
      return NormalizeVolume(Symbol(), 0.01);

   double lots = riskAmount / (sl_distance / tickSize * tickValue);
   lots = NormalizeDouble(lots, 2);

   return NormalizeVolume(Symbol(), MathMax(0.01, lots));
}

double CalcLots(double sl_distance)
{
   return CalcLotsWithConfig(UseFixedLots, FixedLots, MaxRiskPercent, sl_distance);
}

double CalcLotsForStrategy(string strategy, double sl_distance)
{
   if(strategy == "momentum_scalp")
      return CalcLotsWithConfig(MomentumScalpUseFixedLots, MomentumScalpFixedLots, MomentumScalpRiskPercent, sl_distance);

   return CalcLots(sl_distance);
}

// ============================================================
// 检查品种是否可用
// ============================================================
bool IsSymbolAvailable(string sym)
{
   return (MarketInfo(sym, MODE_BID) > 0);
}

// ============================================================
// 报告指令执行结果给服务端
// ============================================================
void ReportResult(string cmd_id, string result, int ticket, string error)
{
   string json = StringFormat(
      "{\"account_id\":\"%s\",\"command_id\":\"%s\",\"result\":\"%s\",\"ticket\":%d,\"error\":\"%s\"}",
      AccountID, cmd_id, result, ticket, error
   );
   
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
   string request_headers = "Content-Type: application/json\r\n";
   if(ApiToken != "")
      request_headers += "X-API-Token: " + ApiToken + "\r\n";

   string response_headers = "";
    
   int timeout = httpTimeout;
    
   // 重试一次
   int code = WebRequest("POST", url, request_headers, timeout, post_data, result_data, response_headers);
   
   if(code >= 200 && code < 300)
   {
      // 成功
      gbConnected = true;
      lastSuccessTime = TimeCurrent();
      failCount = 0;
      return CharArrayToString(result_data);
   }
   
   // 第一次失败，等待后重试
   Sleep(500);
   response_headers = "";
   code = WebRequest("POST", url, request_headers, timeout, post_data, result_data, response_headers);
   
   if(code >= 200 && code < 300)
   {
      gbConnected = true;
      lastSuccessTime = TimeCurrent();
      failCount = 0;
      return CharArrayToString(result_data);
   }
   
   // 两次都失败
   failCount++;
   if(failCount >= 3 && gbConnected)
   {
      gbConnected = false;
      Print("⚠️ GB Server 断连 | 失败次数：", failCount, " | 路径：", path);
   }
   return "";
   
   string result = CharArrayToString(result_data);
   return result;
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
   
   // 手动解析数字 (替代 sscanf)
   string num_str = "";
   for(int i = 0; i < StringLen(rest); i++)
   {
      ushort c = StringGetChar(rest, i);
      // 数字、小数点、负号、科学计数法
      if((c >= 48 && c <= 57) || c == 46 || c == 45 || c == 101 || c == 69 || c == 43)
         num_str += ShortToString(c);
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
      if(StringGetChar(json, i) == '[') bracket_count++;
      else if(StringGetChar(json, i) == ']')
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
      ushort c = StringGetChar(array_str, i);
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
//| 计算波动率加权手数（使用 H1 ATR）                                 |
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

//+------------------------------------------------------------------+
//| 自动价差交易（Brent-WTI spread）                                  |
//+------------------------------------------------------------------+
void AutoSpreadTrade()
{
   if(!EnableAutoSpreadTrade) return;
   if(!EnableSpread) return;
   if(!spreadSymbolsReady) return;

   static datetime lastCheck = 0;
   if(TimeCurrent() - lastCheck < SpreadTradeInterval) return;
   lastCheck = TimeCurrent();

   // 输出波动率信息便于监控
   double debugBrentATR = iATR(SpreadSymbol1, PERIOD_H1, 14, 0);
   double debugWtiATR = iATR(SpreadSymbol2, PERIOD_H1, 14, 0);
   if(debugBrentATR > 0 && debugWtiATR > 0)
      Print("🛢️ 波动率 Brent ATR=", debugBrentATR, " WTI ATR=", debugWtiATR, " 比例=", (debugBrentATR/debugWtiATR));

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
   double spread = brentMid - wtiMid;

   double wtiPoint = MarketInfo(SpreadSymbol2, MODE_POINT);
   if(wtiPoint <= 0)
   {
      Print("🛢️ 原油价差：WTI 点值不可用");
      return;
   }

   int spreadLongCount = 0;
   int spreadShortCount = 0;
   double ukLongLots = 0, usShortLots = 0;
   double ukShortLots = 0, usLongLots = 0;

   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderMagicNumber() != SpreadMagicNumber) continue;

      string sym = OrderSymbol();
      int type = OrderType();

      if(sym == SpreadSymbol1)
      {
         if(type == OP_BUY)  { spreadLongCount++;  ukLongLots  += OrderLots(); }
         if(type == OP_SELL) { spreadShortCount++; ukShortLots += OrderLots(); }
      }
      else if(sym == SpreadSymbol2)
      {
         if(type == OP_BUY)  { spreadShortCount++; usLongLots  += OrderLots(); }
         if(type == OP_SELL) { spreadLongCount++;  usShortLots += OrderLots(); }
      }
   }

   double spreadPoints = spread / wtiPoint;
   int spreadPointsInt = (int)MathRound(spreadPoints);

   if(spreadLongCount == 0 && spreadShortCount == 0)
   {
      if(spreadPointsInt > SpreadEntryPts)
      {
         Print("🛢️ 价差过大 ", spreadPointsInt, "点 > ", SpreadEntryPts, "点 → 做窄价差：SELL ", SpreadSymbol1, " + BUY ", SpreadSymbol2);

         double sellPrice = MarketInfo(SpreadSymbol1, MODE_BID);
         double buyPrice  = MarketInfo(SpreadSymbol2, MODE_ASK);

         double volBrentLots = SpreadLots;
         double volWtiLots = SpreadLots;
         CalculateVolWeightedLots(volBrentLots, volWtiLots);

         int ticket1 = OrderSend(SpreadSymbol1, OP_SELL, volBrentLots, sellPrice, Slippage, 0, 0,
                                 "GB_SPREAD_SELL", SpreadMagicNumber, 0, clrRed);
         if(ticket1 > 0)
            Print("✅ 价差开仓：#", ticket1, " ", SpreadSymbol1, " SELL ", volBrentLots, "手 @ ", sellPrice);
         else
            Print("❌ 价差开仓失败 SELL ", SpreadSymbol1, " Error#", GetLastError());

         int ticket2 = OrderSend(SpreadSymbol2, OP_BUY, volWtiLots, buyPrice, Slippage, 0, 0,
                                 "GB_SPREAD_BUY", SpreadMagicNumber, 0, clrGreen);
         if(ticket2 > 0)
            Print("✅ 价差开仓：#", ticket2, " ", SpreadSymbol2, " BUY ", volWtiLots, "手 @ ", buyPrice);
         else
            Print("❌ 价差开仓失败 BUY ", SpreadSymbol2, " Error#", GetLastError());
      }
      else if(spreadPointsInt < -SpreadEntryPts)
      {
         Print("🛢️ 价差过小 ", spreadPointsInt, "点 < -", SpreadEntryPts, "点 → 做阔价差：BUY ", SpreadSymbol1, " + SELL ", SpreadSymbol2);

         double buyPrice  = MarketInfo(SpreadSymbol1, MODE_ASK);
         double sellPrice = MarketInfo(SpreadSymbol2, MODE_BID);

         double volBrentLots = SpreadLots;
         double volWtiLots = SpreadLots;
         CalculateVolWeightedLots(volBrentLots, volWtiLots);

         int ticket1 = OrderSend(SpreadSymbol1, OP_BUY, volBrentLots, buyPrice, Slippage, 0, 0,
                                 "GB_SPREAD_BUY", SpreadMagicNumber, 0, clrGreen);
         if(ticket1 > 0)
            Print("✅ 价差开仓：#", ticket1, " ", SpreadSymbol1, " BUY ", volBrentLots, "手 @ ", buyPrice);
         else
            Print("❌ 价差开仓失败 BUY ", SpreadSymbol1, " Error#", GetLastError());

         int ticket2 = OrderSend(SpreadSymbol2, OP_SELL, volWtiLots, sellPrice, Slippage, 0, 0,
                                 "GB_SPREAD_SELL", SpreadMagicNumber, 0, clrRed);
         if(ticket2 > 0)
            Print("✅ 价差开仓：#", ticket2, " ", SpreadSymbol2, " SELL ", volWtiLots, "手 @ ", sellPrice);
         else
            Print("❌ 价差开仓失败 SELL ", SpreadSymbol2, " Error#", GetLastError());
      }
   }

   if(spreadLongCount > 0 && spreadShortCount == 0)
   {
      if(MathAbs(spreadPointsInt) <= SpreadExitPts)
      {
         Print("🛢️ 价差回归 ", spreadPointsInt, "点 ≤ ", SpreadExitPts, "点 → 平仓价差持仓");
         CloseAllSpreadPositions();
      }
   }
   else if(spreadShortCount > 0 && spreadLongCount == 0)
   {
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

//+------------------------------------------------------------------+

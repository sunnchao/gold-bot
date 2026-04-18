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
#define EA_VERSION  "2.8.2"
#define EA_BUILD    8

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

//+------------------------------------------------------------------+
//| 原油对冲套利配置                                                   |
//+------------------------------------------------------------------+
input group "===== 原油对冲套利 ====="
extern bool     EnableSpread        = false;    // 🛢️ 启用原油对冲套利
extern int      SpreadMagicNumber   = 20250224; // 原油策略魔术号
extern string   SpreadSymbol1       = "UKOIL";  // 腿 1: Brent (布伦特)
extern string   SpreadSymbol2       = "USOIL";  // 腿 2: WTI (美国)
extern double   SpreadLots          = 0.05;     // 每腿交易手数

//+------------------------------------------------------------------+
//| 通信参数配置                                                       |
//+------------------------------------------------------------------+
extern int      PollInterval    = 5;        // 轮询间隔（秒）
extern int      BarInterval     = 60;       // K 线发送间隔（秒）
extern int      BarCount        = 50;  // K 线数量      // K 线数量
extern string   Symbol_         = "XAUUSD"; // 主交易品种
extern int      Slippage        = 3;        // 滑点（点数）

// ============ 全局变量 ============
datetime lastPollTime   = 0;
datetime lastBarTime    = 0;
double   dailyStartEquity = 0;
int      httpTimeout    = 5000;
bool     spreadSymbolsReady = false;  // 原油品种是否可用

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
   return false;
}

//+------------------------------------------------------------------+
bool IsPrimarySymbol(string sym)
{
   return (sym == Symbol_);
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
   if(magic == SpreadMagicNumber) return true;
   return false;
}

//+------------------------------------------------------------------+
double GetSymbolPoint(string sym)
{
   double point = MarketInfo(sym, MODE_POINT);
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
   Print("策略Magic: 趋势回调=", PullbackMagic, " 突破回踩=", BreakoutMagic,
         " RSI背离=", DivergenceMagic, " 突破加仓=", PyramidMagic,
         " 反向回调=", CounterMagic, " 震荡区间=", RangeMagic,
         " 动量剥头皮=", MomentumScalpMagic);
   Print("风控：",
         (UseFixedLots ? ("固定手数=" + DoubleToString(FixedLots, 2)) : ("风险=" + DoubleToString(MaxRiskPercent, 1) + "%")),
         " | 持仓上限", MaxPositions,
         " | 日亏损", MaxDailyLoss, "% | 浮亏", MaxFloatLoss, "%");
   Print("动量剥头皮：",
         (EnableMomentumScalp ? "启用" : "禁用"),
         " | ",
         (MomentumScalpUseFixedLots ? ("固定手数=" + DoubleToString(MomentumScalpFixedLots, 2)) : ("风险=" + DoubleToString(MomentumScalpRiskPercent, 1) + "%")));

   if(!IsSymbolAvailable(Symbol_))
   {
      Print("❌ 主交易品种不可用：", Symbol_);
      return INIT_FAILED;
   }

   string chartSymbol = Symbol();
   if(Symbol() != Symbol_)
   {
      Print("❌ 图表品种与 Symbol_ 不一致 | Chart=", chartSymbol, " | Symbol_=", Symbol_);
      return INIT_FAILED;
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
   int pyramidCount = 0, counterCount = 0, rangeCount = 0, momentumScalpCount = 0, spreadCount = 0;
   
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
         else if(magic == SpreadMagicNumber){ spreadCount++; Print("   🛢️ 原油对冲: ", info); }
      }
   }
   
   Print("   趋势回调: ", pullbackCount, " 单 | 突破回踩: ", breakoutCount, " 单 | RSI背离: ", divergenceCount, " 单");
   Print("   突破加仓: ", pyramidCount, " 单 | 反向回调: ", counterCount, " 单 | 震荡区间: ", rangeCount, " 单 | 动量剥头皮: ", momentumScalpCount, " 单");
   Print("   原油对冲: ", spreadCount, " 单");
   Print("=============================================");
   
   dailyStartEquity = AccountEquity();
   
   // 检查更新
   CheckForUpdate();
   
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
   bool marketOpen = (MarketInfo(Symbol_, MODE_TRADEALLOWED) != 0);

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
      AccountID, Symbol_, PullbackMagic, AccountBalance(), AccountEquity(), 
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
   
   double bid = MarketInfo(Symbol_, MODE_BID);
   double ask = MarketInfo(Symbol_, MODE_ASK);
   double spread = GetCurrentSpreadPoints(Symbol_);
   if(spread < 0)
      spread = 0.0;
   
   // 构建多品种价格数据
   string symbols_json = "";
   
   // 添加原油价格 (如果启用价差交易且品种可用)
   if(EnableSpread && spreadSymbolsReady)
   {
      double leg1_bid = MarketInfo(SpreadSymbol1, MODE_BID);
      double leg2_bid = MarketInfo(SpreadSymbol2, MODE_BID);
      double leg1_ask = MarketInfo(SpreadSymbol1, MODE_ASK);
      double leg2_ask = MarketInfo(SpreadSymbol2, MODE_ASK);
      double leg1_point = GetSymbolPoint(SpreadSymbol1);
      double leg2_point = GetSymbolPoint(SpreadSymbol2);

      if(leg1_ask <= 0)
         leg1_ask = leg1_bid + leg1_point * 10.0;
      if(leg2_ask <= 0)
         leg2_ask = leg2_bid + leg2_point * 10.0;
      
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
      AccountID, PullbackMagic, Symbol_, bid, ask, spread, TimeToStr(TimeCurrent(), TIME_SECONDS), symbols_json
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
void SendBars(string tf_str, int tf_period)
{
   string bars = "";
   for(int i = BarCount - 1; i >= 0; i--)
   {
      datetime t = iTime(Symbol_, tf_period, i);
      if(t == 0) continue;
      
      double o = iOpen(Symbol_, tf_period, i);
      double h = iHigh(Symbol_, tf_period, i);
      double l = iLow(Symbol_, tf_period, i);
      double c = iClose(Symbol_, tf_period, i);
      double v = iVolume(Symbol_, tf_period, i);
      
      if(bars != "") bars += ",";
      bars += StringFormat(
         "{\"time\":%d,\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%d}",
         t, o, h, l, c, v
      );
   }
   
   // 使用字符串拼接代替StringFormat，避免MQL4长度限制
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
   int count = 0;
   
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
   
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
      {
         if(!IsAllowedSymbol(OrderSymbol()))
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
   
   // 本地风控
   if(!CheckRisk(type_str))
   {
      ReportResult(cmd_id, "REJECTED", 0, "risk_check_failed");
      return;
   }
   
   // 计算手数
   double price;
   int op_type = OP_BUY;
   if(type_str == "BUY")
   {
      op_type = OP_BUY;
      price = MarketInfo(Symbol_, MODE_ASK);
   }
   else if(type_str == "SELL")
   {
      op_type = OP_SELL;
      price = MarketInfo(Symbol_, MODE_BID);
   }
    
   double sl_distance = MathAbs(price - sl);
   double lots = CalcLotsForStrategy(strategy, sl_distance);
   lots = NormalizeVolume(Symbol_, lots);
    
   string comment = "GB_" + strategy + "_S" + IntegerToString(score);
   
   int ticket = OrderSend(Symbol_, op_type, lots, price, Slippage, 
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
         double min_stop = MarketInfo(Symbol_, MODE_STOPLEVEL) * GetSymbolPoint(Symbol_);
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
   }
   else
   {
      int err = GetLastError();
      Print("❌ 开仓失败：Error#", err);
      ReportResult(cmd_id, "ERROR", 0, IntegerToString(err));
   }
}

// ============================================================
// 执行改单指令（服务端决定止损止盈值）
// ============================================================
void ExecuteModify(string cmd, string cmd_id)
{
   int    ticket = (int)GetJsonDouble(cmd, "ticket");
   double sl     = GetJsonDouble(cmd, "sl");
   double tp     = GetJsonDouble(cmd, "tp");
   
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
   for(int i = 0; i < OrdersTotal(); i++)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;

      if(!IsAllowedSymbol(OrderSymbol()))
         continue;

      if(!IsOurMagic(OrderMagicNumber()))
         continue;

      managedPositions++;
   }

   // 检查最大持仓数
   if(managedPositions >= MaxPositions)
   {
      Print("⚠️ 风控：达到最大持仓数 ", MaxPositions);
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
      return NormalizeVolume(Symbol_, fixedLots);

   double riskAmount = AccountEquity() * (riskPercent / 100.0);
   double tickValue = MarketInfo(Symbol_, MODE_TICKVALUE);
   double tickSize = MarketInfo(Symbol_, MODE_TICKSIZE);

   if(tickValue <= 0 || tickSize <= 0 || sl_distance <= 0)
      return NormalizeVolume(Symbol_, 0.01);

   double lots = riskAmount / (sl_distance / tickSize * tickValue);
   lots = NormalizeDouble(lots, 2);

   return NormalizeVolume(Symbol_, MathMax(0.01, lots));
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

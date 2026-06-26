//+------------------------------------------------------------------+
//| GoldBolt_Visual_Assistant.mq4                                    |
//| Display-only chart assistant for cached visual payloads          |
//+------------------------------------------------------------------+
#property copyright "Gold Bolt"
#property version   "1.0"
#property strict
#property indicator_chart_window

extern string AccountID = "account_A";
extern bool   UseCommonFiles = true;
extern bool   EnableServerVisuals = true;
extern bool   EnableLocalHarmonic = true;
extern string HarmonicIndicatorName = "Market\\Shepherd_Harmonic_Patterns";
extern int    HarmonicLookbackShift = 1;
extern int    PanelCorner = 1;
extern int    PanelX = 12;
extern int    PanelY = 24;
extern int    MaxObjects = 80;
extern int    RefreshSeconds = 2;

string g_panelName = "GBVA_Panel";
string g_panelPrefix = "GBVA_";
string g_serverPrefix = "GBVA_Server_";
string g_localPrefix = "GBVA_Local_";

int OnInit()
{
   IndicatorShortName("GoldBolt Visual Assistant");

   int seconds = RefreshSeconds;
   if(seconds < 1)
      seconds = 1;
   EventSetTimer(seconds);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   DeleteObjectsByPrefix(g_panelPrefix);
}

void OnTimer()
{
   string status = "waiting";
   string payload = "";
   string fileName = VisualCacheFileName(AccountID, CurrentBaseSymbol(), TimeframeToString(Period()));

   if(ReadVisualCache(fileName, payload))
      status = "ok";

   DrawVisualPanel(payload, status, fileName);

   if(EnableServerVisuals && StringLen(payload) > 0)
      DrawServerAlerts(payload);
   else
      DeleteObjectsByPrefix(g_serverPrefix);

   if(EnableLocalHarmonic)
      DrawLocalHarmonic();
   else
      DeleteObjectsByPrefix(g_localPrefix);
}

int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   return(rates_total);
}

string CurrentBaseSymbol()
{
   string sym = Symbol();
   string candidates[6];
   int count = 0;

   candidates[count++] = sym;

   int dotPos = StringFind(sym, ".");
   if(dotPos > 0)
      candidates[count++] = StringSubstr(sym, 0, dotPos);

   int underscorePos = StringFind(sym, "_");
   if(underscorePos > 0)
      candidates[count++] = StringSubstr(sym, 0, underscorePos);

   int hashPos = StringFind(sym, "#");
   if(hashPos > 0)
      candidates[count++] = StringSubstr(sym, 0, hashPos);

   for(int i = 0; i < count; i++)
   {
      string candidate = TrimTrailingLowerSuffix(candidates[i]);
      if(StringLen(candidate) >= 6)
         return candidate;
   }

   return sym;
}

string TrimTrailingLowerSuffix(string value)
{
   string result = value;
   while(StringLen(result) > 0)
   {
      ushort ch = StringGetChar(result, StringLen(result) - 1);
      bool isLower = (ch >= 'a' && ch <= 'z');
      bool isPunct = (ch == '.' || ch == '_' || ch == '#');
      if(!isLower && !isPunct)
         break;
      result = StringSubstr(result, 0, StringLen(result) - 1);
   }
   return result;
}

string TimeframeToString(int tf)
{
   if(tf == PERIOD_M1) return "M1";
   if(tf == PERIOD_M5) return "M5";
   if(tf == PERIOD_M15) return "M15";
   if(tf == PERIOD_M30) return "M30";
   if(tf == PERIOD_H1) return "H1";
   if(tf == PERIOD_H4) return "H4";
   if(tf == PERIOD_D1) return "D1";
   if(tf == PERIOD_W1) return "W1";
   if(tf == PERIOD_MN1) return "MN1";
   return IntegerToString(tf);
}

string SanitizeVisualFilePart(string value)
{
   string sanitized = StringTrimLeft(StringTrimRight(value));
   string disallowed = "\\/:*?\"<>| ,;";
   for(int i = 0; i < StringLen(disallowed); i++)
   {
      string ch = StringSubstr(disallowed, i, 1);
      StringReplace(sanitized, ch, "_");
   }

   if(StringLen(sanitized) == 0)
      sanitized = "na";

   return sanitized;
}

string VisualCacheFileName(string accountID, string symbol, string timeframe)
{
   return "GoldBoltVisual_" +
          SanitizeVisualFilePart(accountID) + "_" +
          SanitizeVisualFilePart(symbol) + "_" +
          SanitizeVisualFilePart(timeframe) + ".json";
}

bool ReadVisualCache(string fileName, string &payload)
{
   payload = "";
   int flags = FILE_READ | FILE_TXT | FILE_ANSI;
   if(UseCommonFiles)
      flags |= FILE_COMMON;

   int handle = FileOpen(fileName, flags);
   if(handle == INVALID_HANDLE)
      return false;

   int size = (int)FileSize(handle);
   if(size > 0)
      payload = FileReadString(handle, size);
   FileClose(handle);
   return (StringLen(payload) > 0);
}

void DrawVisualPanel(string payload, string cacheStatus, string fileName)
{
   string panelName = g_panelName;
   if(ObjectFind(0, panelName) < 0)
   {
      if(!ObjectCreate(0, panelName, OBJ_LABEL, 0, 0, 0))
         return;
      ObjectSetInteger(0, panelName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, panelName, OBJPROP_SELECTED, false);
      ObjectSetString(0, panelName, OBJPROP_FONT, "Tahoma");
   }

   string symbolText = SafeDisplay(GetJsonStringSafe(payload, "symbol"));
   string timeframeText = SafeDisplay(GetJsonStringSafe(payload, "timeframe"));
   string aiObject = GetJsonObjectSafe(payload, "ai");
   string tickObject = GetJsonObjectSafe(payload, "tick");
   int alertCount = GetJsonInt(payload, "count");
   bool hasAI = GetJsonBool(aiObject, "has_result");

   string text = "GoldBolt Visual\n";
   text += symbolText + " / " + timeframeText + "\n";
   text += "Bias: " + SafeDisplay(GetJsonStringSafe(aiObject, "bias")) + "\n";
   text += "Confidence: " + ValueOrNA(GetJsonDouble(aiObject, "confidence"), 0) + "\n";
   text += "Exit: " + SafeDisplay(GetJsonStringSafe(aiObject, "exit_suggestion")) + "\n";
   text += "Side: " + SafeDisplay(GetJsonStringSafe(aiObject, "side")) + "\n";
   text += "Entry: " + FormatRange(GetJsonDouble(aiObject, "entry_min"), GetJsonDouble(aiObject, "entry_max")) + "\n";
   text += "SL/TP: " + FormatPrice(GetJsonDouble(aiObject, "stop_loss")) + " / " + FormatPrice(GetJsonDouble(aiObject, "take_profit")) + "\n";
   text += "Alerts: " + IntegerToString(alertCount) + "\n";
   text += "Tick: " + SafeDisplay(GetJsonStringSafe(tickObject, "time")) + "\n";
   text += "Cache: " + (cacheStatus == "ok" ? "ready" : "waiting") + "\n";
   if(!hasAI)
      text += "AI: n/a\n";

   ObjectSetInteger(0, panelName, OBJPROP_CORNER, PanelCorner);
   ObjectSetInteger(0, panelName, OBJPROP_XDISTANCE, PanelX);
   ObjectSetInteger(0, panelName, OBJPROP_YDISTANCE, PanelY);
   ObjectSetInteger(0, panelName, OBJPROP_COLOR, cacheStatus == "ok" ? clrWhite : clrSilver);
   ObjectSetInteger(0, panelName, OBJPROP_FONTSIZE, 9);
   ObjectSetString(0, panelName, OBJPROP_TEXT, text);
}

void DrawServerAlerts(string payload)
{
   DeleteObjectsByPrefix(g_serverPrefix);

   string alerts = GetJsonArraySafe(payload, "alerts");
   int count = GetJsonInt(payload, "count");
   if(count <= 0 || StringLen(alerts) == 0)
      return;

   for(int i = 0; i < count && i < MaxObjects; i++)
   {
      string alert = GetArrayElement(alerts, i);
      if(StringLen(alert) == 0)
         continue;

      string direction = GetJsonStringSafe(alert, "direction");
      if(direction != "bullish" && direction != "bearish")
         continue;

      string alertID = GetJsonStringSafe(alert, "id");
      if(StringLen(alertID) == 0)
         alertID = "idx_" + IntegerToString(i);

      string objName = g_serverPrefix + SanitizeObjectName(alertID);
      double price = GetJsonDouble(alert, "price");
      if(price <= 0)
         price = Close[0];

      datetime alertTime = ParseAlertTime(GetJsonStringSafe(alert, "time"));
      if(alertTime == 0)
         alertTime = TimeCurrent();

      DrawArrowObject(objName, alertTime, price, direction, clrGold, 2);
   }
}

void DrawLocalHarmonic()
{
   DeleteObjectsByPrefix(g_localPrefix);

   int shift = HarmonicLookbackShift;
   if(shift < 0)
      shift = 0;

   ResetLastError();
   double buySignal  = iCustom(NULL, 0, HarmonicIndicatorName, 0, shift);
   double sellSignal = iCustom(NULL, 0, HarmonicIndicatorName, 1, shift);
   double bullDiv    = iCustom(NULL, 0, HarmonicIndicatorName, 2, shift);
   double bearDiv    = iCustom(NULL, 0, HarmonicIndicatorName, 3, shift);
   double stopLoss   = iCustom(NULL, 0, HarmonicIndicatorName, 4, shift);
   double tp1        = iCustom(NULL, 0, HarmonicIndicatorName, 5, shift);
   double tp2        = iCustom(NULL, 0, HarmonicIndicatorName, 6, shift);
   double tp3        = iCustom(NULL, 0, HarmonicIndicatorName, 7, shift);
   double priceAction = iCustom(NULL, 0, HarmonicIndicatorName, 8, shift);

   datetime signalTime = iTime(Symbol(), Period(), shift);
   if(signalTime == 0)
      signalTime = TimeCurrent();

   if(HasIndicatorValue(buySignal))
      DrawArrowObject(g_localPrefix + "Buy", signalTime, buySignal, "bullish", clrDeepSkyBlue, 2);
   if(HasIndicatorValue(sellSignal))
      DrawArrowObject(g_localPrefix + "Sell", signalTime, sellSignal, "bearish", clrTomato, 2);
   if(HasIndicatorValue(bullDiv))
      DrawArrowObject(g_localPrefix + "BullDiv", signalTime, bullDiv, "bullish", clrAqua, 1);
   if(HasIndicatorValue(bearDiv))
      DrawArrowObject(g_localPrefix + "BearDiv", signalTime, bearDiv, "bearish", clrOrange, 1);

   DrawLevelObject(g_localPrefix + "SL", stopLoss, clrOrangeRed);
   DrawLevelObject(g_localPrefix + "TP1", tp1, clrLimeGreen);
   DrawLevelObject(g_localPrefix + "TP2", tp2, clrDeepSkyBlue);
   DrawLevelObject(g_localPrefix + "TP3", tp3, clrDodgerBlue);

   if(HasIndicatorValue(priceAction))
      DrawLevelObject(g_localPrefix + "PA", priceAction, clrKhaki);
}

bool HasIndicatorValue(double value)
{
   return (value != EMPTY_VALUE && value != 0.0);
}

void DrawArrowObject(string name, datetime when, double price, string direction, color tone, int width)
{
   if(price <= 0)
      return;

   if(ObjectFind(0, name) < 0)
   {
      if(!ObjectCreate(0, name, OBJ_ARROW, 0, when, price))
         return;
   }

   int arrowCode = (direction == "bullish") ? 233 : 234;
   int anchor = (direction == "bullish") ? ANCHOR_BOTTOM : ANCHOR_TOP;

   ObjectMove(0, name, 0, when, price);
   ObjectSetInteger(0, name, OBJPROP_ARROWCODE, arrowCode);
   ObjectSetInteger(0, name, OBJPROP_COLOR, tone);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, width);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchor);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTED, false);
}

void DrawLevelObject(string name, double price, color tone)
{
   if(price == EMPTY_VALUE || price <= 0)
   {
      if(ObjectFind(0, name) >= 0)
         ObjectDelete(0, name);
      return;
   }

   if(ObjectFind(0, name) < 0)
   {
      if(!ObjectCreate(0, name, OBJ_HLINE, 0, 0, price))
         return;
   }

   ObjectSetDouble(0, name, OBJPROP_PRICE, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, tone);
   ObjectSetInteger(0, name, OBJPROP_STYLE, STYLE_DASH);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTED, false);
}

void DeleteObjectsByPrefix(string prefix)
{
   int total = ObjectsTotal(0, -1, -1);
   for(int i = total - 1; i >= 0; i--)
   {
      string name = ObjectName(0, i);
      if(StringFind(name, prefix) == 0)
         ObjectDelete(0, name);
   }
}

string SafeDisplay(string value)
{
   string text = StringTrimLeft(StringTrimRight(value));
   if(StringLen(text) == 0)
      return "n/a";
   return text;
}

string FormatPrice(double value)
{
   if(value <= 0)
      return "n/a";
   return DoubleToString(value, Digits);
}

string FormatRange(double lowValue, double highValue)
{
   if(lowValue <= 0 || highValue <= 0)
      return "n/a";
   return DoubleToString(lowValue, Digits) + " - " + DoubleToString(highValue, Digits);
}

string ValueOrNA(double value, int digitsCount)
{
   if(value <= 0)
      return "n/a";
   return DoubleToString(value, digitsCount);
}

string SanitizeObjectName(string value)
{
   string name = SanitizeVisualFilePart(value);
   if(StringLen(name) > 40)
      name = StringSubstr(name, 0, 40);
   return name;
}

datetime ParseAlertTime(string timeStr)
{
   string raw = StringTrimLeft(StringTrimRight(timeStr));
   if(StringLen(raw) == 0) return 0;

   bool digitsOnly = true;
   for(int i = 0; i < StringLen(raw); i++)
   {
      ushort c = StringGetChar(raw, i);
      if(c < '0' || c > '9')
      {
         digitsOnly = false;
         break;
      }
   }
   if(digitsOnly) return (datetime)StrToInteger(raw);

   string normalized = raw;
   int tzPos = StringFind(normalized, "+", 10);
   if(tzPos < 0)
   {
      for(int j = 10; j < StringLen(normalized); j++)
      {
         if(StringGetChar(normalized, j) == '-')
         {
            tzPos = j;
            break;
         }
      }
   }
   if(tzPos > 0)
      normalized = StringSubstr(normalized, 0, tzPos);

   StringReplace(normalized, "T", " ");
   StringReplace(normalized, "Z", "");
   StringReplace(normalized, "/", ".");
   StringReplace(normalized, "-", ".");

   return StrToTime(StringTrimRight(normalized));
}

string GetJsonStringSafe(string json, string key)
{
   string pattern = "\"" + key + "\":\"";
   int pos = StringFind(json, pattern);
   if(pos < 0) return "";

   int start = pos + StringLen(pattern);
   string result = "";
   bool escaped = false;

   for(int i = start; i < StringLen(json); i++)
   {
      ushort c = StringGetChar(json, i);
      if(escaped)
      {
         if(c == 'n') result += "\n";
         else if(c == 't') result += "\t";
         else if(c == 'r') result += "\r";
         else if(c == '\\') result += "\\";
         else if(c == '"') result += "\"";
         else result += ShortToString(c);
         escaped = false;
      }
      else if(c == '\\')
      {
         escaped = true;
      }
      else if(c == '"')
      {
         break;
      }
      else
      {
         result += ShortToString(c);
      }
   }

   return result;
}

double GetJsonDouble(string json, string key)
{
   string pattern = "\"" + key + "\":";
   int pos = StringFind(json, pattern);
   if(pos < 0) return 0;

   int start = pos + StringLen(pattern);
   string rest = StringSubstr(json, start);
   string numText = "";

   for(int i = 0; i < StringLen(rest); i++)
   {
      ushort c = StringGetChar(rest, i);
      if((c >= 48 && c <= 57) || c == 46 || c == 45 || c == 101 || c == 69 || c == 43)
         numText += ShortToString(c);
      else if(StringLen(numText) > 0)
         break;
   }

   if(StringLen(numText) == 0)
      return 0;
   return StringToDouble(numText);
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

string GetJsonArraySafe(string json, string key)
{
   string pattern = "\"" + key + "\":[";
   int pos = StringFind(json, pattern);
   if(pos < 0) return "";

   int start = pos + StringLen(pattern) - 1;
   int bracketCount = 0;
   int end = start;
   bool inString = false;
   bool escaped = false;

   for(int i = start; i < StringLen(json); i++)
   {
      ushort c = StringGetChar(json, i);
      if(escaped)
      {
         escaped = false;
         continue;
      }
      if(c == '\\')
      {
         escaped = true;
         continue;
      }
      if(c == '"')
      {
         inString = !inString;
         continue;
      }
      if(inString)
         continue;
      if(c == '[') bracketCount++;
      else if(c == ']')
      {
         bracketCount--;
         if(bracketCount == 0)
         {
            end = i;
            break;
         }
      }
   }

   return StringSubstr(json, start + 1, end - start - 1);
}

string GetJsonObjectSafe(string json, string key)
{
   string pattern = "\"" + key + "\":{";
   int pos = StringFind(json, pattern);
   if(pos < 0) return "";

   int start = pos + StringLen(pattern) - 1;
   int braceCount = 0;
   int end = start;
   bool inString = false;
   bool escaped = false;

   for(int i = start; i < StringLen(json); i++)
   {
      ushort c = StringGetChar(json, i);
      if(escaped)
      {
         escaped = false;
         continue;
      }
      if(c == '\\')
      {
         escaped = true;
         continue;
      }
      if(c == '"')
      {
         inString = !inString;
         continue;
      }
      if(inString)
         continue;
      if(c == '{') braceCount++;
      else if(c == '}')
      {
         braceCount--;
         if(braceCount == 0)
         {
            end = i;
            break;
         }
      }
   }

   return StringSubstr(json, start, end - start + 1);
}

string GetArrayElement(string arrayText, int index)
{
   int braceCount = 0;
   int start = -1;
   int currentIndex = 0;
   bool inString = false;
   bool escaped = false;

   for(int i = 0; i < StringLen(arrayText); i++)
   {
      ushort c = StringGetChar(arrayText, i);
      if(escaped)
      {
         escaped = false;
         continue;
      }
      if(c == '\\')
      {
         escaped = true;
         continue;
      }
      if(c == '"')
      {
         inString = !inString;
         continue;
      }
      if(inString)
         continue;

      if(c == '{')
      {
         if(braceCount == 0)
            start = i;
         braceCount++;
      }
      else if(c == '}')
      {
         braceCount--;
         if(braceCount == 0 && currentIndex == index)
            return StringSubstr(arrayText, start, i - start + 1);
      }
      else if(c == ',' && braceCount == 0)
      {
         currentIndex++;
      }
   }

   return "";
}

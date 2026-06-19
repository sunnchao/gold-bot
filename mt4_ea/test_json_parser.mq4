//+------------------------------------------------------------------+
//| JSON 解析器测试脚本                                               |
//| 用于验证 GetJsonStringSafe 和 GetJsonArraySafe 的正确性          |
//+------------------------------------------------------------------+
#property copyright "Gold Bolt"
#property version   "1.0"
#property strict
#property script_show_inputs

//+------------------------------------------------------------------+
//| 复制安全 JSON 解析函数（与 EA 中一致）                            |
//+------------------------------------------------------------------+
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
         // 处理转义字符
         if(c == 'n') result += "\n";
         else if(c == 't') result += "\t";
         else if(c == 'r') result += "\r";
         else if(c == '\\') result += "\\";
         else if(c == '"') result += "\"";
         else result += ShortToString(c);  // 未知转义，保留原字符

         escaped = false;
      }
      else if(c == '\\')
      {
         escaped = true;
      }
      else if(c == '"')
      {
         break;  // 字符串结束
      }
      else
      {
         result += ShortToString(c);
      }
   }

   return result;
}

string GetJsonArraySafe(string json, string key)
{
   string pattern = "\"" + key + "\":[";
   int pos = StringFind(json, pattern);
   if(pos < 0) return "";

   int start = pos + StringLen(pattern) - 1;
   int bracket_count = 0;
   int end = start;
   bool in_string = false;
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
         in_string = !in_string;
         continue;
      }

      if(in_string) continue;  // 忽略字符串内的字符

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

//+------------------------------------------------------------------+
//| 测试用例                                                         |
//+------------------------------------------------------------------+
void OnStart()
{
   Print("========================================");
   Print("JSON 解析器测试开始");
   Print("========================================");

   int passed = 0;
   int failed = 0;

   // ========== 测试 1：基础字符串解析 ==========
   string test1 = "{\"action\":\"SIGNAL\",\"symbol\":\"XAUUSD\"}";
   string result1 = GetJsonStringSafe(test1, "action");
   if(result1 == "SIGNAL")
   {
      Print("✅ 测试 1 通过：基础字符串解析");
      passed++;
   }
   else
   {
      Print("❌ 测试 1 失败：期望 'SIGNAL'，实际 '", result1, "'");
      failed++;
   }

   // ========== 测试 2：转义引号 ==========
   string test2 = "{\"comment\":\"Price \\\"high\\\"\",\"value\":100}";
   string result2 = GetJsonStringSafe(test2, "comment");
   if(result2 == "Price \"high\"")
   {
      Print("✅ 测试 2 通过：转义引号解析");
      passed++;
   }
   else
   {
      Print("❌ 测试 2 失败：期望 'Price \"high\"'，实际 '", result2, "'");
      failed++;
   }

   // ========== 测试 3：转义反斜杠 ==========
   string test3 = "{\"path\":\"C:\\\\Users\\\\test\",\"id\":1}";
   string result3 = GetJsonStringSafe(test3, "path");
   if(result3 == "C:\\Users\\test")
   {
      Print("✅ 测试 3 通过：转义反斜杠解析");
      passed++;
   }
   else
   {
      Print("❌ 测试 3 失败：期望 'C:\\Users\\test'，实际 '", result3, "'");
      failed++;
   }

   // ========== 测试 4：换行符 ==========
   string test4 = "{\"reason\":\"line1\\nline2\",\"id\":1}";
   string result4 = GetJsonStringSafe(test4, "reason");
   if(StringFind(result4, "\n") >= 0)
   {
      Print("✅ 测试 4 通过：换行符解析");
      passed++;
   }
   else
   {
      Print("❌ 测试 4 失败：未检测到换行符，实际 '", result4, "'");
      failed++;
   }

   // ========== 测试 5：基础数组解析 ==========
   string test5 = "{\"commands\":[{\"action\":\"BUY\"},{\"action\":\"SELL\"}]}";
   string result5 = GetJsonArraySafe(test5, "commands");
   if(StringFind(result5, "BUY") >= 0 && StringFind(result5, "SELL") >= 0)
   {
      Print("✅ 测试 5 通过：基础数组解析");
      passed++;
   }
   else
   {
      Print("❌ 测试 5 失败：数组解析错误，实际 '", result5, "'");
      failed++;
   }

   // ========== 测试 6：数组中的方括号字符串 ==========
   string test6 = "{\"commands\":[{\"comment\":\"Price [2500]\",\"action\":\"BUY\"}]}";
   string result6 = GetJsonArraySafe(test6, "commands");
   if(StringFind(result6, "Price [2500]") >= 0)
   {
      Print("✅ 测试 6 通过：数组中的方括号字符串");
      passed++;
   }
   else
   {
      Print("❌ 测试 6 失败：方括号处理错误，实际 '", result6, "'");
      failed++;
   }

   // ========== 测试 7：空字符串 ==========
   string test7 = "{\"action\":\"\",\"symbol\":\"XAUUSD\"}";
   string result7 = GetJsonStringSafe(test7, "action");
   if(result7 == "")
   {
      Print("✅ 测试 7 通过：空字符串解析");
      passed++;
   }
   else
   {
      Print("❌ 测试 7 失败：期望空字符串，实际 '", result7, "'");
      failed++;
   }

   // ========== 测试 8：不存在的键 ==========
   string test8 = "{\"action\":\"BUY\"}";
   string result8 = GetJsonStringSafe(test8, "symbol");
   if(result8 == "")
   {
      Print("✅ 测试 8 通过：不存在的键返回空");
      passed++;
   }
   else
   {
      Print("❌ 测试 8 失败：期望空字符串，实际 '", result8, "'");
      failed++;
   }

   // ========== 测试 9：多个相同键（取第一个）==========
   string test9 = "{\"action\":\"BUY\",\"action\":\"SELL\"}";
   string result9 = GetJsonStringSafe(test9, "action");
   if(result9 == "BUY")
   {
      Print("✅ 测试 9 通过：多个相同键取第一个");
      passed++;
   }
   else
   {
      Print("❌ 测试 9 失败：期望 'BUY'，实际 '", result9, "'");
      failed++;
   }

   // ========== 测试 10：复杂嵌套数组 ==========
   string test10 = "{\"data\":[{\"items\":[1,2,3]},{\"items\":[4,5]}]}";
   string result10 = GetJsonArraySafe(test10, "data");
   if(StringFind(result10, "items") >= 0)
   {
      Print("✅ 测试 10 通过：嵌套数组解析");
      passed++;
   }
   else
   {
      Print("❌ 测试 10 失败：嵌套数组错误，实际 '", result10, "'");
      failed++;
   }

   // ========== 测试 11：真实指令解析 ==========
   string test11 = "{\"count\":2,\"commands\":[{\"action\":\"SIGNAL\",\"command_id\":\"cmd_001\",\"symbol\":\"XAUUSD\",\"type\":\"BUY\",\"strategy\":\"pullback\"},{\"action\":\"CLOSE\",\"command_id\":\"cmd_002\",\"ticket\":12345,\"reason\":\"TP hit\"}]}";
   string result11 = GetJsonArraySafe(test11, "commands");
   string cmd1_action = GetJsonStringSafe(result11, "action");
   if(cmd1_action == "SIGNAL")
   {
      Print("✅ 测试 11 通过：真实指令解析");
      passed++;
   }
   else
   {
      Print("❌ 测试 11 失败：真实指令解析错误，action='", cmd1_action, "'");
      failed++;
   }

   // ========== 测试 12：带转义的数组 ==========
   string test12 = "{\"commands\":[{\"comment\":\"Line1\\nLine2\",\"action\":\"BUY\"}]}";
   string result12 = GetJsonArraySafe(test12, "commands");
   string comment12 = GetJsonStringSafe(result12, "comment");
   if(StringFind(comment12, "\n") >= 0)
   {
      Print("✅ 测试 12 通过：数组中的转义字符");
      passed++;
   }
   else
   {
      Print("❌ 测试 12 失败：数组转义处理错误，comment='", comment12, "'");
      failed++;
   }

   // ========== 测试总结 ==========
   Print("========================================");
   Print("测试完成");
   Print("通过: ", passed, " / ", (passed + failed));
   Print("失败: ", failed);
   if(failed == 0)
      Print("✅ 所有测试通过！");
   else
      Print("❌ 存在测试失败，请检查实现");
   Print("========================================");
}
//+------------------------------------------------------------------+

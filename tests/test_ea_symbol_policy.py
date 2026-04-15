import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MT4_PATH = ROOT / "mt4_ea" / "GoldBolt_Client.mq4"
MT5_PATH = ROOT / "mt5_ea" / "GoldBolt_Client.mq5"


def read_source(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_function(source: str, name: str) -> str:
    pattern = re.compile(
        rf"\b(?:void|bool|int|double|string|ulong)\s+{re.escape(name)}\s*\([^)]*\)\s*\{{",
        re.MULTILINE,
    )
    match = pattern.search(source)
    if not match:
        raise AssertionError(f"function not found: {name}")

    brace_start = match.end() - 1
    depth = 0
    for idx in range(brace_start, len(source)):
        char = source[idx]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[match.start() : idx + 1]

    raise AssertionError(f"unterminated function: {name}")


class EASymbolPolicySourceTests(unittest.TestCase):
    maxDiff = None

    SPREAD_HELPERS = {"MT4": "MODE_SPREAD", "MT5": "SYMBOL_SPREAD"}

    @classmethod
    def setUpClass(cls):
        cls.sources = {
            "MT4": read_source(MT4_PATH),
            "MT5": read_source(MT5_PATH),
        }

    def assert_function_exists(self, label: str, func_name: str) -> str:
        return extract_function(self.sources[label], func_name)

    def assert_close_failure_reporting(
        self, label: str, func_name: str, not_found_error: str
    ) -> str:
        func = self.assert_function_exists(label, func_name)
        self.assertRegex(
            func,
            re.compile(r"bool\s+matchedPosition\s*=\s*false\s*;"),
            f"{label} {func_name} should track whether any matching position was found",
        )
        self.assertRegex(
            func,
            re.compile(r"matchedPosition\s*=\s*true\s*;"),
            f"{label} {func_name} should mark matched spread positions before attempting closes",
        )
        self.assertRegex(
            func,
            re.compile(r"bool\s+closeFailed\s*=\s*false\s*;"),
            f"{label} {func_name} should track broker close failures explicitly",
        )
        self.assertRegex(
            func,
            re.compile(r"closeFailed\s*=\s*true\s*;"),
            f"{label} {func_name} should record broker close failures when a close attempt fails",
        )
        self.assertRegex(
            func,
            re.compile(
                rf'if\s*\(\s*!\s*matchedPosition\s*\)\s*\{{.*?ReportResult\([^\n]*"{re.escape(not_found_error)}"',
                re.S,
            ),
            f"{label} {func_name} should only report {not_found_error} when nothing matched",
        )
        self.assertRegex(
            func,
            re.compile(
                r'if\s*\(\s*closeFailed\s*\)\s*\{.*?ReportResult\([^\n]*"close_failed"',
                re.S,
            ),
            f"{label} {func_name} should report explicit close_failed results when broker closes fail",
        )
        return func

    def test_policy_helpers_defined_in_both_eas(self):
        for label in self.sources:
            self.assert_function_exists(label, "IsPrimarySymbol")
            self.assert_function_exists(label, "IsSpreadSymbol")
            self.assert_function_exists(label, "IsAllowedSymbol")

    def test_oninit_validates_primary_symbol_availability_and_chart_binding(self):
        for label in self.sources:
            on_init = self.assert_function_exists(label, "OnInit")
            self.assertIn(
                "IsSymbolAvailable(Symbol_)",
                on_init,
                f"{label} missing primary symbol availability check",
            )
            self.assertRegex(
                on_init,
                r"(?:Symbol\(\)|_Symbol)\s*!=\s*Symbol_|Symbol_\s*!=\s*(?:Symbol\(\)|_Symbol)",
                f"{label} missing strict chart symbol validation",
            )
            self.assertIn(
                "INIT_FAILED",
                on_init,
                f"{label} should fail init on symbol validation errors",
            )

    def test_execute_signal_rejects_mismatched_command_symbol(self):
        for label in self.sources:
            execute_signal = self.assert_function_exists(label, "ExecuteSignal")
            self.assertIn(
                'GetJsonString(cmd, "symbol")',
                execute_signal,
                f"{label} should read command symbol",
            )
            self.assertIn(
                "IsPrimarySymbol",
                execute_signal,
                f"{label} should validate signal target against primary symbol",
            )
            self.assertRegex(
                execute_signal,
                r"ReportResult\([^\n]*symbol",
                f"{label} should reject mismatched signal symbols with an explicit result",
            )

    def test_spread_actions_are_gated_by_enablement_and_configured_spread_symbols(self):
        for label in self.sources:
            execute_open = self.assert_function_exists(label, "ExecuteOpen")
            execute_close_partial = self.assert_function_exists(
                label, "ExecuteClosePartial"
            )
            execute_close_all = self.assert_function_exists(label, "ExecuteCloseAll")
            self.assertIn(
                "EnableSpread",
                execute_open,
                f"{label} open action should respect spread enablement",
            )
            self.assertIn(
                "IsSpreadSymbol",
                execute_open,
                f"{label} open action should guard spread legs",
            )
            self.assertIn(
                "EnableSpread",
                execute_close_partial,
                f"{label} close partial should respect spread enablement",
            )
            self.assertIn(
                "IsSpreadSymbol",
                execute_close_partial,
                f"{label} close partial should guard spread legs",
            )
            self.assertIn(
                "EnableSpread",
                execute_close_all,
                f"{label} close all should respect spread enablement",
            )
            self.assertIn(
                "IsSpreadSymbol",
                execute_close_all,
                f"{label} close all should guard spread legs",
            )

    def test_configured_spread_symbols_remain_visible_for_management(self):
        for label in self.sources:
            is_spread_symbol = self.assert_function_exists(label, "IsSpreadSymbol")
            is_allowed_symbol = self.assert_function_exists(label, "IsAllowedSymbol")
            send_positions = self.assert_function_exists(label, "SendPositions")

            self.assertNotIn(
                "EnableSpread",
                is_spread_symbol,
                f"{label} IsSpreadSymbol should keep configured spread legs visible even when spread entry is disabled",
            )
            self.assertIn(
                "SpreadSymbol1",
                is_spread_symbol,
                f"{label} IsSpreadSymbol should match the first configured spread leg",
            )
            self.assertIn(
                "SpreadSymbol2",
                is_spread_symbol,
                f"{label} IsSpreadSymbol should match the second configured spread leg",
            )
            self.assertIn(
                "IsSpreadSymbol",
                is_allowed_symbol,
                f"{label} allowed symbol policy should include configured spread legs",
            )
            self.assertIn(
                "IsAllowedSymbol",
                send_positions,
                f"{label} positions sync should keep using the shared allowed symbol policy",
            )

    def test_modify_and_close_guard_selected_symbol(self):
        for label in self.sources:
            execute_modify = self.assert_function_exists(label, "ExecuteModify")
            execute_close = self.assert_function_exists(label, "ExecuteClose")
            self.assertIn(
                "IsAllowedSymbol",
                execute_modify,
                f"{label} modify should guard selected symbol",
            )
            self.assertIn(
                "IsAllowedSymbol",
                execute_close,
                f"{label} close should guard selected symbol",
            )
            self.assertIn(
                "IsOurMagic",
                execute_modify,
                f"{label} modify should guard selected order ownership/magic",
            )
            self.assertIn(
                "IsOurMagic",
                execute_close,
                f"{label} close should guard selected order ownership/magic",
            )

    def test_execute_open_rejects_invalid_side_in_both_eas(self):
        pattern = re.compile(
            r'if\s*\(\s*side\s*!=\s*"BUY"\s*&&\s*side\s*!=\s*"SELL"\s*\).*?'
            r'ReportResult\([^\n]*"invalid_side"',
            re.S,
        )
        for label in self.sources:
            execute_open = self.assert_function_exists(label, "ExecuteOpen")
            self.assertRegex(
                execute_open,
                pattern,
                f"{label} execute open should explicitly reject invalid side payloads",
            )

    def test_execute_signal_rejects_invalid_type_in_both_eas(self):
        pattern = re.compile(
            r'if\s*\(\s*type_str\s*!=\s*"BUY"\s*&&\s*type_str\s*!=\s*"SELL"\s*\).*?'
            r'ReportResult\([^\n]*"invalid_type"',
            re.S,
        )
        for label in self.sources:
            execute_signal = self.assert_function_exists(label, "ExecuteSignal")
            self.assertRegex(
                execute_signal,
                pattern,
                f"{label} execute signal should explicitly reject invalid type payloads",
            )

    def test_execute_signal_rejects_invalid_or_disabled_strategy(self):
        for label in self.sources:
            execute_signal = self.assert_function_exists(label, "ExecuteSignal")
            self.assertIn(
                "GetStrategyMagic(strategy)",
                execute_signal,
                f"{label} execute signal should resolve strategy magic explicitly",
            )
            self.assertIn(
                "IsStrategyEnabled(strategy)",
                execute_signal,
                f"{label} execute signal should validate strategy enablement",
            )
            self.assertRegex(
                execute_signal,
                re.compile(r'ReportResult\([^\n]*"invalid_strategy"'),
                f"{label} execute signal should reject unknown strategies",
            )
            self.assertRegex(
                execute_signal,
                re.compile(r'ReportResult\([^\n]*"strategy_disabled"'),
                f"{label} execute signal should reject disabled strategies",
            )

    def test_execute_signal_uses_post_fill_stop_attachment_for_market_orders(self):
        mt4_execute_signal = self.assert_function_exists("MT4", "ExecuteSignal")
        self.assertRegex(
            mt4_execute_signal,
            re.compile(
                r"OrderSend\(Symbol_,\s*op_type,\s*lots,\s*price,\s*Slippage,\s*0,\s*0,\s*comment,\s*magicForOrder",
                re.S,
            ),
            "MT4 signal opens should submit market orders without initial SL/TP for ECN/STP compatibility",
        )
        self.assertNotRegex(
            mt4_execute_signal,
            re.compile(
                r"OrderSend\(Symbol_,\s*op_type,\s*lots,\s*price,\s*Slippage,\s*sl,\s*tp1,\s*comment,\s*magicForOrder",
                re.S,
            ),
            "MT4 signal opens should not attach SL/TP on the initial OrderSend request",
        )
        self.assertRegex(
            mt4_execute_signal,
            re.compile(r"OrderModify\(ticket,\s*OrderOpenPrice\(\)", re.S),
            "MT4 signal opens should attach/adjust protective stops after fill using the actual open price",
        )

        mt5_execute_signal = self.assert_function_exists("MT5", "ExecuteSignal")
        self.assertRegex(
            mt5_execute_signal,
            re.compile(
                r"trade\.Buy\(lots,\s*Symbol_,\s*0\.0,\s*0\.0,\s*0\.0,\s*comment\)",
                re.S,
            ),
            "MT5 BUY signal opens should submit market orders without initial SL/TP for ECN/STP compatibility",
        )
        self.assertRegex(
            mt5_execute_signal,
            re.compile(
                r"trade\.Sell\(lots,\s*Symbol_,\s*0\.0,\s*0\.0,\s*0\.0,\s*comment\)",
                re.S,
            ),
            "MT5 SELL signal opens should submit market orders without initial SL/TP for ECN/STP compatibility",
        )
        self.assertNotRegex(
            mt5_execute_signal,
            re.compile(
                r"trade\.Buy\(lots,\s*Symbol_,\s*0\.0,\s*sl,\s*tp1,\s*comment\)", re.S
            ),
            "MT5 BUY signal opens should not attach SL/TP on the initial trade request",
        )
        self.assertNotRegex(
            mt5_execute_signal,
            re.compile(
                r"trade\.Sell\(lots,\s*Symbol_,\s*0\.0,\s*sl,\s*tp1,\s*comment\)", re.S
            ),
            "MT5 SELL signal opens should not attach SL/TP on the initial trade request",
        )
        mt5_protection_helper = self.assert_function_exists(
            "MT5", "EnsureSignalProtectionAttached"
        )
        self.assertIn(
            "EnsureSignalProtectionAttached(ticket, type_str, sl, tp1)",
            mt5_execute_signal,
            "MT5 signal opens should route post-fill protection attachment through a dedicated helper",
        )
        self.assertIn(
            "trade.PositionModify",
            mt5_protection_helper,
            "MT5 signal opens should attach/adjust protective stops after fill",
        )
        self.assertIn(
            "PositionGetDouble(POSITION_PRICE_OPEN)",
            mt5_protection_helper,
            "MT5 post-fill protection attachment should use the actual filled open price",
        )

    def test_execute_signal_reports_partial_failure_when_post_fill_protection_attach_fails(
        self,
    ):
        mt4_execute_signal = self.assert_function_exists("MT4", "ExecuteSignal")
        self.assertRegex(
            mt4_execute_signal,
            re.compile(
                r"OrderModify\(ticket,\s*OrderOpenPrice\(\),\s*final_sl,\s*final_tp,\s*0,\s*clrYellow\).*?"
                r'else\s*\{.*?ReportResult\(cmd_id,\s*"ERROR",\s*ticket,\s*"protection_attach_failed"\);.*?return\s*;',
                re.S,
            ),
            "MT4 signal opens should report a non-success result when post-fill protection attachment fails",
        )

        mt5_execute_signal = self.assert_function_exists("MT5", "ExecuteSignal")
        mt5_protection_helper = self.assert_function_exists(
            "MT5", "EnsureSignalProtectionAttached"
        )
        self.assertRegex(
            mt5_protection_helper,
            re.compile(
                r"trade\.PositionModify\(ticket,\s*final_sl,\s*final_tp\).*?"
                r'return\s*"protection_attach_failed"\s*;',
                re.S,
            ),
            "MT5 signal protection helper should surface protection_attach_failed when broker modification fails",
        )
        self.assertRegex(
            mt5_execute_signal,
            re.compile(
                r"string\s+protectionStatus\s*=\s*EnsureSignalProtectionAttached\(ticket,\s*type_str,\s*sl,\s*tp1\)\s*;.*?"
                r'if\s*\(\s*protectionStatus\s*!=\s*""\s*\)\s*\{.*?ReportResult\(cmd_id,\s*"ERROR",\s*\(long\)ticket,\s*protectionStatus\);.*?return\s*;',
                re.S,
            ),
            "MT5 signal opens should downgrade protection helper failures to a non-success result",
        )

    def test_mt4_signal_open_requires_selected_order_and_verified_protection_before_ok(
        self,
    ):
        mt4_execute_signal = self.assert_function_exists("MT4", "ExecuteSignal")
        self.assertRegex(
            mt4_execute_signal,
            re.compile(
                r'if\s*\(\s*!OrderSelect\(ticket,\s*SELECT_BY_TICKET\)\s*\)\s*\{.*?ReportResult\(cmd_id,\s*"ERROR",\s*ticket,\s*"position_resolve_incomplete"\);.*?return\s*;',
                re.S,
            ),
            "MT4 signal opens should fail closed when the just-opened order cannot be selected",
        )
        self.assertRegex(
            mt4_execute_signal,
            re.compile(
                r'if\s*\(\s*OrderStopLoss\(\)\s*==\s*0\s*\|\|\s*OrderTakeProfit\(\)\s*==\s*0\s*\)\s*\{.*?ReportResult\(cmd_id,\s*"ERROR",\s*ticket,\s*"protection_attach_incomplete"\);.*?return\s*;.*?ReportResult\(cmd_id,\s*"OK",\s*ticket,\s*""\);',
                re.S,
            ),
            "MT4 signal opens should only report OK after post-fill protection is verified on the selected order",
        )

    def test_check_risk_enforces_max_spread(self):
        pattern = re.compile(
            r"if\s*\([^\n]*MaxSpread[^\n]*\).*?return\s+false\s*;",
            re.S,
        )
        for label in self.sources:
            check_risk = self.assert_function_exists(label, "CheckRisk")
            self.assertIn(
                "MaxSpread",
                check_risk,
                f"{label} CheckRisk should reference MaxSpread",
            )
            self.assertRegex(
                check_risk,
                pattern,
                f"{label} CheckRisk should reject trades when spread exceeds MaxSpread",
            )
            self.assertIn(
                "GetCurrentSpreadPoints(Symbol_)",
                check_risk,
                f"{label} CheckRisk should use the shared spread helper",
            )
            self.assertNotRegex(
                check_risk,
                re.compile(r"/\s*10\.0"),
                f"{label} CheckRisk should not rely on ambiguous /10.0 spread scaling",
            )

    def test_close_partial_uses_remaining_lots_across_multiple_positions(self):
        for label in self.sources:
            execute_close_partial = self.assert_function_exists(
                label, "ExecuteClosePartial"
            )
            self.assertRegex(
                execute_close_partial,
                re.compile(r"double\s+remainingLots\s*=\s*lots\s*;"),
                f"{label} close partial should track remaining lots to close",
            )
            self.assertIn(
                "MathMin(remainingLots",
                execute_close_partial,
                f"{label} close partial should cap each close by remaining lots",
            )
            self.assertRegex(
                execute_close_partial,
                re.compile(r"remainingLots\s*-="),
                f"{label} close partial should reduce remaining lots after each partial close",
            )
            self.assertNotIn(
                "MathMin(lots",
                execute_close_partial,
                f"{label} close partial should not reuse the original request lots for every ticket",
            )

    def test_close_partial_normalizes_close_lots_before_trade_call(self):
        trade_calls = {"MT4": "OrderClose", "MT5": "PositionClosePartial"}
        for label in self.sources:
            execute_close_partial = self.assert_function_exists(
                label, "ExecuteClosePartial"
            )
            self.assertRegex(
                execute_close_partial,
                re.compile(
                    rf"closeLots\s*=\s*NormalizeCloseVolume\(symbol,\s*closeLots\)\s*;.*?{trade_calls[label]}\([^\n]*closeLots",
                    re.S,
                ),
                f"{label} close partial should normalize close lots before the trade API call",
            )

    def test_spread_close_actions_report_explicit_trade_failures_after_matching_positions(
        self,
    ):
        for label in self.sources:
            execute_close_partial = self.assert_close_failure_reporting(
                label, "ExecuteClosePartial", "position_not_found"
            )
            execute_close_all = self.assert_close_failure_reporting(
                label, "ExecuteCloseAll", "no_position_found"
            )

            self.assertIn(
                "partial_close_incomplete",
                execute_close_partial,
                f"{label} close partial should still preserve the incomplete-close result when no broker close fails",
            )
            self.assertRegex(
                execute_close_partial,
                re.compile(
                    r'if\s*\(\s*closeFailed\s*\)\s*\{.*?ReportResult\([^\n]*"close_failed".*?partial_close_incomplete',
                    re.S,
                ),
                f"{label} close partial should check close_failed before falling back to partial_close_incomplete",
            )
            self.assertNotRegex(
                execute_close_all,
                re.compile(
                    r'if\s*\(\s*closeFailed\s*\)\s*\{.*?"no_position_found"',
                    re.S,
                ),
                f"{label} close all should not reuse no_position_found when a broker close fails",
            )

    def test_mt5_done_partial_is_not_treated_as_full_success(self):
        is_trade_retcode_success = self.assert_function_exists(
            "MT5", "IsTradeRetcodeSuccess"
        )
        self.assertNotIn(
            "TRADE_RETCODE_DONE_PARTIAL",
            is_trade_retcode_success,
            "MT5 should not treat DONE_PARTIAL as a full trade success",
        )

        trade_operation_partially_filled = self.assert_function_exists(
            "MT5", "TradeOperationPartiallyFilled"
        )
        self.assertIn(
            "IsTradeRetcodePartialFill()",
            trade_operation_partially_filled,
            "MT5 should expose an explicit partial-fill helper for close-path handling",
        )

    def test_mt5_close_paths_report_incomplete_results_for_partial_broker_fills(self):
        execute_close_partial = self.assert_function_exists(
            "MT5", "ExecuteClosePartial"
        )
        self.assertIn(
            "TradeOperationPartiallyFilled(result)",
            execute_close_partial,
            "MT5 partial close should detect DONE_PARTIAL separately from full success",
        )
        self.assertIn(
            "double positionVolumeBefore = PositionGetDouble(POSITION_VOLUME);",
            execute_close_partial,
            "MT5 partial close should snapshot position volume before submitting the broker close",
        )
        self.assertRegex(
            execute_close_partial,
            re.compile(
                r"filledLots\s*=\s*NormalizeCloseVolume\(symbol,\s*MathMax\(0\.0,\s*positionVolumeBefore\s*-\s*PositionGetDouble\(POSITION_VOLUME\)\)\)\s*;",
                re.S,
            ),
            "MT5 partial close should derive the actually filled volume before updating remaining lots",
        )
        self.assertRegex(
            execute_close_partial,
            re.compile(
                r'else\s+if\s*\(\s*TradeOperationPartiallyFilled\(result\)\s*\)\s*\{.*?ReportResult\(cmd_id,\s*"ERROR",\s*\(long\)ticket,\s*"partial_close_incomplete"\);',
                re.S,
            ),
            "MT5 partial close should report partial_close_incomplete when the broker only partially fills the close request",
        )

        execute_close_all = self.assert_function_exists("MT5", "ExecuteCloseAll")
        self.assertRegex(
            execute_close_all,
            re.compile(
                r'else\s+if\s*\(\s*TradeOperationPartiallyFilled\(result\)\s*\)\s*\{.*?closeIncomplete\s*=\s*true\s*;.*?ReportResult\(cmd_id,\s*"ERROR",\s*\(long\)incompleteTicket,\s*"close_incomplete"\);',
                re.S,
            ),
            "MT5 close all should downgrade DONE_PARTIAL to a close_incomplete result",
        )

        execute_close = self.assert_function_exists("MT5", "ExecuteClose")
        self.assertRegex(
            execute_close,
            re.compile(
                r'else\s+if\s*\(\s*TradeOperationPartiallyFilled\(result\)\s*\)\s*\{.*?ReportResult\(cmd_id,\s*"ERROR",\s*\(long\)ticket,\s*"close_incomplete"\);',
                re.S,
            ),
            "MT5 close should downgrade DONE_PARTIAL to a close_incomplete result",
        )

    def test_mt5_entry_paths_report_explicit_incomplete_results_for_partial_broker_fills(
        self,
    ):
        execute_open = self.assert_function_exists("MT5", "ExecuteOpen")
        execute_signal = self.assert_function_exists("MT5", "ExecuteSignal")

        for func_name, func in (
            ("ExecuteOpen", execute_open),
            ("ExecuteSignal", execute_signal),
        ):
            self.assertIn(
                "TradeOperationPartiallyFilled(result)",
                func,
                f"MT5 {func_name} should detect DONE_PARTIAL separately from full success",
            )
            self.assertIn(
                "ResolveLivePositionTicket",
                func,
                f"MT5 {func_name} should resolve the live position before reporting partial entry results",
            )
            self.assertRegex(
                func,
                re.compile(
                    r"else\s+if\s*\(\s*TradeOperationPartiallyFilled\(result\)\s*\)\s*\{.*?"
                    r'ReportResult\(cmd_id,\s*"ERROR",\s*\(long\)reportTicket,\s*"position_resolve_incomplete"\);.*?'
                    r'ReportResult\(cmd_id,\s*"ERROR",\s*\(long\)ticket,\s*"open_incomplete"\);',
                    re.S,
                ),
                f"MT5 {func_name} should downgrade broker partial fills to explicit incomplete entry results",
            )

    def test_mt5_signal_open_requires_resolved_position_and_verified_protection_before_ok(
        self,
    ):
        resolve_position = self.assert_function_exists("MT5", "ResolvePositionTicket")
        self.assertIn(
            "trade.ResultDeal()",
            resolve_position,
            "MT5 should use the broker-confirmed deal result when raw position ticket selection misses",
        )
        self.assertIn(
            "DEAL_POSITION_ID",
            resolve_position,
            "MT5 should recover the live position through the executed deal's position identifier",
        )
        self.assertIn(
            "FindUniquePositionTicket",
            resolve_position,
            "MT5 should only fall back to a unique exact live-position match when direct identification fails",
        )
        self.assertNotIn(
            "PositionSelect(symbol)",
            resolve_position,
            "MT5 should not use broad symbol selection as an entry-position fallback in hedging mode",
        )

        resolve_live_position = self.assert_function_exists(
            "MT5", "ResolveLivePositionTicket"
        )
        self.assertIn(
            "ResolvePositionTicket",
            resolve_live_position,
            "MT5 should reuse the broader position-resolution helper before requiring live selection",
        )
        self.assertRegex(
            resolve_live_position,
            re.compile(
                r"if\s*\(\s*ticket\s*==\s*0\s*\)\s*return\s+0\s*;.*?"
                r"if\s*\(\s*!PositionSelectByTicket\(ticket\)\s*\)\s*return\s+0\s*;.*?"
                r"if\s*\(\s*!SelectedPositionMatches\(symbol,\s*magic,\s*posType\)\s*\)\s*return\s+0\s*;.*?"
                r"return\s+ticket\s*;",
                re.S,
            ),
            "MT5 live-position resolution should fail closed unless the resolved ticket can be reselected and revalidated",
        )
        self.assertIn(
            "SelectedPositionMatches",
            resolve_live_position,
            "MT5 live-position resolution should re-validate the selected live position before returning it",
        )
        self.assertNotIn(
            "PositionSelect(symbol)",
            resolve_live_position,
            "MT5 live-position resolution should not fall back to broad symbol-based selection",
        )

        mt5_execute_signal = self.assert_function_exists("MT5", "ExecuteSignal")
        self.assertRegex(
            mt5_execute_signal,
            re.compile(
                r"ulong\s+ticket\s*=\s*ResolveLivePositionTicket\(rawTicket,\s*Symbol_,\s*magicForOrder,\s*posType\)\s*;.*?"
                r'if\s*\(\s*ticket\s*==\s*0\s*\)\s*\{.*?ReportResult\(cmd_id,\s*"ERROR",\s*\(long\)rawTicket,\s*"position_resolve_incomplete"\);.*?return\s*;',
                re.S,
            ),
            "MT5 signal opens should fail closed when they cannot resolve/select the live position",
        )
        self.assertRegex(
            mt5_execute_signal,
            re.compile(
                r"string\s+protectionStatus\s*=\s*EnsureSignalProtectionAttached\(ticket,\s*type_str,\s*sl,\s*tp1\)\s*;.*?"
                r'if\s*\(\s*protectionStatus\s*!=\s*""\s*\)\s*\{.*?ReportResult\(cmd_id,\s*"ERROR",\s*\(long\)ticket,\s*protectionStatus\);.*?return\s*;.*?'
                r'ReportResult\(cmd_id,\s*"OK",\s*\(long\)ticket,\s*""\);',
                re.S,
            ),
            "MT5 signal opens should only report OK after protection attachment has been verified",
        )

        mt5_protection_helper = self.assert_function_exists(
            "MT5", "EnsureSignalProtectionAttached"
        )
        self.assertRegex(
            mt5_protection_helper,
            re.compile(
                r'if\s*\(\s*ticket\s*==\s*0\s*\|\|\s*!PositionSelectByTicket\(ticket\)\s*\)\s*\{.*?return\s+"position_resolve_incomplete"\s*;',
                re.S,
            ),
            "MT5 protection attachment should refuse to continue without a selected live position",
        )
        self.assertRegex(
            mt5_protection_helper,
            re.compile(
                r'if\s*\(\s*!PositionSelectByTicket\(ticket\)\s*\)\s*\{.*?return\s+"position_resolve_incomplete"\s*;',
                re.S,
            ),
            "MT5 protection attachment should reselect the position after modification before declaring success",
        )
        self.assertRegex(
            mt5_protection_helper,
            re.compile(
                r'if\s*\(\s*PositionGetDouble\(POSITION_SL\)\s*==\s*0\.0\s*\|\|\s*PositionGetDouble\(POSITION_TP\)\s*==\s*0\.0\s*\)\s*\{.*?return\s+"protection_attach_incomplete"\s*;',
                re.S,
            ),
            "MT5 protection attachment should reject unresolved zero-protection states after a fill",
        )

    def test_mt5_position_resolution_helpers_require_unique_safe_matches(self):
        by_identifier = self.assert_function_exists(
            "MT5", "FindPositionTicketByIdentifier"
        )
        unique_match = self.assert_function_exists("MT5", "FindUniquePositionTicket")

        self.assertIn(
            "POSITION_IDENTIFIER",
            by_identifier,
            "MT5 identifier-based resolution should scan live positions by POSITION_IDENTIFIER",
        )
        self.assertIn(
            "matchedCount",
            by_identifier,
            "MT5 identifier-based resolution should track ambiguous matches explicitly",
        )
        self.assertRegex(
            by_identifier,
            re.compile(
                r"if\s*\(\s*matchedCount\s*>\s*1\s*\)\s*\{.*?return\s+0\s*;", re.S
            ),
            "MT5 identifier-based resolution should fail closed when multiple live positions match unexpectedly",
        )
        self.assertIn(
            "SelectedPositionMatches",
            unique_match,
            "MT5 unique-match fallback should still require exact symbol/magic/type matching",
        )
        self.assertRegex(
            unique_match,
            re.compile(
                r"if\s*\(\s*matchedCount\s*>\s*1\s*\)\s*\{.*?return\s+0\s*;", re.S
            ),
            "MT5 unique-match fallback should fail closed instead of picking an arbitrary same-symbol hedging position",
        )

    def test_startup_and_heartbeat_counts_filter_allowed_symbols(self):
        for label in self.sources:
            on_init = self.assert_function_exists(label, "OnInit")
            send_heartbeat = self.assert_function_exists(label, "SendHeartbeat")
            send_positions = self.assert_function_exists(label, "SendPositions")
            self.assertIn(
                "IsAllowedSymbol",
                on_init,
                f"{label} startup scan should filter allowed symbols",
            )
            self.assertIn(
                "IsAllowedSymbol",
                send_heartbeat,
                f"{label} heartbeat should filter allowed symbols",
            )
            self.assertIn(
                "IsAllowedSymbol",
                send_positions,
                f"{label} positions sync should filter allowed symbols",
            )

    def test_spread_tick_payload_uses_configured_leg_names(self):
        for label in self.sources:
            send_tick = self.assert_function_exists(label, "SendTick")
            self.assertIn(
                "SpreadSymbol1",
                send_tick,
                f"{label} spread tick payload should use SpreadSymbol1",
            )
            self.assertIn(
                "SpreadSymbol2",
                send_tick,
                f"{label} spread tick payload should use SpreadSymbol2",
            )
            self.assertNotRegex(
                send_tick,
                r"\bUKOIL\b",
                f"{label} spread tick payload should not hardcode UKOIL",
            )
            self.assertNotRegex(
                send_tick,
                r"\bUSOIL\b",
                f"{label} spread tick payload should not hardcode USOIL",
            )

    def test_mt4_uses_symbol_point_helper_for_tick_and_stop_math(self):
        mt4_source = self.sources["MT4"]
        self.assert_function_exists("MT4", "GetSymbolPoint")

        send_tick = self.assert_function_exists("MT4", "SendTick")
        execute_signal = self.assert_function_exists("MT4", "ExecuteSignal")

        self.assertRegex(
            send_tick,
            re.compile(r"Get(?:CurrentSpreadPoints|SymbolPoint)\(Symbol_\)"),
        )
        self.assertIn("GetSymbolPoint(Symbol_)", execute_signal)
        self.assertNotIn("/ Point", send_tick)
        self.assertNotIn("* Point", execute_signal)
        self.assertIn("GetSymbolPoint", mt4_source)

    def test_both_eas_share_explicit_spread_point_helper(self):
        for label in self.sources:
            helper = self.assert_function_exists(label, "GetCurrentSpreadPoints")
            check_risk = self.assert_function_exists(label, "CheckRisk")
            send_tick = self.assert_function_exists(label, "SendTick")

            self.assertIn(
                self.SPREAD_HELPERS[label],
                helper,
                f"{label} spread helper should start from native broker spread units",
            )
            self.assertRegex(
                helper,
                re.compile(r"currentSpread\s*=\s*\(ask\s*-\s*bid\)\s*/\s*point"),
                f"{label} spread helper should fall back to explicit point math",
            )
            self.assertNotRegex(
                helper,
                re.compile(r"/\s*10\.0"),
                f"{label} spread helper should not use the legacy /10.0 scaling",
            )
            self.assertIn(
                "GetCurrentSpreadPoints(Symbol_)",
                check_risk,
                f"{label} CheckRisk should rely on the shared spread helper",
            )
            self.assertIn(
                "GetCurrentSpreadPoints(Symbol_)",
                send_tick,
                f"{label} SendTick should rely on the shared spread helper",
            )

    def test_max_spread_parameter_uses_explicit_points_documentation(self):
        for label, source in self.sources.items():
            self.assertRegex(
                source,
                re.compile(r"MaxSpread\s*=\s*5\.0\s*;\s*//\s*最大点差（points）"),
                f"{label} MaxSpread should document broker-native point units explicitly",
            )
            self.assertNotRegex(
                source,
                re.compile(r"MaxSpread\s*=\s*5\.0\s*;\s*//.*美元"),
                f"{label} MaxSpread should no longer document spread as dollars",
            )

    def test_mt4_order_send_paths_normalize_volume_before_order_send(self):
        self.assert_function_exists("MT4", "NormalizeVolume")
        execute_open = self.assert_function_exists("MT4", "ExecuteOpen")
        execute_signal = self.assert_function_exists("MT4", "ExecuteSignal")

        self.assertRegex(
            execute_open,
            re.compile(
                r"lots\s*=\s*NormalizeVolume\(symbol,\s*lots\)\s*;.*?OrderSend\(symbol,\s*op_type,\s*lots",
                re.S,
            ),
            "MT4 spread order placement should normalize lots before OrderSend",
        )
        self.assertRegex(
            execute_signal,
            re.compile(
                r"lots\s*=\s*NormalizeVolume\(Symbol_,\s*lots\)\s*;.*?OrderSend\(Symbol_,\s*op_type,\s*lots",
                re.S,
            ),
            "MT4 signal order placement should normalize lots before OrderSend",
        )

    def test_mt4_execute_close_all_uses_reverse_iteration(self):
        execute_close_all = self.assert_function_exists("MT4", "ExecuteCloseAll")
        self.assertRegex(
            execute_close_all,
            re.compile(
                r"for\s*\(\s*int\s+i\s*=\s*OrdersTotal\(\)\s*-\s*1\s*;\s*i\s*>=\s*0\s*;\s*i--\s*\)"
            ),
            "MT4 close all should iterate backwards while closing orders",
        )

    def test_mt4_http_post_separates_request_and_response_headers(self):
        http_post = self.assert_function_exists("MT4", "HttpPost")
        self.assertIn(
            "string request_headers",
            http_post,
            "MT4 HttpPost should keep request headers in a dedicated variable",
        )
        self.assertIn(
            "string response_headers",
            http_post,
            "MT4 HttpPost should keep response headers separate across retries",
        )
        self.assertRegex(
            http_post,
            re.compile(
                r'WebRequest\("POST",\s*url,\s*request_headers,\s*timeout,\s*post_data,\s*result_data,\s*response_headers\)'
            ),
            "MT4 HttpPost should not reuse the same headers variable for request and response",
        )
        self.assertNotIn(
            'WebRequest("POST", url, headers, timeout, post_data, result_data, headers)',
            http_post,
            "MT4 HttpPost should avoid request/response header reuse",
        )


if __name__ == "__main__":
    unittest.main()

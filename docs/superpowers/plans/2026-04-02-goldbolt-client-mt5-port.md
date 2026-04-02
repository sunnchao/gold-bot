# GoldBolt Client MT5 Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a MT5-compatible `GoldBolt_Client.mq5` that preserves the existing MQ4 EA behavior and server protocol.

**Architecture:** Keep the original EA structure and JSON protocol intact, and replace MT4-only trading/account/market APIs with MQL5 equivalents. Use `CTrade` for open/close/modify operations, while keeping string-based JSON parsing and the existing polling/heartbeat/bars workflow unchanged.

**Tech Stack:** MQL5, MetaTrader 5 `CTrade`, Python verification script

---

## File Structure

- Create: `mt5_ea/GoldBolt_Client.mq5` — MT5 EA port of the existing MQ4 client
- Create: `tests/verify_goldbolt_client_mt5_port.py` — lightweight verification for the generated MT5 file
- Create: `docs/superpowers/plans/2026-04-02-goldbolt-client-mt5-port.md` — this plan

### Task 1: Add the failing verification

**Files:**
- Create: `tests/verify_goldbolt_client_mt5_port.py`
- Test: `tests/verify_goldbolt_client_mt5_port.py`

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path

TARGET = Path("mt5_ea/GoldBolt_Client.mq5")


def main() -> int:
    assert TARGET.exists(), f"missing file: {TARGET}"
    text = TARGET.read_text(encoding="utf-8")

    required = [
        "#include <Trade/Trade.mqh>",
        "CTrade trade;",
        "bool RegisterAccount()",
        "PositionsTotal()",
        "PositionGetInteger(POSITION_MAGIC)",
        "SymbolInfoDouble(Symbol_, SYMBOL_BID)",
        "trade.Buy(",
        "trade.Sell(",
    ]
    forbidden = [
        "OrderSend(",
        "OrderClose(",
        "OrderModify(",
        "OrdersTotal(",
        "OrderSelect(",
        "MarketInfo(",
        "OP_BUY",
        "OP_SELL",
        "extern ",
    ]

    for item in required:
        assert item in text, f"required pattern missing: {item}"
    for item in forbidden:
        assert item not in text, f"forbidden pattern present: {item}"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 tests/verify_goldbolt_client_mt5_port.py`
Expected: FAIL with `missing file: mt5_ea/GoldBolt_Client.mq5`

### Task 2: Port the EA to MQL5

**Files:**
- Create: `mt5_ea/GoldBolt_Client.mq5`
- Modify: `mt4_ea/GoldBolt_Client.mq4` (reference only, no edit)
- Test: `tests/verify_goldbolt_client_mt5_port.py`

- [ ] **Step 1: Add the MT5 EA header and inputs**

```mql5
#property copyright "Gold Bolt"
#property version   "2.8"
#property strict

#include <Trade/Trade.mqh>

#define EA_VERSION  "2.8.0"
#define EA_BUILD    6

CTrade trade;
```

- [ ] **Step 2: Port account, market, and symbol APIs to MQL5**

```mql5
double bid = SymbolInfoDouble(Symbol_, SYMBOL_BID);
double ask = SymbolInfoDouble(Symbol_, SYMBOL_ASK);
double point = SymbolInfoDouble(Symbol_, SYMBOL_POINT);
double balance = AccountInfoDouble(ACCOUNT_BALANCE);
double equity = AccountInfoDouble(ACCOUNT_EQUITY);
long leverage = AccountInfoInteger(ACCOUNT_LEVERAGE);
```

- [ ] **Step 3: Port trading operations to `CTrade`**

```mql5
trade.SetExpertMagicNumber(magicForOrder);
trade.SetDeviationInPoints(Slippage);
bool result = (type_str == "BUY")
   ? trade.Buy(lots, Symbol_, ask, sl, tp1, comment)
   : trade.Sell(lots, Symbol_, bid, sl, tp1, comment);
```

- [ ] **Step 4: Port order scans to MT5 position scans**

```mql5
for(int i = PositionsTotal() - 1; i >= 0; i--)
{
   string position_symbol = PositionGetSymbol(i);
   if(position_symbol == "")
      continue;

   long magic = PositionGetInteger(POSITION_MAGIC);
   double volume = PositionGetDouble(POSITION_VOLUME);
}
```

- [ ] **Step 5: Keep protocol and JSON logic unchanged**

```mql5
string json = StringFormat(
   "{\"account_id\":\"%s\",\"symbol\":\"%s\",\"magic\":%d}",
   AccountID, Symbol_, PullbackMagic
);
string response = HttpPost("/poll", json);
```

### Task 3: Verify the generated file

**Files:**
- Test: `tests/verify_goldbolt_client_mt5_port.py`
- Test: `mt5_ea/GoldBolt_Client.mq5`

- [ ] **Step 1: Run the verification script**

Run: `python3 tests/verify_goldbolt_client_mt5_port.py`
Expected: PASS with exit code 0 and no output

- [ ] **Step 2: Spot-check the port for MT5-only APIs**

Run: `python3 - <<'PY'
from pathlib import Path
text = Path('mt5_ea/GoldBolt_Client.mq5').read_text(encoding='utf-8')
forbidden = ['OrderSend(', 'OrderClose(', 'OrderModify(', 'OrdersTotal(', 'OrderSelect(', 'MarketInfo(', 'OP_BUY', 'OP_SELL', 'extern ']
bad = [item for item in forbidden if item in text]
print(bad)
raise SystemExit(1 if bad else 0)
PY`
Expected: `[]`

- [ ] **Step 3: Manual compile in MetaEditor**

Run in MT5 MetaEditor: compile `mt5_ea/GoldBolt_Client.mq5`
Expected: no syntax errors; warnings reviewed separately

Note: no git commit in this plan because commit was not requested.

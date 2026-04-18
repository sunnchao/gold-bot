package contracts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMT4MomentumScalpHooksPresent(t *testing.T) {
	assertEAContainsAll(t, filepath.Join("..", "..", "mt4_ea", "GoldBolt_Client.mq4"), []string{
		`extern bool     EnableMomentumScalp`,
		`extern int      MomentumScalpMagic`,
		`extern bool     MomentumScalpUseFixedLots`,
		`extern double   MomentumScalpFixedLots`,
		`extern double   MomentumScalpRiskPercent`,
		`if(strategy == "momentum_scalp") return MomentumScalpMagic;`,
		`if(strategy == "momentum_scalp") return EnableMomentumScalp;`,
		`CalcLotsForStrategy(strategy, sl_distance)`,
		`\"strategy_mapping\":{`,
		`\"momentum_scalp\":\"momentum_scalp\"`,
	})
}

func TestMT5MomentumScalpHooksPresent(t *testing.T) {
	assertEAContainsAll(t, filepath.Join("..", "..", "mt5_ea", "GoldBolt_Client.mq5"), []string{
		`input bool     EnableMomentumScalp`,
		`input int      MomentumScalpMagic`,
		`input bool     MomentumScalpUseFixedLots`,
		`input double   MomentumScalpFixedLots`,
		`input double   MomentumScalpRiskPercent`,
		`if(strategy == "momentum_scalp") return MomentumScalpMagic;`,
		`if(strategy == "momentum_scalp") return EnableMomentumScalp;`,
		`CalcLotsForStrategy(strategy, sl_distance)`,
		`\"strategy_mapping\":{`,
		`\"momentum_scalp\":\"momentum_scalp\"`,
	})
}

func TestMT4HeartbeatPayloadContainsMarketStatusFields(t *testing.T) {
	assertEAContainsAll(t, filepath.Join("..", "..", "mt4_ea", "GoldBolt_Client.mq4"), []string{
		`string serverTime = TimeToStr(TimeCurrent(), TIME_DATE|TIME_MINUTES);`,
		`bool isTradeAllowed = IsTradeAllowed();`,
		`bool marketOpen = (MarketInfo(Symbol_, MODE_TRADEALLOWED) != 0);`,
		`\"server_time\":\"%s\",`,
		`\"market_open\":%s,`,
		`\"is_trade_allowed\":%s,`,
	})
}

func TestMT5HeartbeatPayloadContainsMarketStatusFields(t *testing.T) {
	assertEAContainsAll(t, filepath.Join("..", "..", "mt5_ea", "GoldBolt_Client.mq5"), []string{
		`string serverTime = TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES);`,
		`bool isTradeAllowed = (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0);`,
		`bool marketOpen = ((ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(Symbol_, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_DISABLED);`,
		`\"server_time\":\"%s\",`,
		`\"market_open\":%s,`,
		`\"is_trade_allowed\":%s,`,
	})
}

func assertEAContainsAll(t *testing.T, path string, needles []string) {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) returned error: %v", path, err)
	}

	text := string(data)
	for _, needle := range needles {
		if !strings.Contains(text, needle) {
			t.Fatalf("%s missing expected snippet: %s", path, needle)
		}
	}
}

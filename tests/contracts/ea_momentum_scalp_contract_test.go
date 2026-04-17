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

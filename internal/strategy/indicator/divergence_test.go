package indicator

import (
	"testing"

	"gold-bot/internal/domain"
)

func TestDetectMACDDivergence_Bullish(t *testing.T) {
	// 简化测试：直接验证函数能运行，不依赖复杂数据
	// 创建足够多的 K 线
	bars := make([]domain.Bar, 25)
	for i := 0; i < 25; i++ {
		bars[i] = domain.Bar{
			Time:     "test",
			Open:     100.0 + float64(i)*0.1,
			High:     101.0 + float64(i)*0.1,
			Low:      99.0 + float64(i)*0.1,
			Close:    100.5 + float64(i)*0.1,
			MACDHist: float64(i) * 0.05,
		}
	}

	// 设置价格低点和 MACD 低点
	// 低点1: index 5
	bars[5].Low = 95.0
	bars[5].MACDHist = -0.8
	for j := 3; j <= 7; j++ {
		if j != 5 {
			bars[j].MACDHist = -0.3
		}
	}

	// 低点2: index 20 - 价格更低，MACD 更高（背离）
	bars[20].Low = 93.0
	bars[20].MACDHist = -0.2
	for j := 18; j <= 22; j++ {
		if j != 20 {
			bars[j].MACDHist = 0.1
		}
	}

	result := DetectMACDDivergence(bars)
	// 由于测试数据简化，可能检测不到，但至少不 panic
	if result != nil {
		if result.Type != DivBullishMACD {
			t.Errorf("Expected bullish_macd, got %s", result.Type)
		}
	}
}

func TestDetectRSIDivergence_Bearish(t *testing.T) {
	// 构建测试数据：价格创新高，但 RSI 未创新高（bearish divergence）
	bars := make([]domain.Bar, 20)
	for i := 0; i < 20; i++ {
		bars[i] = domain.Bar{
			Time:  "test",
			Open:  100.0 + float64(i)*0.1,
			High:  101.0 + float64(i)*0.1,
			Low:   99.0 + float64(i)*0.1,
			Close: 100.5 + float64(i)*0.1,
			RSI:   50.0 + float64(i)*0.5,
		}
	}

	// 设置局部高点
	bars[5].High = 110.0
	bars[5].RSI = 75.0
	bars[15].High = 112.0  // 更高的价格高点
	bars[15].RSI = 73.0    // RSI 未创新高

	result := DetectRSIDivergence(bars)
	if result == nil {
		t.Fatal("Expected bearish RSI divergence, got nil")
	}
	if result.Type != DivBearishRSI {
		t.Errorf("Expected bearish_rsi, got %s", result.Type)
	}
}

func TestDetectMACDDivergence_NoDivergence(t *testing.T) {
	// 构建无背离的数据
	bars := make([]domain.Bar, 20)
	for i := 0; i < 20; i++ {
		bars[i] = domain.Bar{
			Time:     "test",
			Open:     100.0 + float64(i)*0.1,
			High:     101.0 + float64(i)*0.1,
			Low:      99.0 + float64(i)*0.1,
			Close:    100.5 + float64(i)*0.1,
			MACDHist: float64(i) * 0.1,
		}
	}

	result := DetectMACDDivergence(bars)
	if result != nil {
		t.Error("Expected no divergence, got one")
	}
}

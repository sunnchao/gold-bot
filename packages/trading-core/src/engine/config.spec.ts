import { describe, it, expect } from 'vitest';
import {
  defaultStrategyConfig,
  defaultTrendConfig,
  getStrategyConfigBySymbol,
  goldStrategyConfig,
  silverStrategyConfig,
  gbpjpyStrategyConfig,
  jpyCrossStrategyConfig,
  eurusdStrategyConfig,
  gbpusdStrategyConfig,
  usdcadStrategyConfig,
  us100CashStrategyConfig,
  oilStrategyConfig,
} from './config.js';

describe('defaultStrategyConfig', () => {
  it('returns valid config with all fields', () => {
    const cfg = defaultStrategyConfig();
    expect(cfg.pullbackMinADX).toBe(25.0);
    expect(cfg.minScore).toBe(5);
    expect(cfg.scaleInEnabled).toBe(true);
    expect(cfg.momentumScalpMinADX).toBe(20.0);
    expect(cfg.fibExtension.enabled).toBe(false);
    expect(cfg.pullbackFib.retracementEnabled).toBe(false);
    expect(cfg.trend.enabled).toBe(true);
  });
});

describe('defaultTrendConfig', () => {
  it('returns valid trend config', () => {
    const tc = defaultTrendConfig();
    expect(tc.d1Weight).toBe(0.05);
    expect(tc.h4Weight).toBe(0.25);
    expect(tc.h1Weight).toBe(0.35);
    expect(tc.m30Weight).toBe(0.35);
    expect(tc.enabled).toBe(true);
  });
});

describe('per-symbol configs', () => {
  it('gold config has correct overrides', () => {
    const cfg = goldStrategyConfig();
    expect(cfg.momentumScalpMinADX).toBe(18.0);
    expect(cfg.pullbackFib.retracementEnabled).toBe(true);
  });

  it('silver config has wider SL/TP', () => {
    const cfg = silverStrategyConfig();
    expect(cfg.pullbackSLATR).toBe(2.0);
    expect(cfg.pullbackTP1ATR).toBe(3.0);
    expect(cfg.h4ADXThreshold).toBe(22);
  });

  it('GBPJPY config has lower ADX thresholds', () => {
    const cfg = gbpjpyStrategyConfig();
    expect(cfg.h4ADXThreshold).toBe(22.0);
    expect(cfg.h4RequireConsecutive).toBe(2);
    expect(cfg.pullbackSLATR).toBe(1.8);
    expect(cfg.momentumScalpSLATR).toBe(0.8);
  });

  it('JPY cross inherits GBPJPY config', () => {
    const jpy = jpyCrossStrategyConfig();
    const gbpjpy = gbpjpyStrategyConfig();
    expect(jpy.h4ADXThreshold).toBe(gbpjpy.h4ADXThreshold);
    expect(jpy.pullbackSLATR).toBe(gbpjpy.pullbackSLATR);
  });

  it('EURUSD config has tighter SL', () => {
    const cfg = eurusdStrategyConfig();
    expect(cfg.h4ADXThreshold).toBe(20.0);
    expect(cfg.pullbackSLATR).toBe(1.0);
  });

  it('GBPUSD config is between EURUSD and GBPJPY', () => {
    const cfg = gbpusdStrategyConfig();
    expect(cfg.h4ADXThreshold).toBe(22.0);
    expect(cfg.pullbackSLATR).toBe(1.3);
  });

  it('USDCAD config has moderate parameters', () => {
    const cfg = usdcadStrategyConfig();
    expect(cfg.h4ADXThreshold).toBe(25.0);
    expect(cfg.pullbackSLATR).toBe(1.2);
  });

  it('US100CASH config has index-specific tuning', () => {
    const cfg = us100CashStrategyConfig();
    expect(cfg.h4RequireConsecutive).toBe(3);
    expect(cfg.pullbackSLATR).toBe(1.0);
    expect(cfg.momentumScalpMaxHoldingMin).toBe(60);
    expect(cfg.trend.h4Weight).toBe(0.35);
  });

  it('Oil config has wide SL/TP', () => {
    const cfg = oilStrategyConfig();
    expect(cfg.pullbackSLATR).toBe(2.0);
    expect(cfg.pullbackTP1ATR).toBe(2.5);
    expect(cfg.pullbackFib.retracementEnabled).toBe(true);
  });
});

describe('getStrategyConfigBySymbol', () => {
  it('returns correct config for known symbols', () => {
    expect(getStrategyConfigBySymbol('XAUUSD').pullbackFib.retracementEnabled).toBe(true);
    expect(getStrategyConfigBySymbol('GOLD').pullbackFib.retracementEnabled).toBe(true);
    expect(getStrategyConfigBySymbol('XAGUSD').pullbackSLATR).toBe(2.0);
    expect(getStrategyConfigBySymbol('SILVER').pullbackSLATR).toBe(2.0);
    expect(getStrategyConfigBySymbol('GBPJPY').h4ADXThreshold).toBe(22.0);
    expect(getStrategyConfigBySymbol('EURJPY').h4ADXThreshold).toBe(22.0);
    expect(getStrategyConfigBySymbol('USDJPY').h4ADXThreshold).toBe(22.0);
    expect(getStrategyConfigBySymbol('EURUSD').pullbackSLATR).toBe(1.0);
    expect(getStrategyConfigBySymbol('GBPUSD').pullbackSLATR).toBe(1.3);
    expect(getStrategyConfigBySymbol('USDCAD').pullbackSLATR).toBe(1.2);
    expect(getStrategyConfigBySymbol('US100CASH').h4RequireConsecutive).toBe(3);
    expect(getStrategyConfigBySymbol('USOILCASH').pullbackSLATR).toBe(2.0);
    expect(getStrategyConfigBySymbol('UKOILCASH').pullbackSLATR).toBe(2.0);
  });

  it('returns default config for unknown symbols', () => {
    const cfg = getStrategyConfigBySymbol('UNKNOWN');
    const def = defaultStrategyConfig();
    expect(cfg.pullbackMinADX).toBe(def.pullbackMinADX);
    expect(cfg.minScore).toBe(def.minScore);
  });
});

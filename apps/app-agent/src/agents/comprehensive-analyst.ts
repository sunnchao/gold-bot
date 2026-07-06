import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { ComprehensiveAnalysisResult } from '../types/comprehensive.js';
import type { ChanlunAnalysis, ChanlunBar, ElliottWaveAnalysis, TechnicalAnalysis, WaveAnalystResult, ChanlunAnalystResult, HarmonicAnalysisResult, RiskAssessment, DowTheoryAnalysis, WaveTheoryAnalysis, ChanlunTheoryAnalysis, HarmonicTheoryAnalysis, TradeRecommendation, ArbitrationResult } from '../types/analysis.js';
import type { GoldbotBar, GoldbotPayload, PendingSignal } from '../types/goldbot.js';
import { validateArbitrationResult, validateTradeRecommendation } from '../utils/price-validator.js';
import { getSymbolProfile, detectCrossInstrumentPrice, type SymbolProfile } from '../config/symbol-profile.js';
import { analyzeChanlun } from '../tools/chanlun-core.js';
import { analyzeElliottWave } from '../tools/elliott-wave.js';
import { LlmClientService } from '../tools/llm-client.js';
import {
  ArbitrationResultSchema,
  ChanlunAnalystResultSchema,
  ComprehensiveAnalysisDataSchema,
  RiskAssessmentSchema,
  TechnicalAnalysisSchema,
  WaveAnalystResultSchema,
} from '../types/schemas.js';
import { selectIndicator } from '../utils/goldbot-indicators.js';
import { getLogger } from '../utils/logger.js';
import { safeParseResponse } from '../utils/parse.js';
import {
  splitSections,
  extractFields,
  extractListItems,
  getEnumField,
  getNumberField,
  getBooleanField,
  getStringField,
  parseSRLevels,
  extractWarnings,
  detectFormat,
} from '../utils/markdown-parser.js';
import { stableStringify } from '../utils/stable-stringify.js';

type PriceLike = number | null | undefined;

interface PayloadPricePoint {
  close?: PriceLike;
  price?: PriceLike;
  bid?: PriceLike;
  ask?: PriceLike;
}

interface PayloadCandleLike {
  open?: PriceLike;
  high?: PriceLike;
  low?: PriceLike;
  close?: PriceLike;
}

const PREFERRED_BAR_TIMEFRAMES = ['H1', 'M30', 'M15', 'H4'] as const;

function schemaShapeToJson(shape: z.ZodRawShape): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(shape)) {
    if ('_def' in value && value._def && typeof value._def === 'object') {
      if ('shape' in value._def && typeof value._def.shape === 'function') {
        json[key] = schemaShapeToJson(value._def.shape());
        continue;
      }
      if ('values' in value._def && Array.isArray(value._def.values)) {
        json[key] = value._def.values;
        continue;
      }
      if ('typeName' in value._def) {
        json[key] = value._def.typeName;
        continue;
      }
    }
    json[key] = 'schema-defined';
  }
  return json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function averageBidAsk(entry: PayloadPricePoint): number | undefined {
  const bid = toFiniteNumber(entry.bid);
  const ask = toFiniteNumber(entry.ask);
  if (bid != null && ask != null) {
    return (bid + ask) / 2;
  }
  return bid ?? ask;
}

function getPayloadBars(
  payload: GoldbotPayload,
  timeframe: (typeof PREFERRED_BAR_TIMEFRAMES)[number],
): GoldbotBar[] {
  if (!payload.bars) {
    return [];
  }

  const exact = payload.bars[timeframe];
  if (Array.isArray(exact)) {
    return exact;
  }

  const matchingKey = Object.keys(payload.bars).find(
    (key) => key.toUpperCase() === timeframe,
  );
  const matched = matchingKey ? payload.bars[matchingKey] : undefined;
  return Array.isArray(matched) ? matched : [];
}

function extractPreferredBarCloses(
  payload: GoldbotPayload,
  minCount: number,
  closedOnly = false,
): number[] {
  for (const timeframe of PREFERRED_BAR_TIMEFRAMES) {
    const bars = getPayloadBars(payload, timeframe);
    const sourceBars = closedOnly ? bars.slice(0, -1) : bars;
    const closes = sourceBars
      .map((bar) => toFiniteNumber(bar.close))
      .filter((value): value is number => value != null);

    if (closes.length >= minCount) {
      return closes;
    }
  }

  return [];
}

function extractPreferredChanlunBars(
  payload: GoldbotPayload,
  minCount: number,
  closedOnly = false,
): ChanlunBar[] {
  for (const timeframe of PREFERRED_BAR_TIMEFRAMES) {
    const sourceBars = closedOnly
      ? getPayloadBars(payload, timeframe).slice(0, -1)
      : getPayloadBars(payload, timeframe);
    const bars = sourceBars
      .map((bar, index) => {
        const open = toFiniteNumber(bar.open);
        const high = toFiniteNumber(bar.high);
        const low = toFiniteNumber(bar.low);
        const close = toFiniteNumber(bar.close);

        if (open == null || high == null || low == null || close == null) {
          return undefined;
        }

        return {
          index,
          open,
          high,
          low,
          close,
        } satisfies ChanlunBar;
      })
      .filter((bar): bar is ChanlunBar => bar != null);

    if (bars.length >= minCount) {
      return bars;
    }
  }

  return [];
}

function extractRuntimeCandles(payload: GoldbotPayload): PayloadCandleLike[] {
  const runtimePayload = payload as GoldbotPayload & {
    candles?: unknown;
    market_data?: { candles?: unknown };
  };

  const direct = runtimePayload.candles;
  if (Array.isArray(direct)) {
    return direct.filter(isRecord) as PayloadCandleLike[];
  }

  const nested = runtimePayload.market_data?.candles;
  if (Array.isArray(nested)) {
    return nested.filter(isRecord) as PayloadCandleLike[];
  }

  return [];
}

function extractRuntimePrices(payload: GoldbotPayload): number[] {
  const runtimePayload = payload as GoldbotPayload & {
    prices?: unknown;
    market_data?: { prices?: unknown };
  };
  const rawPrices = Array.isArray(runtimePayload.prices)
    ? runtimePayload.prices
    : Array.isArray(runtimePayload.market_data?.prices)
      ? runtimePayload.market_data.prices
      : [];

  return rawPrices
    .map((entry) => {
      if (typeof entry === 'number') {
        return Number.isFinite(entry) ? entry : undefined;
      }
      if (!isRecord(entry)) {
        return undefined;
      }
      return (
        toFiniteNumber(entry.close) ??
        toFiniteNumber(entry.price) ??
        averageBidAsk(entry as PayloadPricePoint)
      );
    })
    .filter((value): value is number => value != null);
}

function extractWavePrices(payload: GoldbotPayload): number[] {
  const payloadBarPrices = extractPreferredBarCloses(payload, 2);
  if (payloadBarPrices.length > 0) {
    return payloadBarPrices;
  }

  const candlePrices = extractRuntimeCandles(payload)
    .map((candle) => toFiniteNumber(candle.close))
    .filter((value): value is number => value != null);

  if (candlePrices.length > 0) {
    return candlePrices;
  }

  const prices = extractRuntimePrices(payload);
  if (prices.length > 0) {
    return prices;
  }

  const fallbackPrice = payload.market.bid || payload.market.ask;
  return typeof fallbackPrice === 'number' && Number.isFinite(fallbackPrice)
    ? [fallbackPrice]
    : [];
}

function extractWaveClosedBarPrices(payload: GoldbotPayload): number[] {
  return extractPreferredBarCloses(payload, 2, true);
}

function extractChanlunBars(payload: GoldbotPayload): ChanlunBar[] {
  const payloadBars = extractPreferredChanlunBars(payload, 3);
  if (payloadBars.length > 0) {
    return payloadBars;
  }

  return extractRuntimeCandles(payload)
    .map((candle, index) => {
      const open = toFiniteNumber(candle.open);
      const high = toFiniteNumber(candle.high);
      const low = toFiniteNumber(candle.low);
      const close = toFiniteNumber(candle.close);

      if (open == null || high == null || low == null || close == null) {
        return undefined;
      }

      return {
        index,
        open,
        high,
        low,
        close,
      } satisfies ChanlunBar;
    })
    .filter((bar): bar is ChanlunBar => bar != null);
}

function extractClosedChanlunBars(payload: GoldbotPayload): ChanlunBar[] {
  return extractPreferredChanlunBars(payload, 3, true);
}

function summarizeCandlestickPatterns(payload: GoldbotPayload): Record<string, string[]> {
  const summary: Record<string, string[]> = {};

  for (const timeframe of PREFERRED_BAR_TIMEFRAMES) {
    const recentPatterns = getPayloadBars(payload, timeframe)
      .slice(0, -1)
      .slice(-20)
      .flatMap((bar) => bar.candlestick_patterns ?? [])
      .filter((pattern): pattern is string => typeof pattern === 'string' && pattern.length > 0);

    if (recentPatterns.length > 0) {
      summary[timeframe] = Array.from(new Set(recentPatterns));
    }
  }

  return summary;
}

function stableHash(parts: unknown[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(stableStringify(part));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function sanitizeHarmonicPattern(pattern: unknown): Record<string, unknown> | undefined {
  if (!isRecord(pattern)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  const allowedKeys = [
    'type',
    'direction',
    'timeframe',
    'score',
    'x_price',
    'a_price',
    'b_price',
    'c_price',
    'd_price',
    'ab_ratio',
    'bc_ratio',
    'cd_ratio',
    'xd_ratio',
    'completion_pct',
    'reason',
  ];

  for (const key of allowedKeys) {
    if (pattern[key] !== undefined) {
      sanitized[key] = pattern[key];
    }
  }

  return sanitized;
}

function sanitizeHarmonicContext(payload: GoldbotPayload): Record<string, unknown> | null {
  const harmonicContext = payload.harmonic_context;
  if (!harmonicContext) {
    return null;
  }

  return {
    h4_patterns: harmonicContext.h4_patterns.map(sanitizeHarmonicPattern).filter(Boolean),
    h1_patterns: harmonicContext.h1_patterns.map(sanitizeHarmonicPattern).filter(Boolean),
    m30_patterns: harmonicContext.m30_patterns.map(sanitizeHarmonicPattern).filter(Boolean),
    active_pattern: sanitizeHarmonicPattern(harmonicContext.active_pattern) ?? null,
    direction_bias: harmonicContext.direction_bias,
    score: harmonicContext.score,
    summary: harmonicContext.summary,
  };
}

interface StructureCacheEntry {
  hash: string;
  staticContextText: string;
  timestamp: number;
}

function buildUnavailableWaveStructure(): ElliottWaveAnalysis {
  return {
    direction: 'bullish',
    swingPoints: [],
    impulseWaves: [],
    correctiveWaves: [],
    validation: {
      isValid: false,
      violations: ['Insufficient closed bars for stable Elliott Wave analysis.'],
    },
    confidence: 0,
  };
}

function buildUnavailableChanlunStructure(): ChanlunAnalysis {
  return {
    processedBars: [],
    fractals: [],
    strokes: [],
    hubs: [],
  };
}

class StructureCache {
  private readonly cache = new Map<string, StructureCacheEntry>();

  getOrBuild(symbol: string, payload: GoldbotPayload): string {
    const wavePrices = extractWaveClosedBarPrices(payload);
    const chanlunBars = extractClosedChanlunBars(payload);
    const waveStructure =
      wavePrices.length >= 2 ? analyzeElliottWave(wavePrices) : buildUnavailableWaveStructure();
    const chanlunStructure =
      chanlunBars.length >= 3 ? analyzeChanlun(chanlunBars) : buildUnavailableChanlunStructure();
    const candlestickPatterns = summarizeCandlestickPatterns(payload);
    const harmonicCtx = sanitizeHarmonicContext(payload);
    const hash = stableHash([waveStructure, chanlunStructure, candlestickPatterns, harmonicCtx ?? 'none']);
    const cached = this.cache.get(symbol);

    if (cached?.hash === hash) {
      return cached.staticContextText;
    }

    const staticContextText = renderStaticContextPrompt(
      waveStructure,
      chanlunStructure,
      candlestickPatterns,
      harmonicCtx,
    );
    this.cache.set(symbol, {
      hash,
      staticContextText,
      timestamp: Date.now(),
    });

    return staticContextText;
  }
}

/**
 * Normalize enum values that the LLM commonly confuses between the two
 * Chanlun schemas. Applied AFTER Zod validation, so we map known-misunderstood
 * values to the correct simple enum for the top-level chanlun key.
 */
function normalizeComprehensive(result: ComprehensiveAnalysisResult): ComprehensiveAnalysisResult {
  const c = result.chanlun;

  // hub_state: LLM sometimes outputs arbitration-style values
  if (c.hub_state === 'breaking_up' as any || c.hub_state === 'breaking_down' as any) {
    (c as any).hub_state = 'active';
  }

  // latest_signal: LLM sometimes outputs arbitration-style buy/sell point values
  if (['buy_1', 'buy_2', 'buy_3'].includes(c.latest_signal as string)) {
    (c as any).latest_signal = 'buy';
  } else if (['sell_1', 'sell_2', 'sell_3'].includes(c.latest_signal as string)) {
    (c as any).latest_signal = 'sell';
  } else if (c.latest_signal === 'close' as any) {
    (c as any).latest_signal = 'sell';
  }

  return result;
}

function buildCommonSystemPrompt(): string {
  return `You are a comprehensive market analysis orchestrator.
Produce a structured MARKDOWN analysis with exactly these 6 sections:
- ## TECHNICAL
- ## WAVE
- ## CHANLUN
- ## HARMONIC
- ## RISK
- ## ARBITRATION

ALL 6 sections are REQUIRED on every response. Do not omit any section.

## CRITICAL RULES
1. Output structured MARKDOWN text using ## SECTION headers and - Key: Value format.
2. NEVER wrap output in \`\`\`code blocks\`\`\`. Do NOT output JSON.
3. The output MUST include ALL 6 sections: TECHNICAL, WAVE, CHANLUN, HARMONIC, RISK, ARBITRATION.
4. All enum values must be EXACTLY as specified (lowercase).
5. All numeric fields must be valid finite numbers.
6. **ABSOLUTE PRICE RULE: All SL/TP fields (Suggested SL, Suggested TP, Stop Loss, Take Profit, Trade Stop Loss, Trade Take Profit) MUST be absolute price levels visible on the chart — NOT relative offsets, NOT point distances, NOT ATR values, NOT pip counts.** A stop loss for a buy should be BELOW the current price; a take profit should be ABOVE. These numbers should be in the same order of magnitude as the current price shown above.
7. Support/Resistance levels use pipe-delimited format: price | type | strength | timeframe | touches
8. All prices must fit the instrument's range described in SYMBOL CHARACTERISTICS.
9. For bilingual text fields: Chinese first, English in parentheses.

## DUAL-DIRECTION TRADING (双向下单)

When the market is in a clear ranging/consolidation phase (technical.phase is "ranging" or "consolidation"), AND both BUY and SELL directions have valid setups with confidence ≥ 60, you MAY output a dual-direction recommendation.

Dual-direction conditions:
- technical.phase is "ranging" or "consolidation"
- support_levels and resistance_levels both have strong levels
- wave.wave_confirmation is "rejected" or "partial"
- chanlun.hub_state is "forming"
- risk.riskLevel is NOT "high" or "extreme"
- No critical blocking market filters

When dual-direction is triggered:
- arbitration.action = "open"
- arbitration.final_direction = "dual"
- trade_recommendation.direction = "dual"

## IMPORTANT: Two Different "Chanlun" Sections
- "CHANLUN" (top-level section) = SIMPLE Chanlun analysis. Use SIMPLE enums:
  - hub_state: ONLY "forming" | "active" | "none" (no breaking_up/breaking_down)
  - latest_signal: ONLY "buy" | "sell" | "hold" (no buy_1/sell_1/close)
- "Chanlun Theory" (inside ARBITRATION section) = DETAILED Chanlun theory. Uses RICH enums:
  - zhongshu_state: "forming" | "active" | "breaking_up" | "breaking_down" | "none"
  - buy_sell_point: "buy_1" | "buy_2" | "buy_3" | "sell_1" | "sell_2" | "sell_3" | "none"
Do NOT mix these up. Keep them separate.

## REQUIRED OUTPUT MARKDOWN FORMAT

## TECHNICAL
- Bias: bullish | bearish | neutral
- Confidence: <0-100>
- Phase: trending | ranging | breakout | reversal | consolidation
- Indicators Summary: <bilingual string>
- Support Levels:
  - <price> | support | strong|moderate|weak | <timeframe e.g. H1> | <touches 1-10>
- Resistance Levels:
  - <price> | resistance | strong|moderate|weak | <timeframe e.g. H4> | <touches 1-10>
- Recommendation: hold | close | partial_close | trail_stop | none
- Rationale: <bilingual string>

## WAVE
- Confirmation: confirmed | partial | rejected
- Extension Wave: 1 | 3 | 5
- Corrective Type: zigzag | flat | triangle
- Trend Strength: strong | moderate | weak
- Target Level 1.618: <number>
- Target Level 2.0: <number>
- Confidence: <0-100>
- Rationale: <bilingual string>

## CHANLUN
- Trend: up | down | range
- Strength: strong | moderate | weak
- Latest Signal: buy | sell | hold
- Hub State: forming | active | none
- Confidence: <0-100>
- Rationale: <bilingual string>

## HARMONIC
- Detected Pattern: gartley | bat | butterfly | crab | abcd | cypher | shark | none
- Direction: bullish | bearish | neutral
- Timeframe: <H4 | H1 | M30 or "N/A" if none>
- Completion: <0-100%>
- Confidence: <0-100>
- D Zone Price: <number or 0 if none>
- Entry Zone: <price range string or "N/A">
- Stop Loss: <absolute stop loss price level or 0 if none>
- Take Profit 1: <absolute take profit price level or 0 if none>
- Take Profit 2: <absolute take profit price level or 0 if none>
- Rationale: <bilingual string>

## RISK
- Risk Level: low | medium | high | extreme
- Max Position Size: <number lots>
- Suggested SL: <absolute stop loss price level>
- Suggested TP: <absolute take profit price level>
- Warnings: <semicolon-separated bilingual strings>
- Add On: true | false

## ARBITRATION
- Final Direction: buy | sell | hold | close | dual
- Confidence: <0-100>
- Action: open | close | modify | hold
- Primary Contradiction: <string or empty>
- Phase: <string>
- United Front Analysis: <bilingual string>
- Reasoning: <bilingual string, at least 3 sentences covering all 3 theories>
- Dow Primary Trend: bullish | bearish | neutral
- Dow Primary Phase: accumulation | markup | distribution | markdown
- Dow Secondary Trend: bullish | bearish | neutral
- Dow Short Term Trend: bullish | bearish | neutral
- Dow Multi TF Confirm: true | false
- Dow Rationale: <string>
- Wave Current Wave: <string>
- Wave Direction: impulse_up | impulse_down | corrective | unclear
- Wave Count: <string>
- Wave Next Target: <string>
- Wave Confidence: <0-100>
- Wave Rationale: <string>
- Chanlun Trend: up | down | range
- Chanlun Bi Direction: up | down | none
- Chanlun Duan Direction: up | down | none
- Chanlun Zhongshu State: forming | active | breaking_up | breaking_down | none
- Chanlun Buy Sell Point: buy_1 | buy_2 | buy_3 | sell_1 | sell_2 | sell_3 | none
- Chanlun Confidence: <0-100>
- Chanlun Rationale: <string>
- Harmonic Pattern: gartley | bat | butterfly | crab | abcd | cypher | shark | none
- Harmonic Direction: bullish | bearish | neutral
- Harmonic Confidence: <0-100>
- Harmonic Rationale: <string>
- Trade Direction: buy | sell | hold | dual
- Trade Entry Price: <number>
- Trade Stop Loss: <absolute stop loss price level>
- Trade Take Profit 1: <absolute take profit price level>
- Trade Take Profit 2: <absolute take profit price level>
- Trade Risk Reward Ratio: <number>
- Trade Position Size Lots: <string e.g. 0.05-0.1>
- Trade Rationale: <string>

## HARMONIC PATTERN GUIDE (Static Reference)
- Gartley/Bat: M-type (bearish) or W-type (bullish) retracement patterns — high-probability reversal zones
- Butterfly/Crab: Extension patterns — extreme reversal zones, higher risk/reward
- Cypher: C exceeds X (signature move), D retrace is based on XC (not XA) at 0.786
- Shark: B exceeds X (AB extension 1.13-1.618), D retrace at 0.886 of XA
- AB=CD: Simple geometric equivalence — CD leg mirrors AB leg
- Pattern direction + confidence determine entry weight in ARBITRATION

## PATTERN INTERPRETATION GUIDE (Static Reference)
- Bullish reversal: hammer, bullish_engulfing, piercing_line, morning_star
- Bearish reversal: shooting_star, bearish_engulfing, dark_cloud_cover, evening_star
- Continuation: three_white_soldiers, three_black_crows
- Priority: H1/M30 patterns are primary confirmation, M15 is timing signal


## ANCHOR REFERENCE SYSTEM (锚点引用)
The following anchors will be provided in subsequent messages.
You MUST reference them by their anchor ID without recalculating.

- {{WAVE_STRUCT}}: Pre-computed Elliott Wave structure
  - wave_count, wave_confirmation, extension_wave, corrective_type
  - Use exactly as provided; do NOT re-analyze wave structure
- {{CHANLUN_STRUCT}}: Pre-computed Chanlun (缠论) structure
  - bi_direction, duan_direction, zhongshu_state, buy_sell_point
  - Use exactly as provided; do NOT re-analyze chanlun structure
- {{CANDLESTICK_PATTERNS}}: Detected candlestick patterns by timeframe
  - Array of pattern strings per timeframe (e.g., {"H1": ["bullish_engulfing"]})
- {{HARMONIC_CTX}}: Pre-computed harmonic pattern detection
  - detected_pattern, direction, confidence, d_zone_price, completion_pct
  - Use exactly as provided; set detected_pattern="none" if empty

## INTEGRATION INSTRUCTIONS
- The WAVE section MUST use {{WAVE_STRUCT}} data without modification
- The CHANLUN section MUST use {{CHANLUN_STRUCT}} data without modification
- The HARMONIC section MUST reflect {{HARMONIC_CTX}} — use detected_pattern, direction, confidence directly
- If {{HARMONIC_CTX}} is empty, set detected_pattern="none" and direction="neutral"
- Mention aligned patterns from {{CANDLESTICK_PATTERNS}} in technical.indicators_summary`;
}

function buildSymbolSystemPrompt(profile: SymbolProfile): string {
  return `## SYMBOL CHARACTERISTICS
- Instrument: ${profile.name} (${profile.symbol})
- Price precision: ${profile.pricePrecision} decimal places
- Typical price range: ${profile.priceRangeHint}
- Volatility: ${profile.volatilityLevel}
- 1 pip = ${profile.pipValue}
- Suggested SL: ${profile.slAtrMultiplier}x ATR from current price (MUST output as absolute price level)
- Suggested TP: ${profile.tpAtrMultiplier}x ATR from current price (MUST output as absolute price level)
- All prices must fit this instrument's range (~${profile.priceRangeHint}).`;
}

/**
 * Build the semi-static context layer: computed structures (wave, chanlun, candlestick).
 * This layer changes only when bar data updates (~15min for gold-bot M15).
 * Eligible for medium-term prompt caching.
 *
 * NOTE: real-time price never appears here. If closed bars are insufficient,
 * this layer emits stable unavailable placeholders and leaves live price to
 * buildRealtimeDataPrompt().
 */
function renderStaticContextPrompt(
  waveStructure: unknown,
  chanlunStructure: unknown,
  candlestickPatterns: Record<string, string[]>,
  harmonicCtx: Record<string, unknown> | null,
): string {
  // Anchor-based: send minimal mapping data instead of full structure
  return `## COMPUTED ANALYSIS STRUCTURES (Anchor mapping — caching eligible)

### WAVE_STRUCT
${stableStringify(waveStructure)}

### CHANLUN_STRUCT
${stableStringify(chanlunStructure)}

### CANDLESTICK_PATTERNS
${Object.keys(candlestickPatterns).length > 0 ? stableStringify(candlestickPatterns) : 'none'}

### HARMONIC_CTX
${harmonicCtx ? stableStringify(harmonicCtx) : 'none'}

Refer to the anchors defined in system prompt for interpretation rules.`;
}

function buildStaticContextPrompt(
  payload: GoldbotPayload,
  symbol: string,
  structureCache: StructureCache,
): string {
  return structureCache.getOrBuild(symbol, payload);
}

/**
 * Build the real-time data layer: current price, positions, indicators.
 * This layer changes every request and is NOT cached.
 */
function buildRealtimeDataPrompt(
  payload: GoldbotPayload,
  pendingSignal: PendingSignal | undefined,
  symbol: string,
  profile: SymbolProfile,
): string {
  const currentPrice = payload.market.bid || payload.market.ask || 0;
  const m15 = selectIndicator(payload.indicators, 'M15', 'm15');
  const m30 = selectIndicator(payload.indicators, 'M30', 'm30');
  const h1 = selectIndicator(payload.indicators, 'H1', 'h1');
  const h4 = selectIndicator(payload.indicators, 'H4', 'h4');

  return `## REAL-TIME MARKET DATA (Dynamic — no caching)

**Task:** Analyze ${profile.name} (${symbol}) and return structured MARKDOWN with ALL 6 sections: TECHNICAL, WAVE, CHANLUN, HARMONIC, RISK, ARBITRATION.

### Symbol Context
- Symbol: ${symbol}
- Instrument: ${profile.name}
- **Current price: ${currentPrice.toFixed(profile.pricePrecision)}**
- Market status: ${stableStringify(payload.market_status)}
- Strategy mapping: ${stableStringify(payload.strategy_mapping)}

### Market Data
${stableStringify(payload.market)}

### Account State
${stableStringify(payload.account)}

### Current Positions
${stableStringify(payload.positions)}

### Multi-Timeframe Indicators (Live)
- **M15:** ${stableStringify(m15)}
- **M30:** ${stableStringify(m30)}
- **H1:** ${stableStringify(h1)}
- **H4:** ${stableStringify(h4)}

### Divergence Signals (Technical Indicator Engine)
- **MACD Divergence:** H1=${h1?.macd_divergence || 'none'}, M30=${m30?.macd_divergence || 'none'}
- **RSI Divergence:** H1=${h1?.rsi_divergence || 'none'}, M30=${m30?.rsi_divergence || 'none'}
- **Impact:** Bullish divergence → increase BUY confidence, bearish divergence → increase SELL confidence
- Strong divergence (price extreme + contra-trend RSI/MACD) must be mentioned in technical.rationale

### Pending Signal (from previous analysis cycle)
${pendingSignal ? stableStringify(pendingSignal) : 'none'}

### Final Reminders
- Output MUST include all 6 top-level sections
- Risk and arbitration sections must reflect account, positions, and pending signal
- All prices must fit instrument range (~${profile.priceRangeHint})
- **PRICE ANCHOR: Current ${symbol} price is ${currentPrice.toFixed(profile.pricePrecision)}. All SL/TP values MUST be absolute price levels in this same order of magnitude.** Do NOT output ATR values, point distances, or pip offsets as SL/TP.`;
}

function buildFallback(currentPrice: number): ComprehensiveAnalysisResult {
  return {
    technical: {
      bias: 'neutral',
      confidence: 0,
      phase: 'consolidation',
      indicators_summary: '中性观望 (Neutral hold)',
      support_levels: [],
      resistance_levels: [],
      recommendation: 'none',
      rationale: '综合分析失败，返回中性结果 (Comprehensive analysis failed, returning neutral result)',
    },
    wave: {
      wave_confirmation: 'rejected',
      extension_wave: null,
      corrective_type: null,
      trend_strength: 'weak',
      target_levels: {
        level_1_618: currentPrice,
        level_2_0: currentPrice,
      },
      confidence: 0,
      rationale: '波浪结构不可用 (Wave structure unavailable)',
    },
    chanlun: {
      trend: 'range',
      strength: 'weak',
      latest_signal: 'hold',
      hub_state: 'none',
      confidence: 0,
      rationale: '缠论结构不可用 (Chanlun structure unavailable)',
    },
    harmonic: {
      detected_pattern: 'none',
      direction: 'neutral',
      timeframe: 'N/A',
      completion_pct: 0,
      confidence: 0,
      d_zone_price: 0,
      entry_zone: 'N/A',
      stop_loss: 0,
      take_profit_1: 0,
      take_profit_2: 0,
      rationale: '谐波形态不可用 (Harmonic pattern unavailable)',
    },
    risk: {
      riskLevel: 'high',
      maxPositionSize: 0,
      suggestedSL: 0,
      suggestedTP: 0,
      warnings: ['综合分析失败，建议观望 (Comprehensive analysis failed, stay flat)'],
      addOn: false,
    },
    arbitration: {
      final_direction: 'hold',
      confidence: 0,
      primary_contradiction: 'analysis_unavailable',
      phase: 'unknown',
      reasoning: '综合分析失败，维持观望 (Comprehensive analysis failed, hold)',
      action: 'hold',
      united_front_analysis: '无一致性信号 (No aligned signal)',
      harmonic_theory: {
        pattern: 'none',
        direction: 'neutral',
        confidence: 0,
        rationale: '谐波理论不可用 (Harmonic theory unavailable)',
      },
    },
  };
}

/**
 * Parse Markdown-structured LLM output into ComprehensiveAnalysisResult.
 * Returns null if parsing fails fundamentally (caller falls back to JSON or buildFallback).
 */
function parseMarkdownResponse(raw: string, currentPrice: number, profile: SymbolProfile): ComprehensiveAnalysisResult | null {
  const sections = splitSections(raw);
  if (sections.size < 3) return null; // Need at least some sections

  // ── TECHNICAL ──
  const techSection = sections.get('technical') || '';
  const techFields = extractFields(techSection);
  const techListItems = extractListItems(techSection);

  // Separate S/R list items by checking which come after "Support Levels" vs "Resistance Levels"
  const techLines = techSection.split('\n');
  let inSupportSection = false;
  let inResistanceSection = false;
  const supportLines: string[] = [];
  const resistanceLines: string[] = [];
  for (const line of techLines) {
    if (line.match(/^-\s+support\s+levels/i)) inSupportSection = true, inResistanceSection = false;
    else if (line.match(/^-\s+resistance\s+levels/i)) inResistanceSection = true, inSupportSection = false;
    else if (line.match(/^-\s+\w/i) && !line.match(/^\s/)) inSupportSection = false, inResistanceSection = false;

    const listMatch = line.match(/^\s{2,}-\s+(.+)/);
    if (listMatch) {
      const content = listMatch[1].trim();
      if (content.includes('|')) {
        if (inSupportSection) supportLines.push(content);
        else if (inResistanceSection) resistanceLines.push(content);
      }
    }
  }

  const technical: TechnicalAnalysis = {
    bias: getEnumField(techFields, 'bias', ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
    confidence: getNumberField(techFields, 'confidence', 0, { min: 0, max: 100 }),
    phase: getEnumField(techFields, 'phase', ['trending', 'ranging', 'breakout', 'reversal', 'consolidation'] as const, 'consolidation'),
    indicators_summary: getStringField(techFields, 'indicators_summary', '中性观望 (Neutral hold)'),
    support_levels: parseSRLevels(supportLines, 'support'),
    resistance_levels: parseSRLevels(resistanceLines, 'resistance'),
    recommendation: getEnumField(techFields, 'recommendation', ['hold', 'close', 'partial_close', 'trail_stop', 'none'] as const, 'none'),
    rationale: getStringField(techFields, 'rationale', '无分析 (No analysis)'),
  };

  // ── WAVE ──
  const waveSection = sections.get('wave') || '';
  const waveFields = extractFields(waveSection);
  const extWaveRaw = getNumberField(waveFields, 'extension_wave', 0, { min: 1, max: 5 });
  const validExtWaves = [1, 3, 5];
  const extensionWave = validExtWaves.includes(extWaveRaw as 1 | 3 | 5) ? (extWaveRaw as 1 | 3 | 5) : null;
  const correctiveRaw = getStringField(waveFields, 'corrective_type', '');
  const validCorrective = ['zigzag', 'flat', 'triangle'] as const;
  const correctiveType = validCorrective.includes(correctiveRaw as any) ? (correctiveRaw as 'zigzag' | 'flat' | 'triangle') : null;

  const wave: WaveAnalystResult = {
    wave_confirmation: getEnumField(waveFields, 'confirmation', ['confirmed', 'partial', 'rejected'] as const, 'rejected'),
    extension_wave: extensionWave,
    corrective_type: correctiveType,
    trend_strength: getEnumField(waveFields, 'trend_strength', ['strong', 'moderate', 'weak'] as const, 'weak'),
    target_levels: {
      level_1_618: getNumberField(waveFields, 'target_level_1.618', currentPrice),
      level_2_0: getNumberField(waveFields, 'target_level_2.0', currentPrice),
    },
    confidence: getNumberField(waveFields, 'confidence', 0, { min: 0, max: 100 }),
    rationale: getStringField(waveFields, 'rationale', '波浪结构不可用 (Wave structure unavailable)'),
  };

  // ── CHANLUN ──
  const chanlunSection = sections.get('chanlun') || '';
  const chanlunFields = extractFields(chanlunSection);

  const chanlun: ChanlunAnalystResult = {
    trend: getEnumField(chanlunFields, 'trend', ['up', 'down', 'range'] as const, 'range'),
    strength: getEnumField(chanlunFields, 'strength', ['strong', 'moderate', 'weak'] as const, 'weak'),
    latest_signal: getEnumField(chanlunFields, 'latest_signal', ['buy', 'sell', 'hold'] as const, 'hold'),
    hub_state: getEnumField(chanlunFields, 'hub_state', ['forming', 'active', 'none'] as const, 'none'),
    confidence: getNumberField(chanlunFields, 'confidence', 0, { min: 0, max: 100 }),
    rationale: getStringField(chanlunFields, 'rationale', '缠论结构不可用 (Chanlun structure unavailable)'),
  };

  // ── HARMONIC ──
  const harmonicSection = sections.get('harmonic') || '';
  const harmonicFields = extractFields(harmonicSection);

  const harmonic: HarmonicAnalysisResult = {
    detected_pattern: getEnumField(harmonicFields, 'detected_pattern', ['gartley', 'bat', 'butterfly', 'crab', 'abcd', 'cypher', 'shark', 'none'] as const, 'none'),
    direction: getEnumField(harmonicFields, 'direction', ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
    timeframe: getStringField(harmonicFields, 'timeframe', 'N/A'),
    completion_pct: getNumberField(harmonicFields, 'completion', 0, { min: 0, max: 100 }),
    confidence: getNumberField(harmonicFields, 'confidence', 0, { min: 0, max: 100 }),
    d_zone_price: getNumberField(harmonicFields, 'd_zone_price', 0),
    entry_zone: getStringField(harmonicFields, 'entry_zone', 'N/A'),
    stop_loss: getNumberField(harmonicFields, 'stop_loss', 0),
    take_profit_1: getNumberField(harmonicFields, 'take_profit_1', 0),
    take_profit_2: getNumberField(harmonicFields, 'take_profit_2', 0),
    rationale: getStringField(harmonicFields, 'rationale', '谐波形态未检测到 (No harmonic pattern detected)'),
  };

  // ── RISK ──
  const riskSection = sections.get('risk') || '';
  const riskFields = extractFields(riskSection);
  const riskListItems = extractListItems(riskSection);

  const risk: RiskAssessment = {
    riskLevel: getEnumField(riskFields, 'risk_level', ['low', 'medium', 'high', 'extreme'] as const, 'high'),
    maxPositionSize: getNumberField(riskFields, 'max_position_size', 0),
    suggestedSL: getNumberField(riskFields, 'suggested_sl', 0),
    suggestedTP: getNumberField(riskFields, 'suggested_tp', 0),
    warnings: extractWarnings(riskFields, riskListItems),
    addOn: getBooleanField(riskFields, 'add_on', false),
  };

  // ── ARBITRATION ──
  const arbSection = sections.get('arbitration') || '';
  const arbFields = extractFields(arbSection);

  const dowTheory: DowTheoryAnalysis = {
    primary_trend: getEnumField(arbFields, 'dow_primary_trend', ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
    primary_phase: getEnumField(arbFields, 'dow_primary_phase', ['accumulation', 'markup', 'distribution', 'markdown'] as const, 'accumulation'),
    secondary_trend: getEnumField(arbFields, 'dow_secondary_trend', ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
    short_term_trend: getEnumField(arbFields, 'dow_short_term_trend', ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
    multi_tf_confirm: getBooleanField(arbFields, 'dow_multi_tf_confirm', false),
    rationale: getStringField(arbFields, 'dow_rationale', ''),
  };

  const waveTheory: WaveTheoryAnalysis = {
    current_wave: getStringField(arbFields, 'wave_current_wave', 'Unknown'),
    wave_direction: getEnumField(arbFields, 'wave_direction', ['impulse_up', 'impulse_down', 'corrective', 'unclear'] as const, 'unclear'),
    wave_count: getStringField(arbFields, 'wave_count', 'Unknown'),
    next_target: getStringField(arbFields, 'wave_next_target', 'N/A'),
    confidence: getNumberField(arbFields, 'wave_confidence', 0, { min: 0, max: 100 }),
    rationale: getStringField(arbFields, 'wave_rationale', ''),
  };

  const chanlunTheory: ChanlunTheoryAnalysis = {
    trend: getEnumField(arbFields, 'chanlun_trend', ['up', 'down', 'range'] as const, 'range'),
    bi_direction: getEnumField(arbFields, 'chanlun_bi_direction', ['up', 'down', 'none'] as const, 'none'),
    duan_direction: getEnumField(arbFields, 'chanlun_duan_direction', ['up', 'down', 'none'] as const, 'none'),
    zhongshu_state: getEnumField(arbFields, 'chanlun_zhongshu_state', ['forming', 'active', 'breaking_up', 'breaking_down', 'none'] as const, 'none'),
    buy_sell_point: getEnumField(arbFields, 'chanlun_buy_sell_point', ['buy_1', 'buy_2', 'buy_3', 'sell_1', 'sell_2', 'sell_3', 'none'] as const, 'none'),
    confidence: getNumberField(arbFields, 'chanlun_confidence', 0, { min: 0, max: 100 }),
    rationale: getStringField(arbFields, 'chanlun_rationale', ''),
  };

  const harmonicTheory: HarmonicTheoryAnalysis = {
    pattern: getEnumField(arbFields, 'harmonic_pattern', ['gartley', 'bat', 'butterfly', 'crab', 'abcd', 'cypher', 'shark', 'none'] as const, 'none'),
    direction: getEnumField(arbFields, 'harmonic_direction', ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
    confidence: getNumberField(arbFields, 'harmonic_confidence', 0, { min: 0, max: 100 }),
    rationale: getStringField(arbFields, 'harmonic_rationale', ''),
  };

  // Trade recommendation — include even for 'hold' if LLM provided SL/TP values
  // (hold with reference SL/TP is useful for pending orders / alert levels)
  const tradeDirection = getEnumField(arbFields, 'trade_direction', ['buy', 'sell', 'hold', 'dual'] as const, 'hold');
  const tradeEntryPrice = getNumberField(arbFields, 'trade_entry_price', 0);
  const tradeStopLoss = getNumberField(arbFields, 'trade_stop_loss', 0);
  const tradeTakeProfit1 = getNumberField(arbFields, 'trade_take_profit_1', 0);
  const tradeTakeProfit2 = getNumberField(arbFields, 'trade_take_profit_2', 0);

  let tradeRecommendation: TradeRecommendation | undefined;
  if (tradeEntryPrice > 0 && tradeStopLoss > 0 && tradeTakeProfit1 > 0) {
    tradeRecommendation = {
      direction: tradeDirection === 'dual' ? 'buy' : tradeDirection, // TypeScript type narrowing
      entry_price: tradeEntryPrice,
      stop_loss: tradeStopLoss,
      take_profit_1: tradeTakeProfit1,
      take_profit_2: tradeTakeProfit2 > 0 ? tradeTakeProfit2 : undefined,
      risk_reward_ratio: getNumberField(arbFields, 'trade_risk_reward_ratio', 0),
      position_size_lots: getStringField(arbFields, 'trade_position_size_lots', '0.01'),
      rationale: getStringField(arbFields, 'trade_rationale', ''),
    };
  }

  const arbitration: ArbitrationResult = {
    final_direction: getEnumField(arbFields, 'final_direction', ['buy', 'sell', 'hold', 'close', 'dual'] as const, 'hold'),
    confidence: getNumberField(arbFields, 'confidence', 0, { min: 0, max: 100 }),
    primary_contradiction: getStringField(arbFields, 'primary_contradiction', ''),
    phase: getStringField(arbFields, 'phase', 'unknown'),
    reasoning: getStringField(arbFields, 'reasoning', '无分析推理 (No analysis reasoning)'),
    action: getEnumField(arbFields, 'action', ['open', 'close', 'modify', 'hold'] as const, 'hold'),
    united_front_analysis: getStringField(arbFields, 'united_front_analysis', '无一致性信号 (No aligned signal)'),
    dow_theory: dowTheory,
    wave_theory: waveTheory,
    chanlun_theory: chanlunTheory,
    harmonic_theory: harmonicTheory,
    trade_recommendation: tradeRecommendation,
  };

  return { technical, wave, chanlun, harmonic, risk, arbitration };
}

@Injectable()
export class ComprehensiveAnalystService {
  private readonly structureCache = new StructureCache();

  constructor(private readonly client: LlmClientService) {}

  async run(
    payload: GoldbotPayload,
    symbol: string,
    pendingSignal?: PendingSignal,
    allCurrentPrices?: Record<string, number>,
  ): Promise<ComprehensiveAnalysisResult> {
    const logger = getLogger();
    const profile = getSymbolProfile(symbol);
    const currentPrice = payload.market.bid || payload.market.ask || 0;

    // Layer 0-1: Common system rules plus symbol-specific characteristics.
    const systemBlocks = [
      { text: buildCommonSystemPrompt(), cacheable: true },
      { text: buildSymbolSystemPrompt(profile), cacheable: true },
    ];

    // Layer 2: Semi-static context (computed structures) → prompt-cache eligible.
    const staticContextPrompt = buildStaticContextPrompt(payload, symbol, this.structureCache);

    // Layer 3: Real-time data (price, positions, indicators) → no cache.
    const realtimeDataPrompt = buildRealtimeDataPrompt(payload, pendingSignal, symbol, profile);
    const userLayers = [
      { text: staticContextPrompt, cacheable: true },
      { text: realtimeDataPrompt, cacheable: false },
    ];

    let raw: string;
    try {
      const result = await this.client.streamLayered(systemBlocks, userLayers);
      raw = result.content;
      logger.info(
        {
          symbol,
          strategy: this.client.getCacheStrategy().type,
          model: this.client.getModel(),
          ...result.cacheStats,
        },
        'Prompt cache stats',
      );
    } catch (err) {
      logger.warn(
        { symbol, err: err instanceof Error ? err.message : String(err) },
        'comprehensiveAnalysis: streamInvoke failed, falling back to non-streaming',
      );
      try {
        raw = await this.client.invokeLayered(systemBlocks, userLayers);
      } catch (invokeErr) {
        logger.error(
          { symbol, err: invokeErr instanceof Error ? invokeErr.message : String(invokeErr) },
          'comprehensiveAnalysis: invokeLayered failed',
        );
        return buildFallback(currentPrice);
      }
    }

    // Dual-format parsing: try Markdown first, fallback to JSON
    const format = detectFormat(raw);
    logger.info({ symbol, format }, 'comprehensiveAnalysis: detected output format');

    let result: ComprehensiveAnalysisResult;

    if (format === 'markdown') {
      const mdResult = parseMarkdownResponse(raw, currentPrice, profile);
      if (mdResult) {
        result = normalizeComprehensive(mdResult);
      } else {
        logger.warn({ symbol }, 'comprehensiveAnalysis: Markdown parse failed, trying JSON fallback');
        const parsed = safeParseResponse(raw, ComprehensiveAnalysisDataSchema, {
          agent: 'comprehensive',
          symbol,
        });
        if (!parsed) {
          logger.error({ symbol, rawPrefix: raw.slice(0, 200) }, 'comprehensiveAnalysis: both Markdown and JSON parse failed');
          return buildFallback(currentPrice);
        }
        result = normalizeComprehensive(parsed);
      }
    } else {
      const parsed = safeParseResponse(raw, ComprehensiveAnalysisDataSchema, {
        agent: 'comprehensive',
        symbol,
      });
      if (!parsed) {
        logger.error({ symbol, rawPrefix: raw.slice(0, 200) }, 'comprehensiveAnalysis: both Markdown and JSON parse failed');
        return buildFallback(currentPrice);
      }
      result = normalizeComprehensive(parsed);
    }

    // ── POST-PARSE VALIDATION: Dynamic price sanity check ──
    // Catches LLM hallucinations where it outputs prices for a different instrument.
    // Removed static priceRange check — prices evolve and static ranges become stale
    // (e.g., XAGUSD rose above its historical [15,50] bound, causing false rejections).
    // Instead, we rely on:
    //   Layer 1: currentPrice dynamic range — 0.3x–2.0x of live price (wide, handles trends)
    //   Layer 2: Cross-instrument collision detection (detects price matching another symbol)
    const priceFields: Array<{ obj: Record<string, any>; key: string; label: string }> = [
      { obj: result.risk as any, key: 'suggestedSL', label: 'risk.suggestedSL' },
      { obj: result.risk as any, key: 'suggestedTP', label: 'risk.suggestedTP' },
      { obj: result.harmonic as any, key: 'stop_loss', label: 'harmonic.stop_loss' },
      { obj: result.harmonic as any, key: 'take_profit_1', label: 'harmonic.take_profit_1' },
      { obj: result.harmonic as any, key: 'take_profit_2', label: 'harmonic.take_profit_2' },
    ];

    for (const { obj, key, label } of priceFields) {
      const val = obj[key];
      if (val === undefined || val === 0 || !Number.isFinite(val)) continue;

      let rejected = false;
      let reason = '';

      // Layer 1: Dynamic currentPrice window
      // 0.3x–2.0x covers strong trends while catching gross cross-instrument errors
      // (e.g., XAUUSD SL=58 when XAUUSD is at $3300 — clearly wrong instrument price)
      if (currentPrice > 0) {
        const dynamicLo = currentPrice * 0.3;  // -70% from current (very wide, handles strong trends)
        const dynamicHi = currentPrice * 2.0;  // +100% from current (allows for significant moves)
        if (val < dynamicLo || val > dynamicHi) {
          rejected = true;
          reason = `偏离当前价${currentPrice}合理区间(${dynamicLo.toFixed(2)}-${dynamicHi.toFixed(2)})`;
        }
      }

      // Fallback: for unknown instruments with no currentPrice, use ±50% of the value itself
      // (only triggers if currentPrice is 0, which is rare)
      if (!rejected && currentPrice <= 0 && val <= 0) {
        rejected = true;
        reason = '无效价格(当前价和输出值均为0)';
      }

      if (rejected) {
        logger.warn(
          { symbol, field: label, value: val, currentPrice },
          `${label} ${reason} — zeroing`,
        );
        obj[key] = 0;
        result.risk.warnings = result.risk.warnings || [];
        result.risk.warnings.push(`AI${label} ${val} ${reason}，已拒绝`);
        continue;  // already rejected, skip further checks
      }

      // Layer 4: Cross-instrument collision detection
      // Catches prices that are within valid static/dynamic ranges but suspiciously
      // close to another instrument's live price (e.g., USOILCASH SL=58.43 near XAGUSD $36,
      // or EURJPY SL=198.0 near GBPJPY ¥198)
      if (allCurrentPrices && Object.keys(allCurrentPrices).length > 1) {
        const suspect = detectCrossInstrumentPrice(symbol, val, currentPrice, allCurrentPrices);
        if (suspect) {
          const suspectPrice = allCurrentPrices[suspect];
          logger.warn(
            { symbol, field: label, value: val, suspectInstrument: suspect, suspectPrice },
            `${label} ${val} matches ${suspect} price range (${suspectPrice}) — cross-instrument contamination, zeroing`,
          );
          obj[key] = 0;
          result.risk.warnings = result.risk.warnings || [];
          result.risk.warnings.push(`AI${label} ${val} 与${suspect}价格(${suspectPrice})高度吻合，疑似品种混淆，已拒绝`);
        }
      }
    }

    // ── ARBITRATION VALIDATION: Use existing price-validator (was imported but never called!) ──
    if (result.arbitration && result.arbitration.trade_recommendation) {
      const tradeVal = validateTradeRecommendation(result.arbitration.trade_recommendation, currentPrice, profile);
      if (tradeVal.warnings.length > 0) {
        logger.warn({ symbol, warnings: tradeVal.warnings }, 'Arbitration trade_validation warnings');
      }
      if (!tradeVal.valid && tradeVal.fixedTrade) {
        logger.warn({ symbol }, 'Arbitration trade invalid — applying fix (direction→hold if SL/TP zeroed)');
        result.arbitration.trade_recommendation = tradeVal.fixedTrade;
        // Downgrade arbitration if trade is invalid
        if (tradeVal.fixedTrade.direction === 'hold') {
          result.arbitration.final_direction = 'hold';
          result.arbitration.action = 'hold';
          result.arbitration.confidence = Math.min(result.arbitration.confidence, 20);
        }
      }

      // Also validate the full arbitration result
      const arbVal = validateArbitrationResult(result.arbitration, currentPrice, profile);
      if (!arbVal.valid && arbVal.fixedArbitration) {
        logger.warn({ symbol }, 'Arbitration result invalid — applying downgrade');
        result.arbitration = arbVal.fixedArbitration;
      }
    }

    return result;
  }
}

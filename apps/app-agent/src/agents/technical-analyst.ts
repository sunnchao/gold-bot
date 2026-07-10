/**
 * Technical Analyst Agent — analyzes market data with LLM and returns
 * a structured TechnicalAnalysis result.
 */

import { Injectable } from "@nestjs/common";
import type { GoldbotPayload } from "../types/goldbot.js";
import type { TechnicalAnalysis } from "../types/analysis.js";
import { LlmClientService } from "../tools/llm-client.js";
import type { SystemBlock, UserLayer } from "../tools/llm-client.js";
import { findPsychologicalLevels } from "../tools/sr-calculator.js";
import { getLogger } from "../utils/logger.js";
import { selectIndicator } from "../utils/goldbot-indicators.js";
import { TechnicalAnalysisSchema, cleanSRLevels } from "../types/schemas.js";
import { safeParseResponse } from "../utils/parse.js";
import { getSymbolProfile, type SymbolProfile } from '../config/symbol-profile.js';
import { filterValidPrices } from '../utils/price-validator.js';
import { stableStringify } from '../utils/stable-stringify.js';

function buildSystemPrompt(profile: SymbolProfile): string {
  return `You are a technical analysis specialist for ${profile.name} (${profile.symbol}).
Given raw market data and computed indicators, produce a JSON TechnicalAnalysis object.

## SYMBOL CHARACTERISTICS
- Instrument: ${profile.name}
- Price precision: ${profile.pricePrecision} decimal places
- Typical price range: ${profile.priceRangeHint}
- Volatility: ${profile.volatilityLevel}
- 1 pip = ${profile.pipValue}
- Suggested SL: ${profile.slAtrMultiplier}× ATR
- Suggested TP: ${profile.tpAtrMultiplier}× ATR
- Volume data reliable: ${profile.volumeReliable}

## CRITICAL: PRICE VALIDATION
All prices in your response MUST be within ±50% of the current market price.
If current price is ~214, your S/R levels MUST be between 107 and 321.
If current price is ~3300, your S/R levels MUST be between 1650 and 4950.
NEVER output prices from a different instrument. Check your numbers before responding.

## CRITICAL OUTPUT RULES
1. Output ONLY valid JSON. No markdown, no code blocks, no explanation outside JSON.
2. ALL numeric fields MUST be valid numbers (never null, undefined, or empty string).
3. For text fields, output bilingual: Chinese first, English in parentheses. Example: "下跌趋势 (Downtrend)".
4. ALL enum values MUST be EXACTLY lowercase: "bullish"/"bearish"/"neutral", "trending"/"ranging"/"breakout"/"reversal"/"consolidation", "hold"/"close"/"partial_close"/"trail_stop"/"none".
5. DO NOT invent new enum values. Use ONLY the exact values specified below.

## MULTI-TIMEFRAME WEIGHTING RULES
When multiple timeframes show conflicting signals, prioritize by weight:
- H1 (35%): Primary trend ADX, MACD, RSI alignment — DOMINANT timeframe
- M30 (35%): Primary trend confirmation, RSI divergence detection — DOMINANT timeframe
- H4 (15%): Medium-term trend validation (NOT primary direction source)
- M15 (15%): Entry timing signals (超卖/超买 NOT override H1/M30 trend)

**CRITICAL RULES:**
1. M15 RSI < 30 (oversold) does NOT reverse a H1 bearish trend (ADX > 35)
2. M15 超卖只是短期反弹风险提示，不能改变 H1/M30 主导的趋势方向
3. When H1 + M30 align (70% combined weight), they DOMINATE the direction
4. Confidence boost when H1 + M30 align: +10%
5. Confidence penalty when M15 contradicts H1: -5% (not direction reversal)

**Example scenarios:**
- H1 ADX 43 bearish + M30 RSI 51 neutral + M15 RSI 30 oversold → Direction: BEARISH (hold), not bullish
- H1 ADX 38 bullish + M30 RSI 55 bullish + M15 RSI 70 overbought → Direction: BULLISH, confidence -5%

## STRICT JSON SCHEMA (use EXACT lowercase enum values)
{
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": <number 0-100>,
  "phase": "trending" | "ranging" | "breakout" | "reversal" | "consolidation",
  "indicators_summary": "<string: bilingual summary>",
  "support_levels": [
    {
      "price": <REQUIRED: valid number, NEVER null/undefined>,
      "type": "support",
      "strength": "strong" | "moderate" | "weak",
      "timeframe": "<string e.g. H1>",
      "touches": <number 1-10>
    }
  ],
  "resistance_levels": [
    {
      "price": <REQUIRED: valid number, NEVER null/undefined>,
      "type": "resistance",
      "strength": "strong" | "moderate" | "weak",
      "timeframe": "<string e.g. H4>",
      "touches": <number 1-10>
    }
  ],
  "recommendation": "hold" | "close" | "partial_close" | "trail_stop" | "none",
  "rationale": "<string: bilingual reasoning>"
}

## S/R LEVEL CONSTRAINTS
1. Output at most 3 support + 3 resistance (total ≤ 6).
2. Each level's price MUST be a concrete number from the provided data.
3. Levels must be at least 2× ATR apart.
4. Prioritize: Pivot Points > Fibonacci > Psychological levels.
5. If no valid level found, return empty array [] — NEVER include level with null price.
6. All prices MUST match the instrument being analyzed — do NOT output prices from a different instrument.

## ANCHOR REFERENCE SYSTEM
The following anchors will be provided in subsequent messages.
You MUST reference them directly without recalculating.

- {{FIB_LEVELS}}: Pre-computed Fibonacci retracement levels
  - Contains: fib_236, fib_382, fib_500, fib_618, fib_786
  - Use for support/resistance level identification
- {{PIVOT_LEVELS}}: Pre-computed pivot points
  - Contains: pp, r1, s1 (and optional r2, s2)
  - Use as primary S/R reference levels
- {{MTF_INDICATORS}}: Multi-timeframe raw indicator values
  - Contains raw OHLC, EMA, RSI, ADX, ATR, MACD, BB, Stoch per timeframe
  - Use for bias calculation, phase detection, and rationale`;
}

function buildSemiStaticData(
  indicators: GoldbotPayload['indicators'],
  profile: SymbolProfile,
): string {
  const h1 = selectIndicator(indicators, 'H1', 'h1');
  const h4 = selectIndicator(indicators, 'H4', 'h4');
  const m15 = selectIndicator(indicators, 'M15', 'm15');
  const m30 = selectIndicator(indicators, 'M30', 'm30');

  const fibLevels = {
    fib_236: h1.fib_236,
    fib_382: h1.fib_382,
    fib_500: h1.fib_500,
    fib_618: h1.fib_618,
    fib_786: h1.fib_786,
  };
  const pivotLevels = {
    pp: h1.pp,
    r1: h1.r1,
    s1: h1.s1,
  };

  // Multi-timeframe aggregate indicators (semi-static: changes when bars update)
  return `## SEMI-STATIC TECHNICAL STRUCTURES (Anchor mapping — changes on bar update)

### FIB_LEVELS
${stableStringify(fibLevels)}

### PIVOT_LEVELS
${stableStringify(pivotLevels)}

### MTF_INDICATORS
H1: close=${h1.close}, high=${h1.high}, low=${h1.low}, EMA20=${h1.ema20}, EMA50=${h1.ema50}, EMA200=${h1.ema200}
H4: close=${h4.close}, high=${h4.high}, low=${h4.low}, EMA20=${h4.ema20}, EMA50=${h4.ema50}, EMA200=${h4.ema200}
M15: close=${m15.close}, EMA20=${m15.ema20}, EMA50=${m15.ema50}
M30: close=${m30.close}, EMA20=${m30.ema20}, EMA50=${m30.ema50}`;
}

function buildDynamicData(
  payload: GoldbotPayload,
  profile: SymbolProfile,
): string {
  const { market, indicators, positions } = payload;
  const h1 = selectIndicator(indicators, 'H1', 'h1');
  const h4 = selectIndicator(indicators, 'H4', 'h4');
  const m15 = selectIndicator(indicators, 'M15', 'm15');
  const m30 = selectIndicator(indicators, 'M30', 'm30');
  const currentPrice = market.bid || market.ask || 0;
  const psychLevels = findPsychologicalLevels(currentPrice, 100);

  return `## REAL-TIME DATA (changes every request — do not cache)

Symbol: ${profile.name} (${market.symbol})
Current Price: ${currentPrice.toFixed(profile.pricePrecision)}
Price: bid=${market.bid.toFixed(profile.pricePrecision)}, ask=${market.ask.toFixed(profile.pricePrecision)}, spread=${market.spread}

Live Indicators:
H1 RSI=${h1.rsi}, ADX=${h1.adx}, ATR=${h1.atr}, MACD=${h1.macd}/Signal=${h1.macd_signal}/Hist=${h1.macd_hist}
H4 RSI=${h4.rsi}, ADX=${h4.adx}, ATR=${h4.atr}, MACD=${h4.macd}/Signal=${h4.macd_signal}/Hist=${h4.macd_hist}
M15 RSI=${m15.rsi}, ADX=${m15.adx}, ATR=${m15.atr}
M30 RSI=${m30.rsi}, ADX=${m30.adx}, ATR=${m30.atr}

Psychological Levels: ${stableStringify(psychLevels.slice(0, 10))}
Open Positions: ${stableStringify(positions)}

Analyze and return a JSON TechnicalAnalysis.`;
}

/** @deprecated Use buildSemiStaticData + buildDynamicData for better caching */
function buildPrompt(payload: GoldbotPayload, profile: SymbolProfile): string {
  const { market, indicators, positions } = payload;
  const h1 = selectIndicator(indicators, 'H1', 'h1');
  const h4 = selectIndicator(indicators, 'H4', 'h4');
  const m15 = selectIndicator(indicators, 'M15', 'm15');
  const m30 = selectIndicator(indicators, 'M30', 'm30');
  const fibLevels = {
    fib_236: h1.fib_236,
    fib_382: h1.fib_382,
    fib_500: h1.fib_500,
    fib_618: h1.fib_618,
    fib_786: h1.fib_786,
  };
  const pivotLevels = {
    pp: h1.pp,
    r1: h1.r1,
    s1: h1.s1,
  };
  const psychLevels = findPsychologicalLevels(market.bid || market.ask || 0, 100);
  const currentPrice = market.bid || market.ask || 0;

  return `Analyze ${profile.name} (${market.symbol}) technical data:

## SYMBOL CONTEXT
- Instrument: ${profile.name} (${profile.symbol})
- Current Price: ${currentPrice.toFixed(profile.pricePrecision)}
- Price Range: ${(currentPrice * 0.5).toFixed(profile.pricePrecision)} - ${(currentPrice * 1.5).toFixed(profile.pricePrecision)}
- Volatility: ${profile.volatilityLevel}
- 1 pip = ${profile.pipValue}

## MARKET DATA
Price: bid=${market.bid.toFixed(profile.pricePrecision)}, ask=${market.ask.toFixed(profile.pricePrecision)}, spread=${market.spread}

H1 Indicators:
  close=${h1.close}, open=${h1.open}, high=${h1.high}, low=${h1.low}
  EMA20=${h1.ema20}, EMA50=${h1.ema50}, EMA200=${h1.ema200}
  RSI=${h1.rsi}, ADX=${h1.adx}, ATR=${h1.atr}
  MACD=${h1.macd} / Signal=${h1.macd_signal} / Hist=${h1.macd_hist}
  BB: Upper=${h1.bb_upper} Middle=${h1.bb_middle} Lower=${h1.bb_lower}
  Stoch: K=${h1.stoch_k} D=${h1.stoch_d}

H4 Indicators:
  close=${h4.close}, open=${h4.open}, high=${h4.high}, low=${h4.low}
  EMA20=${h4.ema20}, EMA50=${h4.ema50}, EMA200=${h4.ema200}
  RSI=${h4.rsi}, ADX=${h4.adx}, ATR=${h4.atr}
  MACD=${h4.macd} / Signal=${h4.macd_signal} / Hist=${h4.macd_hist}

M15 Indicators:
  close=${m15.close}, open=${m15.open}, high=${m15.high}, low=${m15.low}
  EMA20=${m15.ema20}, EMA50=${m15.ema50}
  RSI=${m15.rsi}, ADX=${m15.adx}, ATR=${m15.atr}

M30 Indicators:
  close=${m30.close}, open=${m30.open}, high=${m30.high}, low=${m30.low}
  EMA20=${m30.ema20}, EMA50=${m30.ema50}
  RSI=${m30.rsi}, ADX=${m30.adx}, ATR=${m30.atr}

Fibonacci Levels: ${stableStringify(fibLevels)}

Pivot Points: ${stableStringify(pivotLevels)}

Psychological Levels (nearby): ${stableStringify(psychLevels.slice(0, 10))}

Open positions: ${stableStringify(positions)}

Respond with a JSON TechnicalAnalysis object with fields: bias, confidence, phase,
indicators_summary, support_levels, resistance_levels, recommendation, rationale.`;
}

// Batch mode removed — each symbol now gets independent LLM call to prevent cross-contamination

// Normalize LLM enum values to lowercase (insurance for models like glm-5)
function normalizeEnums(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const obj = data as Record<string, unknown>;
  
  // Normalize confidence: convert string to number
  if (typeof obj.confidence === 'string') {
    const parsed = parseInt(obj.confidence, 10);
    obj.confidence = isNaN(parsed) ? 50 : Math.max(0, Math.min(100, parsed));
  }
  
  // Normalize bias
  if (typeof obj.bias === 'string') {
    const lowerBias = obj.bias.toLowerCase();
    if (lowerBias.includes('bear') || lowerBias.includes('down') || lowerBias.includes('sell')) {
      obj.bias = 'bearish';
    } else if (lowerBias.includes('bull') || lowerBias.includes('up') || lowerBias.includes('buy')) {
      obj.bias = 'bullish';
    } else {
      obj.bias = 'neutral';
    }
  }
  
  // Normalize phase: use keyword matching for complex descriptions
  if (typeof obj.phase === 'string') {
    const lowerPhase = obj.phase.toLowerCase();
    if (lowerPhase.includes('breakout') || lowerPhase.includes('break')) {
      obj.phase = 'breakout';
    } else if (lowerPhase.includes('reversal') || lowerPhase.includes('turn') || lowerPhase.includes('change')) {
      obj.phase = 'reversal';
    } else if (lowerPhase.includes('consolidat') || lowerPhase.includes('range') || lowerPhase.includes('sideways') || lowerPhase.includes('flat')) {
      obj.phase = 'consolidation';
    } else if (lowerPhase.includes('trend') || lowerPhase.includes('uptrend') || lowerPhase.includes('downtrend')) {
      obj.phase = 'trending';
    } else {
      obj.phase = 'consolidation'; // safe default
    }
  }
  
  // Normalize recommendation
  if (typeof obj.recommendation === 'string') {
    const lowerRec = obj.recommendation.toLowerCase();
    if (lowerRec.includes('close') || lowerRec.includes('exit') || lowerRec.includes('sell')) {
      obj.recommendation = 'close';
    } else if (lowerRec.includes('partial') || lowerRec.includes('half')) {
      obj.recommendation = 'partial_close';
    } else if (lowerRec.includes('trail') || lowerRec.includes('stop')) {
      obj.recommendation = 'trail_stop';
    } else if (lowerRec.includes('hold') || lowerRec.includes('wait') || lowerRec.includes('buy') || lowerRec.includes('keep')) {
      obj.recommendation = 'hold';
    } else {
      obj.recommendation = 'none';
    }
  }
  
  // Normalize strength in S/R levels
  for (const key of ['support_levels', 'resistance_levels']) {
    if (Array.isArray(obj[key])) {
      for (const level of obj[key]) {
        if (typeof level?.strength === 'string') {
          const lowerStrength = level.strength.toLowerCase();
          if (lowerStrength.includes('strong') || lowerStrength.includes('major')) {
            level.strength = 'strong';
          } else if (lowerStrength.includes('moderate') || lowerStrength.includes('medium')) {
            level.strength = 'moderate';
          } else {
            level.strength = 'weak';
          }
        }
        // Normalize touches: convert string to number
        if (typeof level?.touches === 'string') {
          const parsed = parseInt(level.touches, 10);
          level.touches = isNaN(parsed) ? 1 : Math.max(1, Math.min(10, parsed));
        }
      }
    }
  }
  
  return obj;
}

function parseResponse(raw: string): TechnicalAnalysis | null {
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) {
    getLogger().warn({ raw: raw.slice(0, 200) }, "technicalAnalyst: no JSON found");
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json[0]);
  } catch (err) {
    getLogger().warn(
      { raw: raw.slice(0, 200), err: (err as Error).message },
      "technicalAnalyst: JSON.parse failed",
    );
    return null;
  }
  // Normalize enum values before validation (insurance for glm-5 etc.)
  const normalized = normalizeEnums(parsed);
  const cleaned = cleanSRLevels(normalized);
  return safeParseResponse(JSON.stringify(cleaned), TechnicalAnalysisSchema, { agent: "technical" });
}



@Injectable()
export class TechnicalAnalystService {
  constructor(private readonly client: LlmClientService) {}

  async run(payload: GoldbotPayload, symbol: string): Promise<TechnicalAnalysis> {
    const logger = getLogger();
    const profile = getSymbolProfile(symbol);
    const systemPrompt = buildSystemPrompt(profile);
    
    // Layered prompt: split semi-static from dynamic for better caching
    const semiStaticPrompt = buildSemiStaticData(payload.indicators, profile);
    const dynamicPrompt = buildDynamicData(payload, profile);

    // Try primary model first, fallback on failure
    let raw: string | null = null;
    const systemBlocks: SystemBlock[] = [
      { text: systemPrompt, cacheable: true },
    ];
    const userLayers: UserLayer[] = [
      { text: semiStaticPrompt, cacheable: true },
      { text: dynamicPrompt, cacheable: false },
    ];
    try {
      const result = await this.client.streamLayered(systemBlocks, userLayers);
      raw = result.content;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: errMsg, symbol }, "Primary LLM model failed, trying fallback model");

      try {
        raw = await this.client.invokeLayered(systemBlocks, userLayers);
        logger.info({ symbol }, "Fallback model succeeded");
      } catch (fallbackErr) {
        const fallbackErrMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        logger.error({ err: fallbackErrMsg, symbol }, "Fallback model also failed");
        raw = null;
      }
    }

    const result = raw ? parseResponse(raw) : null;

    if (!result) {
      logger.error({ symbol }, "Technical analysis parse failed — returning neutral fallback");
      // Return a minimal neutral fallback instead of throwing
      return {
        bias: "neutral",
        confidence: 10,
        phase: "consolidation",
        indicators_summary: "技术分析不可用 (Technical analysis unavailable)",
        support_levels: [],
        resistance_levels: [],
        recommendation: "none",
        rationale: "LLM API 超时或响应解析失败，无法进行有效分析 (LLM API timeout or parse failed)",
      } satisfies TechnicalAnalysis;
    }

    // Validate S/R prices against current market price
    const currentPrice = payload.market.bid || payload.market.ask || 0;
    if (currentPrice > 0) {
      result.support_levels = filterValidPrices(result.support_levels, currentPrice, profile, 'support');
      result.resistance_levels = filterValidPrices(result.resistance_levels, currentPrice, profile, 'resistance');
    }

    logger.info(
      { symbol, bias: result.bias, confidence: result.confidence, phase: result.phase },
      "Technical analysis complete",
    );

    return result;
  }
}

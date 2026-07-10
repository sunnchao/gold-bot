/**
 * MAO (Market Analysis Orchestrator) Arbitrator Agent —
 * reconciles technical, risk, and pending signal inputs into a final arbitration.
 */

import { Injectable } from "@nestjs/common";
import type { GoldbotPayload, PendingSignal } from "../types/goldbot.js";
import type {
  TechnicalAnalysis,
  RiskAssessment,
  ArbitrationResult,
} from "../types/analysis.js";
import { LlmClientService } from "../tools/llm-client.js";
import { getLogger } from "../utils/logger.js";
import { ArbitrationResultSchema } from "../types/schemas.js";
import { safeParseResponse } from "../utils/parse.js";
import {
  splitSections,
  extractFields,
  getEnumField,
  getNumberField,
  getStringField,
  getBooleanField,
  detectFormat,
} from "../utils/markdown-parser.js";
import { validateArbitrationResult } from "../utils/price-validator.js";
import { getSymbolProfile, type SymbolProfile } from "../config/symbol-profile.js";

function buildSystemPrompt(profile: SymbolProfile): string {
  return `You are the Market Analysis Orchestrator (MAO) arbitrator for ${profile.name} (${profile.symbol}).
Your job is to perform comprehensive multi-theory analysis, reconcile conflicting signals,
and produce a final arbitration result with specific trade recommendations.

Produce a structured MARKDOWN analysis with exactly these sections:
- ## ARBITRATION
- ## DOW THEORY
- ## WAVE THEORY
- ## CHANLUN THEORY
- ## TRADE RECOMMENDATION

ALL 5 sections are REQUIRED on every response.

## SYMBOL CHARACTERISTICS
- Instrument: ${profile.name}
- Price precision: ${profile.pricePrecision} decimal places
- Typical price range: ${profile.priceRangeHint}
- Volatility: ${profile.volatilityLevel}
- 1 pip = ${profile.pipValue}
- Suggested SL: ${profile.slAtrMultiplier}× ATR
- Suggested TP: ${profile.tpAtrMultiplier}× ATR

## CRITICAL OUTPUT RULES
1. Output structured MARKDOWN text using ## SECTION headers and - Key: Value format.
2. NEVER wrap output in \`\`\`code blocks\`\`\`. Do NOT output JSON.
3. ALL numeric fields MUST be valid finite numbers.
4. For text fields, output bilingual: Chinese first, English in parentheses.
5. Trade prices MUST be precise to ${profile.pricePrecision} decimal places.
6. All prices MUST be within ±50% of the current market price for THIS instrument.
7. NEVER output prices from a different instrument.

## PENDING ORDER PIPELINE (Critical Context)
When you output Action: open, the system will:
- Create a PENDING order (BUY_LIMIT/BUY_STOP/SELL_LIMIT/SELL_STOP) with 4-hour expiry
- The pending order is placed at the entry_price from your trade_recommendation
- It only triggers when price REACHES that level — it does NOT execute at current price
- Spread at signal time is IRRELEVANT for pending orders
- You can set entry_price FARTHER from current price for a better risk/reward setup

## WHAT MAKES A GOOD PENDING ORDER SIGNAL
- Clear trend direction on H4/H1 (ADX > 25, EMA aligned)
- Specific entry zone with favorable risk/reward (SL/TP ratio ≥ 1:2)
- The market does NOT need to be at the entry price right now
- Spread, consolidation, and low short-term ADX are NOT blockers for pending orders

## CONFIDENCE CALIBRATION RULES (Critical)
Base confidence calculation guidelines:
1. H1/M30 ADX > 40 + 多周期 RSI 同向 → Base confidence 75%
2. 波浪理论确认 (confirmed) + 谐波形态完成 → +10%
3. 缠论中枢突破 + 买卖点确认 → +10%
4. 多时间框架矛盾 (H1 看空 vs M15 超卖) → -15%
5. 单周期强信号但无共振 → -10%

**Time-frame signal weighting for direction decision:**
- H1 (35%) + M30 (35%) = 70% weight → PRIMARY trend direction
- H4 (15%) provides medium-term trend validation
- M15 (15%) provides entry timing, NOT trend reversal signal
- When H1 ADX > 40, M15 oversold/overbought is a TIMING consideration, NOT a direction override

**CRITICAL:**
- If H1 shows strong bearish trend (ADX > 40, MACD negative) and M15 is oversold (RSI < 30):
  - Direction: STILL BEARISH (hold or wait for confirmation, do NOT reverse to buy)
  - M15 oversold only means "caution for short-term bounce risk," not "trend reversal"
- Final confidence must reflect weighted consensus, not equal-vote averaging

## ANALYSIS FRAMEWORK — THREE THEORIES + TRADE RECOMMENDATION
You MUST analyze the market through THREE theoretical frameworks and produce a trade recommendation.

### 1. DOW THEORY (道氏理论)
- Primary Trend (D1/H4): accumulation, markup, distribution, markdown
- Secondary Trend (H1): Counter-trend corrections
- Short-term (M30/M15): Minor fluctuations
- Multi-TF Confirmation: All timeframes must agree for strong signals

### 2. ELLIOTT WAVE THEORY (波浪理论)
- Current Wave: Which wave is price in?
- Wave Direction: impulse_up, impulse_down, corrective, or unclear
- Wave Count: Describe the wave count
- Next Target: Where is the next wave likely to take price?

### 3. CHANLUN THEORY (缠论)
- Bi Direction: Current stroke direction
- Duan Direction: Current segment direction
- Zhongshu State: forming, active, breaking_up, breaking_down, or none
- Buy/Sell Point: buy_1, buy_2, buy_3, sell_1, sell_2, sell_3, or none

### 4. TRADE RECOMMENDATION (交易建议)
Based on the three theories, provide a SPECIFIC trade recommendation.

## REASONING REQUIREMENTS
The "Reasoning" field MUST be a detailed analysis (at least 6-8 sentences) covering all three theories, multi-timeframe alignment, risk state, and key levels.

## REQUIRED OUTPUT MARKDOWN FORMAT

## ARBITRATION
- Final Direction: buy | sell | hold | close
- Confidence: <0-100>
- Action: open | close | modify | hold
- Primary Contradiction: <string or empty>
- Phase: <string>
- United Front Analysis: <bilingual string>
- Reasoning: <bilingual string, at least 6-8 sentences covering all 3 theories>

## DOW THEORY
- Primary Trend: bullish | bearish | neutral
- Primary Phase: accumulation | markup | distribution | markdown
- Secondary Trend: bullish | bearish | neutral
- Short Term Trend: bullish | bearish | neutral
- Multi TF Confirm: true | false
- Rationale: <string>

## WAVE THEORY
- Current Wave: <string>
- Wave Direction: impulse_up | impulse_down | corrective | unclear
- Wave Count: <string>
- Next Target: <string>
- Confidence: <0-100>
- Rationale: <string>

## CHANLUN THEORY
- Trend: up | down | range
- Bi Direction: up | down | none
- Duan Direction: up | down | none
- Zhongshu State: forming | active | breaking_up | breaking_down | none
- Buy Sell Point: buy_1 | buy_2 | buy_3 | sell_1 | sell_2 | sell_3 | none
- Confidence: <0-100>
- Rationale: <string>

## TRADE RECOMMENDATION
- Direction: buy | sell | hold
- Entry Price: <number>
- Stop Loss: <number>
- Take Profit 1: <number>
- Take Profit 2: <number>
- Risk Reward Ratio: <number>
- Position Size Lots: <string e.g. 0.05-0.1>
- Rationale: <string>`;
}

interface ArbitrationInput {
  technical?: TechnicalAnalysis;
  risk?: RiskAssessment;
  payload: GoldbotPayload;
  pendingSignal?: PendingSignal;
}

function buildPrompt(input: ArbitrationInput, profile: SymbolProfile): string {
  const { technical, risk, payload, pendingSignal } = input;
  const price = payload.market.bid || payload.market.ask || 0;

  // Build multi-timeframe indicator summary
  const indicators = payload.indicators ?? {};
  const tfSummary = ['M15', 'M30', 'H1', 'H4']
    .map((tf) => {
      const ind = indicators[tf] ?? indicators[tf.toLowerCase()];
      if (!ind) return `${tf}: no data`;
      return `${tf}: close=${ind.close} open=${ind.open} high=${ind.high} low=${ind.low} | EMA20=${ind.ema20} EMA50=${ind.ema50}${ind.ema200 ? ` EMA200=${ind.ema200}` : ''} | RSI=${ind.rsi} ADX=${ind.adx} ATR=${ind.atr} | MACD=${ind.macd} signal=${ind.macd_signal} hist=${ind.macd_hist} | BB: upper=${ind.bb_upper} mid=${ind.bb_middle} lower=${ind.bb_lower} | Stoch: K=${ind.stoch_k} D=${ind.stoch_d}${ind.fib_236 ? ` | Fib: 23.6%=${ind.fib_236} 38.2%=${ind.fib_382} 50%=${ind.fib_500} 61.8%=${ind.fib_618}` : ''}${ind.pp ? ` | Pivot: PP=${ind.pp} R1=${ind.r1} S1=${ind.s1}` : ''}`;
    })
    .join('\n');

  return `Arbitrate ${profile.name} (${payload.market.symbol}) analysis:

## SYMBOL CONTEXT
- Instrument: ${profile.name} (${profile.symbol})
- Current Price: ${price.toFixed(profile.pricePrecision)}
- Price Range: ${(price * 0.5).toFixed(profile.pricePrecision)} - ${(price * 1.5).toFixed(profile.pricePrecision)}

Technical Analysis: ${JSON.stringify(technical ?? "unavailable")}
Risk Assessment: ${JSON.stringify(risk ?? "unavailable")}
Pending Signal: ${pendingSignal ? JSON.stringify(pendingSignal) : "none"}

Account: Balance=${payload.account.balance}, Equity=${payload.account.equity}, Positions=${payload.positions.length}
Market: Price=${price.toFixed(profile.pricePrecision)}, Spread=${payload.market.spread}
Market Status: ${JSON.stringify(payload.market_status)}
Strategy: ${JSON.stringify(payload.strategy_mapping)}
Positions: ${JSON.stringify(payload.positions)}

## Multi-Timeframe Indicators (for Dow/Wave/Chanlun analysis)
${tfSummary}

Analyze alignment and conflicts between:
1. Technical bias vs pending signal direction
2. Risk level vs suggested position size
3. Timeframe agreement across M15, M30, H1, H4
4. Dow Theory trend alignment across timeframes
5. Elliott Wave structure from indicator patterns
6. Chanlun Bi/Duan/Zhongshu from price structure

Perform ALL THREE theories (Dow Theory, Elliott Wave, Chanlun) analysis and provide a specific trade recommendation with exact entry/SL/TP prices.

IMPORTANT: All prices in your response MUST be appropriate for ${profile.symbol} (current price ~${price.toFixed(profile.pricePrecision)}). Do NOT output prices from a different instrument.

Respond with structured MARKDOWN using ## ARBITRATION, ## DOW THEORY, ## WAVE THEORY, ## CHANLUN THEORY, and ## TRADE RECOMMENDATION sections.
IMPORTANT: All prices in your response MUST be appropriate for ${profile.symbol} (current price ~${price.toFixed(profile.pricePrecision)}). Do NOT output prices from a different instrument.`;
}

function parseMarkdownArbitration(raw: string): ArbitrationResult | null {
  const sections = splitSections(raw);

  const arbSection = sections.get('arbitration') || '';
  const dowSection = sections.get('dow theory') || sections.get('dow_theory') || '';
  const waveSection = sections.get('wave theory') || sections.get('wave_theory') || '';
  const chanlunSection = sections.get('chanlun theory') || sections.get('chanlun_theory') || '';
  const tradeSection = sections.get('trade recommendation') || sections.get('trade_recommendation') || '';

  if (!arbSection) return null;

  const arbFields = extractFields(arbSection);
  const dowFields = extractFields(dowSection);
  const waveFields = extractFields(waveSection);
  const chanlunFields = extractFields(chanlunSection);
  const tradeFields = extractFields(tradeSection);

  return {
    final_direction: getEnumField(arbFields, 'final_direction', ['buy', 'sell', 'hold', 'close'] as const, 'hold'),
    confidence: getNumberField(arbFields, 'confidence', 0, { min: 0, max: 100 }),
    primary_contradiction: getStringField(arbFields, 'primary_contradiction', ''),
    phase: getStringField(arbFields, 'phase', 'unknown'),
    reasoning: getStringField(arbFields, 'reasoning', ''),
    action: getEnumField(arbFields, 'action', ['open', 'close', 'modify', 'hold'] as const, 'hold'),
    united_front_analysis: getStringField(arbFields, 'united_front_analysis', ''),
    dow_theory: {
      primary_trend: getEnumField(dowFields, 'primary_trend', ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
      primary_phase: getEnumField(dowFields, 'primary_phase', ['accumulation', 'markup', 'distribution', 'markdown'] as const, 'accumulation'),
      secondary_trend: getEnumField(dowFields, 'secondary_trend', ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
      short_term_trend: getEnumField(dowFields, 'short_term_trend', ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
      multi_tf_confirm: getBooleanField(dowFields, 'multi_tf_confirm', false),
      rationale: getStringField(dowFields, 'rationale', ''),
    },
    wave_theory: {
      current_wave: getStringField(waveFields, 'current_wave', ''),
      wave_direction: getEnumField(waveFields, 'wave_direction', ['impulse_up', 'impulse_down', 'corrective', 'unclear'] as const, 'unclear'),
      wave_count: getStringField(waveFields, 'wave_count', ''),
      next_target: getStringField(waveFields, 'next_target', ''),
      confidence: getNumberField(waveFields, 'confidence', 0, { min: 0, max: 100 }),
      rationale: getStringField(waveFields, 'rationale', ''),
    },
    chanlun_theory: {
      trend: getEnumField(chanlunFields, 'trend', ['up', 'down', 'range'] as const, 'range'),
      bi_direction: getEnumField(chanlunFields, 'bi_direction', ['up', 'down', 'none'] as const, 'none'),
      duan_direction: getEnumField(chanlunFields, 'duan_direction', ['up', 'down', 'none'] as const, 'none'),
      zhongshu_state: getEnumField(chanlunFields, 'zhongshu_state', ['forming', 'active', 'breaking_up', 'breaking_down', 'none'] as const, 'none'),
      buy_sell_point: getEnumField(chanlunFields, 'buy_sell_point', ['buy_1', 'buy_2', 'buy_3', 'sell_1', 'sell_2', 'sell_3', 'none'] as const, 'none'),
      confidence: getNumberField(chanlunFields, 'confidence', 0, { min: 0, max: 100 }),
      rationale: getStringField(chanlunFields, 'rationale', ''),
    },
    trade_recommendation: {
      direction: getEnumField(tradeFields, 'direction', ['buy', 'sell', 'hold'] as const, 'hold'),
      entry_price: getNumberField(tradeFields, 'entry_price', 0),
      stop_loss: getNumberField(tradeFields, 'stop_loss', 0),
      take_profit_1: getNumberField(tradeFields, 'take_profit_1', 0),
      take_profit_2: getNumberField(tradeFields, 'take_profit_2', 0),
      risk_reward_ratio: getNumberField(tradeFields, 'risk_reward_ratio', 0),
      position_size_lots: getStringField(tradeFields, 'position_size_lots', '0.01'),
      rationale: getStringField(tradeFields, 'rationale', ''),
    },
  };
}

function parseResponse(raw: string): ArbitrationResult | null {
  // Try Markdown first
  const format = detectFormat(raw);
  if (format === 'markdown') {
    const mdResult = parseMarkdownArbitration(raw);
    if (mdResult) return mdResult;
  }

  // JSON fallback
  return safeParseResponse(raw, ArbitrationResultSchema, { agent: "mao" });
}

@Injectable()
export class MaoArbitratorService {
  constructor(private readonly client: LlmClientService) {}

  async run(input: ArbitrationInput, symbol: string): Promise<ArbitrationResult> {
    const logger = getLogger();
    const profile = getSymbolProfile(symbol);
    const systemPrompt = buildSystemPrompt(profile);
    const prompt = buildPrompt(input, profile);
    const raw = await this.client.streamInvoke(prompt, systemPrompt);
    let result = parseResponse(raw);

    if (!result) {
      logger.error({ symbol }, "MAO arbitration parse failed — returning hold fallback");
      return {
        final_direction: "hold",
        confidence: 0,
        primary_contradiction: "",
        phase: "unknown",
        reasoning: "仲裁解析失败 (Arbitration parse failed)",
        action: "hold",
        united_front_analysis: "",
      } satisfies ArbitrationResult;
    }

    // Apply trade-level business validation
    const currentPrice = input.payload?.market?.bid || input.payload?.market?.ask || 0;
    if (currentPrice > 0 && result.trade_recommendation && result.trade_recommendation.direction !== 'hold') {
      const validation = validateArbitrationResult(result, currentPrice, profile);
      if (validation.warnings.length > 0) {
        logger.warn({ symbol, warnings: validation.warnings }, "MAO arbitration: trade validation warnings");
      }
      if (!validation.valid && validation.fixedArbitration) {
        logger.warn({ symbol }, "MAO arbitration: trade downgraded to hold due to invalid SL/TP");
        result = validation.fixedArbitration;
      } else if (validation.fixedArbitration) {
        result = validation.fixedArbitration;
      }
    }

    logger.info(
      {
        symbol,
        direction: result.final_direction,
        action: result.action,
        confidence: result.confidence,
      },
      "MAO arbitration complete",
    );

    return result;
  }
}

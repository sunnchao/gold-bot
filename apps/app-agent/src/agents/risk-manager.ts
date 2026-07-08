/**
 * Risk Manager Agent — evaluates risk exposure given technical + S/R analysis.
 */

import { Injectable } from '@nestjs/common';
import type { GoldbotPayload } from '../types/goldbot.js';
import type { TechnicalAnalysis, RiskAssessment } from '../types/analysis.js';
import { LlmClientService } from '../tools/llm-client.js';
import type { SystemBlock, UserLayer } from '../tools/llm-client.js';
import { getLogger } from '../utils/logger.js';
import { selectIndicator } from '../utils/goldbot-indicators.js';
import { RiskAssessmentSchema } from '../types/schemas.js';
import { safeParseResponse } from '../utils/parse.js';
import {
  splitSections,
  extractFields,
  extractListItems,
  getEnumField,
  getNumberField,
  getBooleanField,
  extractWarnings,
  detectFormat,
} from '../utils/markdown-parser.js';
import { getSymbolProfile, type SymbolProfile } from '../config/symbol-profile.js';
import { stableStringify } from '../utils/stable-stringify.js';

function buildSystemPrompt(profile: SymbolProfile): string {
  return `You are a risk management specialist for all forex/commodity instruments.
Given technical analysis, account data and market data, produce a structured MARKDOWN risk assessment.

## SYMBOL CHARACTERISTICS
- Instrument: ${profile.name}
- Symbol code: ${profile.symbol}
- Price precision: ${profile.pricePrecision} decimal places
- Typical price range: ${profile.priceRangeHint}
- Volatility: ${profile.volatilityLevel}
- 1 pip = ${profile.pipValue}
- Suggested SL: ${profile.slAtrMultiplier}× ATR
- Suggested TP: ${profile.tpAtrMultiplier}× ATR

## CRITICAL OUTPUT RULES
1. Output structured MARKDOWN text using ## RISK section header and - Key: Value format.
2. NEVER wrap output in \`\`\`code blocks\`\`\`. Do NOT output JSON.
3. ALL numeric fields MUST be valid numbers (never null, undefined, or empty string).
4. For text fields, output bilingual: Chinese first, English in parentheses.
5. **CRITICAL: suggestedSL and suggestedTP MUST be absolute price values, NOT relative descriptions like "stop loss 50 points" or "take profit 100 points".**
6. **suggestedSL/suggestedTP must be the ACTUAL price level on the chart, not a distance or point count from entry.**

## INSTRUMENT PRICE ACCURACY ENFORCEMENT
CRITICAL: Before outputting ANY price value, you MUST verify it matches the ACTUAL instrument you are analyzing.
- The symbol being analyzed is: ${profile.symbol} — typical price range is ${profile.priceRangeHint}
- ATR for this instrument is typically ${JSON.stringify(profile.typicalAtrRange.H1)} (H1 timeframe)
- STOP and THINK: Does your suggestedSL/suggestedTP match the expected magnitude for THIS instrument?
- Double-check: If ${profile.symbol} trades around ${profile.priceRangeHint}, a suggestedSL of 250 would be IMPOSSIBLE for this instrument
- WRONG examples: suggestingSL=250 for US100 (should be ~15000-25000), suggestingSL=2000 for GBPJPY (should be ~100-250), etc.
- CORRECT: suggestedSL must be within the SAME ORDER OF MAGNITUDE as the current price for ${profile.symbol}
- If you catch yourself producing a price that doesn't match the instrument's typical range, CORRECT IT immediately
- This is a HARD REQUIREMENT — mistakes in price magnitude are unacceptable

## REQUIRED OUTPUT MARKDOWN FORMAT

## RISK
- Risk Level: low | medium | high | extreme
- Max Position Size: <number lots>
- Suggested SL: <absolute price number>
- Suggested TP: <absolute price number>
- Warnings: <semicolon-separated bilingual strings>
- Add On: true | false

## RISK CALCULATION GUIDELINES
- suggestedSL should be placed below the nearest support (for long) or above nearest resistance (for short), with an ATR buffer
- CRITICAL: For a LONG position, suggestedSL MUST be BELOW the current price. For a SHORT position, suggestedSL MUST be ABOVE the current price.
- suggestedTP should target the next significant resistance (for long) or support (for short)
- maxPositionSize should ensure that a stop-loss hit does not exceed 2% of account equity
- Risk/reward ratio should be at least 1:2 for the suggested SL/TP
- All prices MUST be within ±50% of the current market price for THIS instrument
- NEVER output prices from a different instrument
- ALWAYS verify: suggestedSL is in the SAME ORDER OF MAGNITUDE as ${profile.symbol}'s typical price (${profile.priceRangeHint})
- **ABSOLUTE PRICE ONLY: suggestedSL and suggestedTP MUST be the exact price level, NEVER a relative description like "50 points below entry" or "100 points above"**

## ADD-ON (加仓) GUIDELINES
- Set Add On: true ONLY when:
  1. Existing positions are in profit (positive PnL)
  2. The market shows strong continuation signals
  3. Adding would not concentrate risk excessively
- Default is false — only set true when conditions clearly support adding.

## ANCHOR REFERENCE SYSTEM (锚点引用)
The following anchors will be provided in subsequent messages.
You MUST reference them directly without recalculating.

- {{TECHNICAL_STRUCT}}: Pre-computed technical analysis structure
  - Contains: bias, confidence, phase, support_levels[], resistance_levels[]
  - Use S/R levels directly for SL/TP placement
  - Do NOT re-analyze technical structure
- {{ACCOUNT_STATE}}: Real-time account snapshot
  - Contains: balance, equity, leverage, open positions
- {{MARKET_STATE}}: Real-time market snapshot
  - Contains: current price, spread, ATR(H1)`;
}


/**
 * Changes when technical analysis or market structure updates.
 */
function buildSemiStaticData(
  technical: TechnicalAnalysis | undefined,
  profile: SymbolProfile,
): string {
  return `## SEMI-STATIC RISK CONTEXT (changes on bar/technical update)

Instrument: ${profile.name} (${profile.symbol})
Volatility: ${profile.volatilityLevel}
Suggested SL: ${profile.slAtrMultiplier}x ATR
Suggested TP: ${profile.tpAtrMultiplier}x ATR

Technical Analysis Structure:
${technical ? stableStringify(technical) : 'Unavailable'}

Risk Rules Reference:
- suggestedSL below nearest support (long) or above nearest resistance (short), with ATR buffer
- suggestedTP targets next significant resistance (long) or support (short)
- maxPositionSize: stop-loss hit <= 2% of account equity
- Risk/reward ratio >= 1:2
- All prices within +-50% of current market price`;
}

/**
 * Dynamic layer: real-time account, positions, market data.
 * Changes every request.
 */
function buildDynamicData(
  payload: GoldbotPayload,
  profile: SymbolProfile,
): string {
  const { account, market, positions } = payload;
  const h1 = selectIndicator(payload.indicators, 'H1', 'h1');
  const currentPrice = market.bid || market.ask || 0;

  const positionSummary = positions.length === 0
    ? 'No open positions'
    : `${positions.length} open position(s): ${positions.map((p: any) => `${p.direction} lots @ ${p.entry_price}, PnL=${p.profit}`).join('; ')}`;

  return `## REAL-TIME DATA (changes every request)

CRITICAL REMINDER: You are analyzing ${profile.symbol} — typical price range: ${profile.priceRangeHint}
Current Price: ${currentPrice.toFixed(profile.pricePrecision)}

Account:
- Balance: ${account.balance} ${account.currency}
- Equity: ${account.equity}
- Leverage: 1:${account.leverage}

Positions:
${positionSummary}
Current position side: ${positions.length > 0 ? positions[0].direction : 'none'}

Market:
- Spread: ${market.spread} points
- ATR(H1): ${h1.atr}

INSTRUMENT VERIFICATION CHECK:
- Symbol: ${profile.symbol}
- Current Price: ~${currentPrice.toFixed(profile.pricePrecision)} (should be in range ${profile.priceRangeHint})
- If your suggestedSL/suggestedTP does NOT match this magnitude, YOU HAVE THE WRONG INSTRUMENT
- STOP and recalculate using the CORRECT prices for ${profile.symbol}
- **ABSOLUTE PRICE RULE: suggestedSL and suggestedTP MUST be actual price levels, NEVER relative descriptions like "50 points" or "100 points below"**

Assess risk and respond with ## RISK section.`;
}
function buildPrompt(
  technical: TechnicalAnalysis | undefined,
  payload: GoldbotPayload,
  profile: SymbolProfile,
): string {
  const { account, market, positions } = payload;
  const h1 = selectIndicator(payload.indicators, 'H1', 'h1');
  const currentPrice = market.bid || market.ask || 0;

  const positionSummary = positions.length === 0
    ? 'No open positions'
    : `${positions.length} open position(s): ${positions.map(p => `${p.direction} ${p.lots} lots @ ${p.entry_price}, PnL=${p.profit}`).join('; ')}`;

  return `Assess risk for ${profile.name} (${market.symbol}):

## SYMBOL CONTEXT
- Instrument: ${profile.name} (${profile.symbol})
- Current Price: ${currentPrice.toFixed(profile.pricePrecision)}
- Volatility: ${profile.volatilityLevel}

## Account
Balance: ${account.balance} ${account.currency}, Equity: ${account.equity}, Leverage: 1:${account.leverage}

## Positions
${positionSummary}
Current position side: ${positions.length > 0 ? positions[0].direction : 'none'}

## Market
Spread: ${market.spread} points, ATR(H1): ${h1.atr}

## Technical Analysis
${technical ? stableStringify(technical) : 'Unavailable'}

Respond with structured MARKDOWN using ## RISK section.
Remember: suggestedSL and suggestedTP MUST be prices appropriate for ${profile.symbol} (current price ~${currentPrice.toFixed(profile.pricePrecision)}), NOT for any other instrument.
**CRITICAL: suggestedSL and suggestedTP MUST be absolute price values, NEVER relative descriptions like "stop loss 50 points" or "take profit 100 points".**`;
}

function parseMarkdownRisk(raw: string): RiskAssessment | null {
  const sections = splitSections(raw);
  const riskSection = sections.get('risk') || '';
  if (!riskSection) return null;
  const fields = extractFields(riskSection);
  const listItems = extractListItems(riskSection);

  return {
    riskLevel: getEnumField(fields, 'risk_level', ['low', 'medium', 'high', 'extreme'] as const, 'high'),
    maxPositionSize: getNumberField(fields, 'max_position_size', 0),
    suggestedSL: getNumberField(fields, 'suggested_sl', 0),
    suggestedTP: getNumberField(fields, 'suggested_tp', 0),
    warnings: extractWarnings(fields, listItems),
    addOn: getBooleanField(fields, 'add_on', false),
  };
}

function parseResponse(raw: string): RiskAssessment | null {
  // Try Markdown first
  const format = detectFormat(raw);
  if (format === 'markdown') {
    const mdResult = parseMarkdownRisk(raw);
    if (mdResult) return mdResult;
  }

  // JSON fallback
  return safeParseResponse(raw, RiskAssessmentSchema, { agent: 'risk' });
}

@Injectable()
export class RiskManagerService {
  constructor(private readonly client: LlmClientService) {}

  async run(technical: TechnicalAnalysis | undefined, payload: GoldbotPayload, symbol: string): Promise<RiskAssessment> {
    const logger = getLogger();
    const profile = getSymbolProfile(symbol);
    const systemPrompt = buildSystemPrompt(profile);

    // Layered prompts for better caching
    const semiStaticData = buildSemiStaticData(technical, profile);
    const dynamicData = buildDynamicData(payload, profile);

    let raw: string;
    const systemBlocks: SystemBlock[] = [
      { text: systemPrompt, cacheable: true },
    ];
    const userLayers: UserLayer[] = [
      { text: semiStaticData, cacheable: true },
      { text: dynamicData, cacheable: false },
    ];
    try {
      const result = await this.client.streamLayered(systemBlocks, userLayers);
      raw = result.content;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: errMsg, symbol }, 'Risk manager: primary model failed, trying fallback');
      try {
        raw = await this.client.invokeLayered(systemBlocks, userLayers);
      } catch (fallbackErr) {
        const fallbackErrMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        logger.error({ err: fallbackErrMsg, symbol }, 'Risk manager: fallback also failed');
        throw fallbackErr;
      }
    }

    const result = parseResponse(raw);

    if (!result) {
      logger.error({ symbol }, 'Risk assessment parse failed — returning high-risk fallback');
      return {
        riskLevel: 'high',
        maxPositionSize: 0,
        suggestedSL: 0,
        suggestedTP: 0,
        warnings: ['风险评估解析失败，建议不开仓 (Risk assessment parse failed, recommend no position)'],
      } satisfies RiskAssessment;
    }

    // VALIDATION: Verify suggestedSL/suggestedTP are within the instrument's reasonable price range
    if (profile.priceRange) {
      const [min, max] = profile.priceRange;
      if (result.suggestedSL !== undefined && result.suggestedSL !== 0) {
        if (result.suggestedSL < min || result.suggestedSL > max) {
          const originalSL = result.suggestedSL;
          result.suggestedSL = 0;
          logger.warn(
            { symbol, originalSL, expectedRange: [min, max] },
            'suggestedSL out of instrument price range — rejecting AI stop loss',
          );
          result.warnings = result.warnings || [];
          result.warnings.push(`AI止损 ${originalSL} 超出${symbol}合理范围(${min}-${max})，已拒绝`);
        }
      }
      if (result.suggestedTP !== undefined && result.suggestedTP !== 0) {
        if (result.suggestedTP < min || result.suggestedTP > max) {
          const originalTP = result.suggestedTP;
          result.suggestedTP = 0;
          logger.warn(
            { symbol, originalTP, expectedRange: [min, max] },
            'suggestedTP out of instrument price range — rejecting AI take profit',
          );
          result.warnings = result.warnings || [];
          result.warnings.push(`AI止盈 ${originalTP} 超出${symbol}合理范围(${min}-${max})，已拒绝`);
        }
      }
    }

    logger.info({ symbol, riskLevel: result.riskLevel }, 'Risk assessment complete');
    return result;
  }
}

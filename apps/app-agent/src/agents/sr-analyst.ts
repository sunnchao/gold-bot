/**
 * Support/Resistance Analyst Agent — identifies key price levels via LLM.
 */

import { Injectable } from "@nestjs/common";
import type { GoldbotPayload } from "../types/goldbot.js";
import type { SRLevels } from "../types/analysis.js";
import { LlmClientService } from "../tools/llm-client.js";
import { getLogger } from "../utils/logger.js";
import { findPsychologicalLevels } from "../tools/sr-calculator.js";
import { selectIndicator } from "../utils/goldbot-indicators.js";
import { SRLevelsSchema, cleanSRLevels } from "../types/schemas.js";
import { safeParseResponse } from "../utils/parse.js";
import {
  splitSections,
  extractFields,
  extractListItems,
  getEnumField,
  getStringField,
  parseSRLevels,
  detectFormat,
} from "../utils/markdown-parser.js";
import { getSymbolProfile, type SymbolProfile } from "../config/symbol-profile.js";
import { filterValidPrices } from "../utils/price-validator.js";

function buildSystemPrompt(profile: SymbolProfile): string {
  return `You are a support/resistance analysis specialist for ${profile.name} (${profile.symbol}).
Given market data and pre-computed S/R levels, produce a structured MARKDOWN analysis.

## SYMBOL CHARACTERISTICS
- Instrument: ${profile.name}
- Price precision: ${profile.pricePrecision} decimal places
- Typical price range: ${profile.priceRangeHint}
- Current asset class: ${profile.assetClass}

## CRITICAL OUTPUT RULES
1. Output structured MARKDOWN text using ## SECTION headers and - Key: Value format.
2. NEVER wrap output in \`\`\`code blocks\`\`\`. Do NOT output JSON.
3. ALL numeric fields MUST be valid numbers (never null, undefined, or empty string).
4. For text fields, output bilingual: Chinese first, English in parentheses.
5. Support/Resistance levels use pipe-delimited format: price | type | strength | timeframe | touches

## PRICE VALIDATION
- price MUST be extracted from provided Fibonacci/Pivot/Psychological levels.
- If a level is not available, omit it entirely.
- NEVER guess or hallucinate a price value.
- All prices MUST be within ±50% of the current market price for THIS instrument.
- NEVER output prices from a different instrument (e.g. do NOT output gold prices for GBPJPY).

## REQUIRED OUTPUT MARKDOWN FORMAT

## SUPPORT LEVELS
- <price> | support | strong|moderate|weak | <timeframe e.g. H1> | <touches 1-10>
- <price> | support | strong|moderate|weak | <timeframe e.g. H4> | <touches 1-10>

## RESISTANCE LEVELS
- <price> | resistance | strong|moderate|weak | <timeframe e.g. H1> | <touches 1-10>
- <price> | resistance | strong|moderate|weak | <timeframe e.g. H4> | <touches 1-10>

## SUMMARY
- Recommendation: <bilingual string>
- Rationale: <bilingual string>`;
}

function buildPrompt(payload: GoldbotPayload, profile: SymbolProfile, strategy?: string): string {
  const { market, indicators } = payload;
  
  // 所有策略统一使用 H1/H4 分析周期（至少 15 分钟图数据）
  const tf1 = selectIndicator(indicators, 'H1', 'h1');
  const tf2 = selectIndicator(indicators, 'H4', 'h4');
  const tf1Label = 'H1';
  const tf2Label = 'H4';

  const fibLevels = {
    fib_236: tf1.fib_236,
    fib_382: tf1.fib_382,
    fib_500: tf1.fib_500,
    fib_618: tf1.fib_618,
    fib_786: tf1.fib_786,
  };

  const pivotLevels = {
    pp: tf1.pp,
    r1: tf1.r1,
    s1: tf1.s1,
  };

  const currentPrice = market.bid || market.ask || 0;
  const psychLevels = findPsychologicalLevels(currentPrice, 100);

  return `Analyze ${profile.name} (${market.symbol}) support/resistance (strategy: ${strategy || 'default'}):

## SYMBOL CONTEXT
- Instrument: ${profile.name} (${profile.symbol})
- Current Price: ${currentPrice.toFixed(profile.pricePrecision)}
- Price Range: ${(currentPrice * 0.5).toFixed(profile.pricePrecision)} - ${(currentPrice * 1.5).toFixed(profile.pricePrecision)}

${tf1Label} Levels:
  High=${tf1.high}, Low=${tf1.low}, Open=${tf1.open}, Close=${tf1.close}
  EMA20=${tf1.ema20}, EMA50=${tf1.ema50}, EMA200=${tf1.ema200}
  BB Upper=${tf1.bb_upper} Lower=${tf1.bb_lower}

${tf2Label} Levels:
  High=${tf2.high}, Low=${tf2.low}, Open=${tf2.open}, Close=${tf2.close}
  EMA20=${tf2.ema20}, EMA50=${tf2.ema50}
  BB Upper=${tf2.bb_upper} Lower=${tf2.bb_lower}

Fibonacci Levels: ${JSON.stringify(fibLevels)}

Pivot Points: ${JSON.stringify(pivotLevels)}

Psychological Levels (nearby): ${JSON.stringify(psychLevels.slice(0, 10))}

Respond with structured MARKDOWN using ## SUPPORT LEVELS, ## RESISTANCE LEVELS, and ## SUMMARY sections.
Use pipe-delimited format for levels: price | type | strength | timeframe | touches`;
}

// 从 payload 中提取当前活跃策略
function extractStrategy(payload: GoldbotPayload): string | undefined {
  // 优先从持仓中获取策略
  if (payload.positions?.length > 0) {
    return payload.positions[0].strategy;
  }
  // 其次从 strategy_mapping 获取第一个策略
  if (payload.strategy_mapping && Object.keys(payload.strategy_mapping).length > 0) {
    return Object.values(payload.strategy_mapping)[0];
  }
  return undefined;
}

function parseMarkdownSR(raw: string): SRLevels | null {
  const sections = splitSections(raw);
  if (sections.size < 1) return null;

  // Extract pipe-delimited levels from SUPPORT LEVELS and RESISTANCE LEVELS sections
  const supportSection = sections.get('support levels') || sections.get('support_levels') || '';
  const resistanceSection = sections.get('resistance levels') || sections.get('resistance_levels') || '';
  const summarySection = sections.get('summary') || '';

  const supportLines = extractListItems(supportSection).filter(l => l.includes('|'));
  const resistanceLines = extractListItems(resistanceSection).filter(l => l.includes('|'));

  const summaryFields = extractFields(summarySection);

  return {
    support_levels: parseSRLevels(supportLines, 'support'),
    resistance_levels: parseSRLevels(resistanceLines, 'resistance'),
    recommendation: getStringField(summaryFields, 'recommendation', ''),
    rationale: getStringField(summaryFields, 'rationale', ''),
  };
}

function parseResponse(raw: string): SRLevels | null {
  // Try Markdown first
  const format = detectFormat(raw);
  if (format === 'markdown') {
    const mdResult = parseMarkdownSR(raw);
    if (mdResult && (mdResult.support_levels.length > 0 || mdResult.resistance_levels.length > 0)) {
      return mdResult;
    }
  }

  // JSON fallback
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) {
    getLogger().warn({ raw: raw.slice(0, 200) }, "srAnalyst: no JSON found");
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json[0]);
  } catch (err) {
    getLogger().warn(
      { raw: raw.slice(0, 200), err: (err as Error).message },
      "srAnalyst: JSON.parse failed",
    );
    return null;
  }
  const cleaned = cleanSRLevels(parsed);
  return safeParseResponse(JSON.stringify(cleaned), SRLevelsSchema, { agent: "sr" });
}

@Injectable()
export class SrAnalystService {
  constructor(private readonly client: LlmClientService) {}

  async run(payload: GoldbotPayload, symbol: string): Promise<SRLevels> {
    const logger = getLogger();
    const profile = getSymbolProfile(symbol);
    const systemPrompt = buildSystemPrompt(profile);
    const strategy = extractStrategy(payload);
    const prompt = buildPrompt(payload, profile, strategy);
    const raw = await this.client.streamInvoke(prompt, systemPrompt);
    const result = parseResponse(raw);

    if (!result) {
      logger.error({ symbol }, "S/R analysis parse failed — returning empty fallback");
      return {
        support_levels: [],
        resistance_levels: [],
        recommendation: "",
        rationale: "S/R 解析失败 (S/R analysis parse failed)",
      } satisfies SRLevels;
    }

    // Validate prices against current market price
    const currentPrice = payload.market.bid || payload.market.ask || 0;
    if (currentPrice > 0) {
      result.support_levels = filterValidPrices(result.support_levels, currentPrice, profile, 'support');
      result.resistance_levels = filterValidPrices(result.resistance_levels, currentPrice, profile, 'resistance');
    }

    logger.info(
      {
        symbol,
        support: result.support_levels.length,
        resistance: result.resistance_levels.length,
        strategy,
      },
      "S/R analysis complete",
    );

    return result;
  }
}

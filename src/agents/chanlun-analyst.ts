import { Injectable } from '@nestjs/common';
import type { ChanlunAnalysis, ChanlunAnalystResult } from '../types/analysis.js';
import { ChanlunAnalystResultSchema } from '../types/schemas.js';
import { LlmClientService } from '../tools/llm-client.js';
import { getLogger } from '../utils/logger.js';
import { safeParseResponse } from '../utils/parse.js';
import { getSymbolProfile, type SymbolProfile } from '../config/symbol-profile.js';

function buildSystemPrompt(profile: SymbolProfile): string {
  return `You are a Chanlun analyst for ${profile.name} (${profile.symbol}).
Given a computed ChanlunAnalysis structure, produce a JSON ChanlunAnalystResult object.

## SYMBOL CHARACTERISTICS
- Instrument: ${profile.name}
- Price precision: ${profile.pricePrecision} decimal places
- Typical price range: ${profile.priceRangeHint}
- Volatility: ${profile.volatilityLevel}

## CRITICAL OUTPUT RULES
1. Output ONLY valid JSON. No markdown, no code blocks, no explanation outside JSON.
2. ALL enum fields MUST match the schema exactly.
3. confidence MUST be an integer from 0 to 100.

## STRICT JSON SCHEMA
{
  "trend": "up" | "down" | "range",
  "strength": "strong" | "moderate" | "weak",
  "latest_signal": "buy" | "sell" | "hold",
  "hub_state": "forming" | "active" | "none",
  "confidence": <number 0-100>,
  "rationale": "<string>"
}`;
}

function buildPrompt(analysis: ChanlunAnalysis, profile: SymbolProfile): string {
  return `Analyze the following Chanlun structure for ${profile.name} (${profile.symbol}):

Current price range context: ${profile.priceRangeHint}

Processed bars: ${JSON.stringify(analysis.processedBars)}
Fractals: ${JSON.stringify(analysis.fractals)}
Strokes: ${JSON.stringify(analysis.strokes)}
Hubs: ${JSON.stringify(analysis.hubs)}

Respond with a JSON ChanlunAnalystResult object. Base the answer only on the provided structure.`;
}

function parseResponse(raw: string): ChanlunAnalystResult | null {
  return safeParseResponse(raw, ChanlunAnalystResultSchema, { agent: 'chanlun' });
}

@Injectable()
export class ChanlunAnalystService {
  constructor(private readonly client: LlmClientService) {}

  async run(analysis: ChanlunAnalysis, symbol: string): Promise<ChanlunAnalystResult> {
    const logger = getLogger();
    const profile = getSymbolProfile(symbol);
    const systemPrompt = buildSystemPrompt(profile);
    const prompt = buildPrompt(analysis, profile);
    const raw = await this.client.streamInvoke(prompt, systemPrompt);
    const parsed = parseResponse(raw);

    if (!parsed) {
      logger.error({ symbol }, 'Chanlun analysis parse failed — returning neutral fallback');
      return {
        trend: 'range',
        strength: 'weak',
        latest_signal: 'hold',
        hub_state: 'none',
        confidence: 0,
        rationale: '缠论分析解析失败 (Chanlun analysis parse failed)',
      };
    }

    logger.info(
      {
        symbol,
        trend: parsed.trend,
        latestSignal: parsed.latest_signal,
        confidence: parsed.confidence,
      },
      'Chanlun analysis complete',
    );

    return parsed;
  }
}

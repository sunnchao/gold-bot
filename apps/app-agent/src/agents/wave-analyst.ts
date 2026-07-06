import { Injectable } from '@nestjs/common';
import type {
  ElliottWaveAnalysis,
  WaveAnalystResult,
} from '../types/analysis.js';
import { WaveAnalystResultSchema } from '../types/schemas.js';
import { calculateFibonacciExtensions } from '../tools/sr-calculator.js';
import { LlmClientService } from '../tools/llm-client.js';
import { getLogger } from '../utils/logger.js';
import { safeParseResponse } from '../utils/parse.js';
import {
  splitSections,
  extractFields,
  getEnumField,
  getNumberField,
  getStringField,
  detectFormat,
} from '../utils/markdown-parser.js';
import { getSymbolProfile, type SymbolProfile } from '../config/symbol-profile.js';

export interface WavePriceContext {
  symbol: string;
  currentPrice: number;
}

function buildSystemPrompt(profile: SymbolProfile): string {
  return `You are an Elliott Wave analyst for ${profile.name} (${profile.symbol}).
Given a computed Elliott wave structure and current price context, produce a structured MARKDOWN analysis.

## SYMBOL CHARACTERISTICS
- Instrument: ${profile.name}
- Price precision: ${profile.pricePrecision} decimal places
- Typical price range: ${profile.priceRangeHint}
- Volatility: ${profile.volatilityLevel}

## CRITICAL OUTPUT RULES
1. Output structured MARKDOWN text using ## WAVE section header and - Key: Value format.
2. NEVER wrap output in \`\`\`code blocks\`\`\`. Do NOT output JSON.
3. ALL numeric fields MUST be valid finite numbers.
4. confidence MUST be an integer from 0 to 100.
5. All target_levels MUST be within ±50% of the current price for THIS instrument.

## REQUIRED OUTPUT MARKDOWN FORMAT

## WAVE
- Confirmation: confirmed | partial | rejected
- Extension Wave: 1 | 3 | 5
- Corrective Type: zigzag | flat | triangle
- Trend Strength: strong | moderate | weak
- Target Level 1.618: <number>
- Target Level 2.0: <number>
- Confidence: <0-100>
- Rationale: <string>`;
}

function inferExtensionWave(analysis: ElliottWaveAnalysis): 1 | 3 | 5 | null {
  if (analysis.impulseWaves.length !== 5) {
    return null;
  }

  const motiveWaves = analysis.impulseWaves.filter(
    (wave): wave is typeof wave & { wave: 1 | 3 | 5 } =>
      wave.wave === 1 || wave.wave === 3 || wave.wave === 5,
  );

  if (motiveWaves.length !== 3) {
    return null;
  }

  return motiveWaves.reduce((longest, current) =>
    current.length > longest.length ? current : longest,
  ).wave;
}

function inferCorrectiveType(
  analysis: ElliottWaveAnalysis,
): 'zigzag' | 'flat' | 'triangle' | null {
  if (analysis.correctiveWaves.length !== 3) {
    return null;
  }

  const [waveA, waveB, waveC] = analysis.correctiveWaves;
  const ratio = waveA.length === 0 ? 0 : waveB.length / waveA.length;

  if (ratio < 0.7) {
    return 'zigzag';
  }

  if (ratio <= 1.05 && Math.abs(waveC.length - waveA.length) / waveA.length < 0.35) {
    return 'flat';
  }

  return 'triangle';
}

function buildTargetLevels(analysis: ElliottWaveAnalysis, currentPrice: number) {
  const wave1 = analysis.impulseWaves.find((wave) => wave.wave === 1);
  const wave2 = analysis.impulseWaves.find((wave) => wave.wave === 2);

  if (!wave1 || !wave2) {
    return {
      level_1_618: currentPrice,
      level_2_0: currentPrice,
    };
  }

  return calculateFibonacciExtensions(
    wave1.startPrice,
    wave1.endPrice,
    wave2.endPrice,
    analysis.direction,
  );
}

function buildPrompt(
  analysis: ElliottWaveAnalysis,
  context: WavePriceContext,
  profile: SymbolProfile,
  defaultTargets: { level_1_618: number; level_2_0: number },
): string {
  return `Analyze ${profile.name} (${context.symbol}) Elliott Wave structure:

## SYMBOL CONTEXT
- Instrument: ${profile.name} (${profile.symbol})
- Current Price: ${context.currentPrice.toFixed(profile.pricePrecision)}
- Price Range: ${(context.currentPrice * 0.5).toFixed(profile.pricePrecision)} - ${(context.currentPrice * 1.5).toFixed(profile.pricePrecision)}

Detected direction: ${analysis.direction}
Swing points: ${JSON.stringify(analysis.swingPoints)}
Impulse waves: ${JSON.stringify(analysis.impulseWaves)}
Corrective waves: ${JSON.stringify(analysis.correctiveWaves)}
Validation: ${JSON.stringify(analysis.validation)}
Model confidence: ${analysis.confidence}
Suggested Fibonacci targets: ${JSON.stringify(defaultTargets)}

Respond with structured MARKDOWN using ## WAVE section. Keep target levels aligned with the suggested Fibonacci targets unless the wave structure clearly invalidates them.
All target prices MUST be appropriate for ${profile.symbol} (current price ~${context.currentPrice.toFixed(profile.pricePrecision)}).`;
}

function parseMarkdownWave(raw: string, currentPrice: number): WaveAnalystResult | null {
  const sections = splitSections(raw);
  const waveSection = sections.get('wave') || '';
  if (!waveSection) return null;
  const fields = extractFields(waveSection);

  const extWaveRaw = getNumberField(fields, 'extension_wave', 0, { min: 1, max: 5 });
  const validExtWaves = [1, 3, 5];
  const extensionWave = validExtWaves.includes(extWaveRaw as 1 | 3 | 5) ? (extWaveRaw as 1 | 3 | 5) : null;
  const correctiveRaw = getStringField(fields, 'corrective_type', '');
  const validCorrective = ['zigzag', 'flat', 'triangle'] as const;
  const correctiveType = validCorrective.includes(correctiveRaw as any) ? (correctiveRaw as 'zigzag' | 'flat' | 'triangle') : null;

  return {
    wave_confirmation: getEnumField(fields, 'confirmation', ['confirmed', 'partial', 'rejected'] as const, 'rejected'),
    extension_wave: extensionWave,
    corrective_type: correctiveType,
    trend_strength: getEnumField(fields, 'trend_strength', ['strong', 'moderate', 'weak'] as const, 'weak'),
    target_levels: {
      level_1_618: getNumberField(fields, 'target_level_1.618', currentPrice),
      level_2_0: getNumberField(fields, 'target_level_2.0', currentPrice),
    },
    confidence: getNumberField(fields, 'confidence', 0, { min: 0, max: 100 }),
    rationale: getStringField(fields, 'rationale', '波浪分析解析失败 (Wave analysis parse failed)'),
  };
}

function parseResponse(raw: string, currentPrice: number): WaveAnalystResult | null {
  // Try Markdown first
  const format = detectFormat(raw);
  if (format === 'markdown') {
    const mdResult = parseMarkdownWave(raw, currentPrice);
    if (mdResult) return mdResult;
  }

  // JSON fallback
  return safeParseResponse(raw, WaveAnalystResultSchema, { agent: 'wave' });
}

@Injectable()
export class WaveAnalystService {
  constructor(private readonly client: LlmClientService) {}

  async run(
    analysis: ElliottWaveAnalysis,
    context: WavePriceContext,
  ): Promise<WaveAnalystResult> {
    const logger = getLogger();
    const profile = getSymbolProfile(context.symbol);
    const systemPrompt = buildSystemPrompt(profile);
    const extensions = buildTargetLevels(analysis, context.currentPrice);
    const prompt = buildPrompt(analysis, context, profile, {
      level_1_618: extensions.level_1_618,
      level_2_0: extensions.level_2_0,
    });
    const raw = await this.client.streamInvoke(prompt, systemPrompt);
    const parsed = parseResponse(raw, context.currentPrice);

    if (!parsed) {
      logger.error({ symbol: context.symbol }, 'Wave analysis parse failed — returning fallback');
      return {
        wave_confirmation: 'rejected',
        extension_wave: null,
        corrective_type: null,
        trend_strength: 'weak',
        target_levels: {
          level_1_618: extensions.level_1_618,
          level_2_0: extensions.level_2_0,
        },
        confidence: 0,
        rationale: '波浪分析解析失败 (Wave analysis parse failed)',
      };
    }

    const result = {
      ...parsed,
      extension_wave: parsed.extension_wave ?? inferExtensionWave(analysis),
      corrective_type: parsed.corrective_type ?? inferCorrectiveType(analysis),
      target_levels: parsed.target_levels ?? {
        level_1_618: extensions.level_1_618,
        level_2_0: extensions.level_2_0,
      },
    };

    logger.info(
      {
        symbol: context.symbol,
        waveConfirmation: result.wave_confirmation,
        confidence: result.confidence,
      },
      'Wave analysis complete',
    );

    return result;
  }
}

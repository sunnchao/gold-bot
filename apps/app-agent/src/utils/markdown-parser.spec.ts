import { describe, it, expect } from 'vitest';
import {
  splitSections,
  extractFields,
  extractListItems,
  getEnumField,
  getNumberField,
  getBooleanField,
  getStringField,
  parseSRLevelLine,
  parseSRLevels,
  parseWarningsLine,
  extractWarnings,
  detectFormat,
} from './markdown-parser.js';

// ── splitSections ─────────────────────────────────────────────────────────

describe('splitSections', () => {
  it('splits on ## headers', () => {
    const raw = `## TECHNICAL
- Bias: bullish
- Confidence: 65

## WAVE
- Confirmation: partial
- Confidence: 55`;

    const sections = splitSections(raw);
    expect(sections.size).toBe(2);
    expect(sections.has('technical')).toBe(true);
    expect(sections.has('wave')).toBe(true);
    expect(sections.get('technical')!).toContain('Bias: bullish');
    expect(sections.get('wave')!).toContain('Confirmation: partial');
  });

  it('normalizes section keys to lowercase with underscores', () => {
    const raw = `## Risk Assessment
- Risk Level: medium

## UNITED FRONT ANALYSIS
- Test: value`;

    const sections = splitSections(raw);
    expect(sections.has('risk_assessment')).toBe(true);
    expect(sections.has('united_front_analysis')).toBe(true);
  });

  it('handles hyphens in section names', () => {
    const raw = `## SUPPORT LEVELS
- item1

## TRADE RECOMMENDATION
- item2`;

    const sections = splitSections(raw);
    expect(sections.has('support_levels')).toBe(true);
    expect(sections.has('trade_recommendation')).toBe(true);
  });

  it('returns root fallback when no headers', () => {
    const raw = `- Bias: bullish\n- Confidence: 65`;
    const sections = splitSections(raw);
    expect(sections.size).toBe(1);
    expect(sections.has('root')).toBe(true);
  });

  it('returns empty map for empty input', () => {
    const sections = splitSections('');
    expect(sections.size).toBe(0);
  });

  it('returns empty map for whitespace-only input', () => {
    const sections = splitSections('   \n  \n  ');
    expect(sections.size).toBe(0);
  });

  it('handles single section', () => {
    const raw = `## TECHNICAL
- Bias: bearish`;
    const sections = splitSections(raw);
    expect(sections.size).toBe(1);
    expect(sections.get('technical')!.trim()).toBe('- Bias: bearish');
  });

  it('handles 5 sections (comprehensive format)', () => {
    const raw = `## TECHNICAL
- Bias: bullish

## WAVE
- Confirmation: confirmed

## CHANLUN
- Trend: up

## RISK
- Risk Level: medium

## ARBITRATION
- Final Direction: buy`;

    const sections = splitSections(raw);
    expect(sections.size).toBe(5);
  });
});

// ── extractFields ─────────────────────────────────────────────────────────

describe('extractFields', () => {
  it('extracts key-value pairs', () => {
    const section = `- Bias: bullish
- Confidence: 65
- Phase: trending`;

    const fields = extractFields(section);
    expect(fields.get('bias')).toBe('bullish');
    expect(fields.get('confidence')).toBe('65');
    expect(fields.get('phase')).toBe('trending');
  });

  it('normalizes keys', () => {
    const section = `- Risk Level: medium
- Final Direction: buy
- Max Position Size: 0.10`;

    const fields = extractFields(section);
    expect(fields.get('risk_level')).toBe('medium');
    expect(fields.get('final_direction')).toBe('buy');
    expect(fields.get('max_position_size')).toBe('0.10');
  });

  it('first occurrence wins for duplicate keys', () => {
    const section = `- Confidence: 65
- Confidence: 80`;

    const fields = extractFields(section);
    expect(fields.get('confidence')).toBe('65');
  });

  it('handles values with colons (e.g. rationale with time)', () => {
    const section = `- Rationale: H4/D1 uptrend, entry at 14:30 UTC`;

    const fields = extractFields(section);
    expect(fields.get('rationale')).toBe('H4/D1 uptrend, entry at 14:30 UTC');
  });

  it('handles Chinese text', () => {
    const section = `- Rationale: 多周期共振看多，H1回调结束 (Multi-TF bullish confluence, H1 pullback done)`;

    const fields = extractFields(section);
    expect(fields.get('rationale')).toContain('多周期共振看多');
  });

  it('handles empty values', () => {
    const section = `- Primary Contradiction: `;

    const fields = extractFields(section);
    expect(fields.get('primary_contradiction')).toBe('');
  });

  it('ignores non-KV lines', () => {
    const section = `Some random text
- Bias: bullish
More random text`;

    const fields = extractFields(section);
    expect(fields.size).toBe(1);
    expect(fields.get('bias')).toBe('bullish');
  });

  it('ignores indented list items', () => {
    const section = `- Support Levels:
  - 4287.50 | support | strong | H1 | 3
- Bias: bullish`;

    const fields = extractFields(section);
    // "Support Levels:" has empty value after colon, but it IS a top-level KV
    // The indented pipe-delimited line should NOT be treated as a top-level KV
    expect(fields.get('bias')).toBe('bullish');
    expect(fields.get('4287.50')).toBeUndefined();
  });
});

// ── extractListItems ──────────────────────────────────────────────────────

describe('extractListItems', () => {
  it('extracts indented list items', () => {
    const section = `- Support Levels:
  - 4287.50 | support | strong | H1 | 3
  - 4265.00 | support | moderate | H4 | 2`;

    const items = extractListItems(section);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('4287.50');
    expect(items[1]).toContain('4265.00');
  });

  it('excludes KV pairs that are not pipe-delimited', () => {
    const section = `- Some Key: some value
  - Not a KV list item
  - Key-Value: excluded`;

    const items = extractListItems(section);
    // "Not a KV list item" has no colon → included
    // "Key-Value: excluded" has colon without pipe → excluded
    expect(items).toHaveLength(1);
    expect(items[0]).toBe('Not a KV list item');
  });

  it('includes pipe-delimited lines even with colons', () => {
    const section = `  - 4287.50 | support | strong | H1 | 3`;

    const items = extractListItems(section);
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('4287.50');
  });
});

// ── getEnumField ──────────────────────────────────────────────────────────

describe('getEnumField', () => {
  const allowedBias = ['bullish', 'bearish', 'neutral'] as const;

  it('returns exact match', () => {
    const fields = new Map([['bias', 'bullish']]);
    expect(getEnumField(fields, 'bias', allowedBias, 'neutral')).toBe('bullish');
  });

  it('is case-insensitive', () => {
    const fields = new Map([['bias', 'BULLISH']]);
    expect(getEnumField(fields, 'bias', allowedBias, 'neutral')).toBe('bullish');
  });

  it('returns default for invalid value', () => {
    const fields = new Map([['bias', 'dual']]);
    expect(getEnumField(fields, 'bias', allowedBias, 'neutral')).toBe('neutral');
  });

  it('fuzzy matches with hyphens/spaces', () => {
    const fields = new Map([['phase', 'mark up']]);
    const allowed = ['accumulation', 'markup', 'distribution', 'markdown'] as const;
    expect(getEnumField(fields, 'phase', allowed, 'accumulation')).toBe('markup');
  });

  it('returns default for missing key', () => {
    const fields = new Map<string, string>();
    expect(getEnumField(fields, 'bias', allowedBias, 'neutral')).toBe('neutral');
  });

  it('maps common LLM mistakes: buy→not in recommendation enum', () => {
    const allowed = ['hold', 'close', 'partial_close', 'trail_stop', 'none'] as const;
    const fields = new Map([['recommendation', 'buy']]);
    expect(getEnumField(fields, 'recommendation', allowed, 'none')).toBe('none');
  });
});

// ── getNumberField ────────────────────────────────────────────────────────

describe('getNumberField', () => {
  it('extracts a plain number', () => {
    const fields = new Map([['confidence', '65']]);
    expect(getNumberField(fields, 'confidence', 0)).toBe(65);
  });

  it('extracts number from mixed text', () => {
    const fields = new Map([['confidence', '65%']]);
    expect(getNumberField(fields, 'confidence', 0)).toBe(65);
  });

  it('extracts decimal number', () => {
    const fields = new Map([['entry_price', '4325.50']]);
    expect(getNumberField(fields, 'entry_price', 0)).toBe(4325.50);
  });

  it('extracts negative number', () => {
    const fields = new Map([['value', '-12.5']]);
    expect(getNumberField(fields, 'value', 0)).toBe(-12.5);
  });

  it('respects min constraint', () => {
    const fields = new Map([['confidence', '-5']]);
    expect(getNumberField(fields, 'confidence', 50, { min: 0 })).toBe(50);
  });

  it('respects max constraint', () => {
    const fields = new Map([['confidence', '150']]);
    expect(getNumberField(fields, 'confidence', 50, { max: 100 })).toBe(50);
  });

  it('returns default for non-numeric text', () => {
    const fields = new Map([['confidence', 'N/A']]);
    expect(getNumberField(fields, 'confidence', 50)).toBe(50);
  });

  it('returns default for missing key', () => {
    const fields = new Map<string, string>();
    expect(getNumberField(fields, 'confidence', 50)).toBe(50);
  });

  it('extracts number from "Wave 3"', () => {
    const fields = new Map([['extension_wave', '3']]);
    expect(getNumberField(fields, 'extension_wave', 0, { min: 1, max: 5 })).toBe(3);
  });
});

// ── getBooleanField ───────────────────────────────────────────────────────

describe('getBooleanField', () => {
  it('parses true variations', () => {
    for (const val of ['true', 'True', 'TRUE', '1', 'yes', 'Yes']) {
      const fields = new Map([['add_on', val]]);
      expect(getBooleanField(fields, 'add_on', false)).toBe(true);
    }
  });

  it('parses false variations', () => {
    for (const val of ['false', 'False', 'FALSE', '0', 'no', 'No']) {
      const fields = new Map([['add_on', val]]);
      expect(getBooleanField(fields, 'add_on', true)).toBe(false);
    }
  });

  it('returns default for invalid text', () => {
    const fields = new Map([['add_on', 'maybe']]);
    expect(getBooleanField(fields, 'add_on', false)).toBe(false);
  });

  it('returns default for missing key', () => {
    const fields = new Map<string, string>();
    expect(getBooleanField(fields, 'add_on', true)).toBe(true);
  });
});

// ── getStringField ────────────────────────────────────────────────────────

describe('getStringField', () => {
  it('extracts string value', () => {
    const fields = new Map([['rationale', 'Short-term bullish momentum']]);
    expect(getStringField(fields, 'rationale')).toBe('Short-term bullish momentum');
  });

  it('removes HTML tags', () => {
    const fields = new Map([['rationale', '<script>alert(1)</script>Bullish<b> trend</b>']]);
    expect(getStringField(fields, 'rationale')).toBe('alert(1)Bullish trend');
  });

  it('truncates to maxLength', () => {
    const longText = 'A'.repeat(3000);
    const fields = new Map([['rationale', longText]]);
    expect(getStringField(fields, 'rationale', '', 2000).length).toBe(2000);
  });

  it('returns default for missing key', () => {
    const fields = new Map<string, string>();
    expect(getStringField(fields, 'rationale', 'default')).toBe('default');
  });

  it('handles Chinese text with special characters', () => {
    const fields = new Map([['rationale', 'H4/D1上升趋势，H1回调 (H4/D1 uptrend, H1 pullback)']]);
    expect(getStringField(fields, 'rationale')).toContain('上升趋势');
  });

  it('returns empty string for empty value', () => {
    const fields = new Map([['primary_contradiction', '']]);
    // Empty string is falsy → getStringField returns default
    // This is intentional: empty LLM output = no data = use default
    expect(getStringField(fields, 'primary_contradiction', 'N/A')).toBe('N/A');
  });
});

// ── parseSRLevelLine ─────────────────────────────────────────────────────

describe('parseSRLevelLine', () => {
  it('parses valid S/R level line', () => {
    const result = parseSRLevelLine('4287.50 | support | strong | H1 | 3', 'support');
    expect(result).toEqual({
      price: 4287.50,
      type: 'support',
      strength: 'strong',
      timeframe: 'H1',
      touches: 3,
    });
  });

  it('defaults strength to moderate if invalid', () => {
    const result = parseSRLevelLine('4287.50 | support | invalid | H1 | 3', 'support');
    expect(result?.strength).toBe('moderate');
  });

  it('defaults touches to 1 if missing', () => {
    const result = parseSRLevelLine('4287.50 | support | strong | H1', 'support');
    expect(result?.touches).toBe(1);
  });

  it('defaults timeframe to H1 if missing', () => {
    const result = parseSRLevelLine('4287.50 | support | strong', 'support');
    expect(result?.timeframe).toBe('H1');
  });

  it('returns null for non-numeric price', () => {
    expect(parseSRLevelLine('abc | support | strong | H1 | 3', 'support')).toBeNull();
  });

  it('returns null for zero price', () => {
    expect(parseSRLevelLine('0 | support | strong | H1 | 3', 'support')).toBeNull();
  });

  it('returns null for insufficient parts', () => {
    expect(parseSRLevelLine('4287.50', 'support')).toBeNull();
  });

  it('clamps touches to 0-20', () => {
    const result = parseSRLevelLine('4287.50 | support | strong | H1 | 999', 'support');
    expect(result?.touches).toBe(20);
  });
});

// ── parseSRLevels ─────────────────────────────────────────────────────────

describe('parseSRLevels', () => {
  it('parses multiple valid lines', () => {
    const lines = [
      '4287.50 | support | strong | H1 | 3',
      '4265.00 | support | moderate | H4 | 2',
      '4250.00 | support | weak | M30 | 1',
    ];
    const results = parseSRLevels(lines, 'support');
    expect(results).toHaveLength(3);
    expect(results[0].price).toBe(4287.50);
    expect(results[1].price).toBe(4265.00);
  });

  it('filters out invalid lines', () => {
    const lines = [
      '4287.50 | support | strong | H1 | 3',
      'invalid line',
      '4265.00 | support | moderate | H4 | 2',
    ];
    const results = parseSRLevels(lines, 'support');
    expect(results).toHaveLength(2);
  });

  it('limits to 6 levels', () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      `${4200 + i * 10} | support | strong | H1 | 1`,
    );
    const results = parseSRLevels(lines, 'support');
    expect(results).toHaveLength(6);
  });
});

// ── parseWarningsLine ────────────────────────────────────────────────────

describe('parseWarningsLine', () => {
  it('parses semicolon-separated warnings', () => {
    const result = parseWarningsLine('Spread elevated; H4 resistance unbroken; RSI overbought');
    expect(result).toEqual(['Spread elevated', 'H4 resistance unbroken', 'RSI overbought']);
  });

  it('handles Chinese text', () => {
    const result = parseWarningsLine('点差偏高注意交易成本; H4阻力未突破 (H4 resistance unbroken)');
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('点差偏高');
  });

  it('removes HTML tags', () => {
    const result = parseWarningsLine('<script>alert(1)</script>; Normal warning');
    expect(result).toEqual(['alert(1)', 'Normal warning']);
  });

  it('limits to 10 warnings', () => {
    const many = Array.from({ length: 15 }, (_, i) => `Warning ${i}`).join('; ');
    expect(parseWarningsLine(many)).toHaveLength(10);
  });

  it('filters empty entries', () => {
    const result = parseWarningsLine('Warning 1; ; Warning 2; ; ;');
    expect(result).toEqual(['Warning 1', 'Warning 2']);
  });

  it('returns empty array for empty input', () => {
    expect(parseWarningsLine('')).toEqual([]);
  });
});

// ── extractWarnings ──────────────────────────────────────────────────────

describe('extractWarnings', () => {
  it('extracts from Warnings field', () => {
    const fields = new Map([['warnings', 'Spread high; RSI overbought']]);
    const result = extractWarnings(fields, []);
    expect(result).toEqual(['Spread high', 'RSI overbought']);
  });

  it('falls back to list items', () => {
    const fields = new Map<string, string>();
    const listItems = ['Spread high', 'RSI overbought'];
    const result = extractWarnings(fields, listItems);
    expect(result).toEqual(['Spread high', 'RSI overbought']);
  });

  it('prefers field over list items', () => {
    const fields = new Map([['warnings', 'Field warning']]);
    const listItems = ['List warning 1', 'List warning 2'];
    const result = extractWarnings(fields, listItems);
    expect(result).toEqual(['Field warning']);
  });

  it('returns empty when neither available', () => {
    const fields = new Map<string, string>();
    const result = extractWarnings(fields, []);
    expect(result).toEqual([]);
  });
});

// ── detectFormat ──────────────────────────────────────────────────────────

describe('detectFormat', () => {
  it('detects markdown', () => {
    expect(detectFormat('## TECHNICAL\n- Bias: bullish')).toBe('markdown');
  });

  it('detects json', () => {
    expect(detectFormat('{"technical": {"bias": "bullish"}}')).toBe('json');
  });

  it('detects unknown', () => {
    expect(detectFormat('Just some random text without structure')).toBe('unknown');
  });

  it('empty string is unknown', () => {
    expect(detectFormat('')).toBe('unknown');
  });
});

// ── Integration: full comprehensive analysis ──────────────────────────────

describe('integration: comprehensive analysis parsing', () => {
  const comprehensiveInput = `## TECHNICAL
- Bias: bullish
- Confidence: 65
- Phase: trending
- Indicators Summary: RSI中性偏强，MACD正值，短期多头排列 (RSI neutral-bullish, MACD positive)
- Recommendation: hold
- Rationale: 短期多头动能减弱，H4阻力明显 (Short-term momentum weakening)

## WAVE
- Confirmation: partial
- Extension Wave: 3
- Corrective Type: zigzag
- Trend Strength: moderate
- Target Level 1.618: 4380.50
- Target Level 2.0: 4412.00
- Confidence: 55
- Rationale: 第3浪延伸中 (Wave 3 extension in progress)

## CHANLUN
- Trend: up
- Strength: moderate
- Latest Signal: hold
- Hub State: active
- Confidence: 50
- Rationale: 中枢形成中 (Hub forming)

## RISK
- Risk Level: medium
- Max Position Size: 0.10
- Suggested SL: 4287.50
- Suggested TP: 4370.00
- Warnings: 点差偏高注意交易成本 (Spread elevated); H4阻力未突破 (H4 resistance unbroken)
- Add On: false

## ARBITRATION
- Final Direction: buy
- Confidence: 65
- Action: open
- Primary Contradiction: 
- Phase: trending
- United Front Analysis: 道氏+波浪+缠论三方看多 (Dow+Wave+Chanlun all bullish)
- Reasoning: 多理论共振做多 (Multi-theory confluence)
- Dow Primary Trend: bullish
- Dow Primary Phase: markup
- Dow Secondary Trend: bullish
- Dow Short Term Trend: neutral
- Dow Multi TF Confirm: false
- Dow Rationale: H4/D1上升趋势 (H4/D1 uptrend)
- Wave Current Wave: Wave 3
- Wave Direction: impulse_up
- Wave Confidence: 60
- Wave Rationale: 第3浪延伸 (Wave 3 extension)
- Chanlun Trend: up
- Chanlun Bi Direction: up
- Chanlun Duan Direction: none
- Chanlun Zhongshu State: active
- Chanlun Buy Sell Point: buy_2
- Chanlun Confidence: 55
- Trade Direction: buy
- Trade Entry Price: 4325.00
- Trade Stop Loss: 4287.50
- Trade Take Profit 1: 4370.00
- Trade Take Profit 2: 4395.00
- Trade Risk Reward Ratio: 2.2
- Trade Position Size Lots: 0.05-0.1
- Trade Rationale: 多理论共振 (Multi-theory confluence)`;

  it('splits into 5 sections', () => {
    const sections = splitSections(comprehensiveInput);
    expect(sections.size).toBe(5);
    expect(sections.has('technical')).toBe(true);
    expect(sections.has('wave')).toBe(true);
    expect(sections.has('chanlun')).toBe(true);
    expect(sections.has('risk')).toBe(true);
    expect(sections.has('arbitration')).toBe(true);
  });

  it('parses technical section', () => {
    const sections = splitSections(comprehensiveInput);
    const fields = extractFields(sections.get('technical')!);

    expect(getEnumField(fields, 'bias', ['bullish', 'bearish', 'neutral'] as const, 'neutral')).toBe('bullish');
    expect(getNumberField(fields, 'confidence', 0, { min: 0, max: 100 })).toBe(65);
    expect(getEnumField(fields, 'phase', ['trending', 'ranging', 'breakout', 'reversal', 'consolidation'] as const, 'consolidation')).toBe('trending');
    expect(getEnumField(fields, 'recommendation', ['hold', 'close', 'partial_close', 'trail_stop', 'none'] as const, 'none')).toBe('hold');
  });

  it('parses wave section', () => {
    const sections = splitSections(comprehensiveInput);
    const fields = extractFields(sections.get('wave')!);

    expect(getEnumField(fields, 'confirmation', ['confirmed', 'partial', 'rejected'] as const, 'rejected')).toBe('partial');
    expect(getNumberField(fields, 'extension_wave', 0)).toBe(3);
    expect(getNumberField(fields, 'target_level_1.618', 0)).toBe(4380.50);
    expect(getNumberField(fields, 'confidence', 0, { min: 0, max: 100 })).toBe(55);
  });

  it('parses chanlun section', () => {
    const sections = splitSections(comprehensiveInput);
    const fields = extractFields(sections.get('chanlun')!);

    expect(getEnumField(fields, 'trend', ['up', 'down', 'range'] as const, 'range')).toBe('up');
    expect(getEnumField(fields, 'strength', ['strong', 'moderate', 'weak'] as const, 'weak')).toBe('moderate');
    expect(getEnumField(fields, 'latest_signal', ['buy', 'sell', 'hold'] as const, 'hold')).toBe('hold');
    expect(getEnumField(fields, 'hub_state', ['forming', 'active', 'none'] as const, 'none')).toBe('active');
    expect(getNumberField(fields, 'confidence', 0, { min: 0, max: 100 })).toBe(50);
  });

  it('parses risk section', () => {
    const sections = splitSections(comprehensiveInput);
    const fields = extractFields(sections.get('risk')!);

    expect(getEnumField(fields, 'risk_level', ['low', 'medium', 'high', 'extreme'] as const, 'medium')).toBe('medium');
    expect(getNumberField(fields, 'max_position_size', 0)).toBeCloseTo(0.10);
    expect(getNumberField(fields, 'suggested_sl', 0)).toBe(4287.50);
    expect(getNumberField(fields, 'suggested_tp', 0)).toBe(4370.00);
    expect(getBooleanField(fields, 'add_on', false)).toBe(false);

    const warnings = extractWarnings(fields, []);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('点差偏高');
  });

  it('parses arbitration section', () => {
    const sections = splitSections(comprehensiveInput);
    const fields = extractFields(sections.get('arbitration')!);

    expect(getEnumField(fields, 'final_direction', ['buy', 'sell', 'hold', 'close'] as const, 'hold')).toBe('buy');
    expect(getNumberField(fields, 'confidence', 0, { min: 0, max: 100 })).toBe(65);
    expect(getEnumField(fields, 'action', ['open', 'close', 'modify', 'hold'] as const, 'hold')).toBe('open');

    // Nested Dow theory fields
    expect(getEnumField(fields, 'dow_primary_trend', ['bullish', 'bearish', 'neutral'] as const, 'neutral')).toBe('bullish');
    expect(getEnumField(fields, 'dow_primary_phase', ['accumulation', 'markup', 'distribution', 'markdown'] as const, 'accumulation')).toBe('markup');
    expect(getBooleanField(fields, 'dow_multi_tf_confirm', false)).toBe(false);

    // Trade recommendation fields
    expect(getEnumField(fields, 'trade_direction', ['buy', 'sell', 'hold'] as const, 'hold')).toBe('buy');
    expect(getNumberField(fields, 'trade_entry_price', 0)).toBe(4325.00);
    expect(getNumberField(fields, 'trade_stop_loss', 0)).toBe(4287.50);
    expect(getNumberField(fields, 'trade_take_profit_1', 0)).toBe(4370.00);
    expect(getNumberField(fields, 'trade_take_profit_2', 0)).toBe(4395.00);
    expect(getNumberField(fields, 'trade_risk_reward_ratio', 0)).toBeCloseTo(2.2);
  });
});

// ── Edge cases: real LLM failure patterns ──────────────────────────────────

describe('edge cases: LLM failure patterns', () => {
  it('handles Chinese quotes in rationale (JSON killer)', () => {
    const section = `- Rationale: 多周期指标分化：短线M15/M30看涨但超买，H4仍偏空，无明显趋势方向。`;
    const fields = extractFields(section);
    // Should parse correctly — Chinese colon inside value, English colon separates key
    expect(fields.get('rationale')).toBeDefined();
    expect(fields.get('rationale')).toContain('多周期指标分化');
  });

  it('handles incomplete output (truncation)', () => {
    const raw = `## TECHNICAL
- Bias: bullish
- Confidence: 65

## WAVE
- Confirmation: partial
- Confidence:`;
    // Missing WAVE confidence value, missing CHANLUN/RISK/ARBITRATION sections
    const sections = splitSections(raw);
    expect(sections.size).toBe(2);

    const techFields = extractFields(sections.get('technical')!);
    expect(getEnumField(techFields, 'bias', ['bullish', 'bearish', 'neutral'] as const, 'neutral')).toBe('bullish');

    const waveFields = extractFields(sections.get('wave')!);
    // Confidence with empty value → default
    expect(getNumberField(waveFields, 'confidence', 50, { min: 0, max: 100 })).toBe(50);
  });

  it('handles extra whitespace and blank lines', () => {
    const raw = `## TECHNICAL

-   Bias:    bullish   

- Confidence: 65

`;
    const sections = splitSections(raw);
    const fields = extractFields(sections.get('technical')!);
    expect(getEnumField(fields, 'bias', ['bullish', 'bearish', 'neutral'] as const, 'neutral')).toBe('bullish');
    expect(getNumberField(fields, 'confidence', 0)).toBe(65);
  });

  it('handles enum value outside schema (dual → default)', () => {
    const fields = new Map([['final_direction', 'dual']]);
    const allowed = ['buy', 'sell', 'hold', 'close'] as const;
    expect(getEnumField(fields, 'final_direction', allowed, 'hold')).toBe('hold');
  });

  it('handles confidence > 100 (clamp to default)', () => {
    const fields = new Map([['confidence', '999']]);
    expect(getNumberField(fields, 'confidence', 50, { min: 0, max: 100 })).toBe(50);
  });

  it('handles S/R levels with occasional bad lines', () => {
    const lines = [
      '4287.50 | support | strong | H1 | 3',
      'N/A  | invalid line',
      '4265.00 | support | moderate | H4 | 2',
      '',
      '0 | support | strong | H1 | 1',
    ];
    const results = parseSRLevels(lines, 'support');
    expect(results).toHaveLength(2);
    expect(results[0].price).toBe(4287.50);
    expect(results[1].price).toBe(4265.00);
  });

  it('handles HTML injection in rationale', () => {
    const fields = new Map([['rationale', '<img src=x onerror=alert(1)>Bullish trend']]);
    expect(getStringField(fields, 'rationale')).toBe('Bullish trend');
  });

  it('handles very long text (truncation)', () => {
    const longText = 'A'.repeat(5000);
    const fields = new Map([['rationale', longText]]);
    expect(getStringField(fields, 'rationale', '', 2000).length).toBe(2000);
  });

  it('handles position size with range format "0.05-0.1"', () => {
    const fields = new Map([['trade_position_size_lots', '0.05-0.1']]);
    // Should extract the first number: 0.05
    expect(getNumberField(fields, 'trade_position_size_lots', 0)).toBeCloseTo(0.05);
  });

  it('handles "Wave 3" in extension_wave', () => {
    const fields = new Map([['extension_wave', 'Wave 3']]);
    expect(getNumberField(fields, 'extension_wave', 0, { min: 1, max: 5 })).toBe(3);
  });
});

import type { GoldbotPayload, IndicatorPack } from '../types/goldbot.js';

export type IndicatorSnapshot = Partial<IndicatorPack>;

const EMPTY_INDICATOR: IndicatorSnapshot = {};

export function selectIndicator(
  indicators: GoldbotPayload['indicators'],
  ...timeframes: string[]
): IndicatorSnapshot {
  for (const timeframe of timeframes) {
    const indicator = indicators[timeframe];
    if (indicator) {
      return indicator;
    }
  }
  return EMPTY_INDICATOR;
}

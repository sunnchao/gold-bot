export const EA_STRATEGY_NAMES = [
  'pullback',
  'breakout_retest',
  'divergence',
  'breakout_pyramid',
  'counter_pullback',
  'scale_in',
  'range',
  'momentum_scalp',
  'ai_signal'
] as const;

export type EaStrategyName = (typeof EA_STRATEGY_NAMES)[number];

const strategyNameSet = new Set<string>(EA_STRATEGY_NAMES);

export function isEaStrategyName(value: string): value is EaStrategyName {
  return strategyNameSet.has(value);
}

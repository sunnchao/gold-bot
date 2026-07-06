import { describe, expect, it } from 'vitest';
import { evaluateRiskGate, tradingCoreStatus } from './index.js';

describe('trading-core scaffold', () => {
  it('declares that live command production is disabled', () => {
    expect(tradingCoreStatus.canProduceLiveCommands).toBe(false);
  });

  it('exports the riskgate evaluator from the package entrypoint', () => {
    expect(evaluateRiskGate).toBeTypeOf('function');
  });
});

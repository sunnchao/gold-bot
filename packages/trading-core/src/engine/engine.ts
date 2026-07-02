import { isEaStrategyName, type EaStrategyName } from '@gold-bot/shared-contracts';
import { runReplay, type ReplaySmcContext } from '../replay/replay.js';

export type StrategyBar = {
  time?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type StrategyInput = {
  accountId: string;
  symbol: string;
  price: number;
  bars: Record<string, StrategyBar[]>;
  smc?: ReplaySmcContext;
};

export type StrategySignal = {
  strategy: EaStrategyName;
  side: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2?: number;
  score: number;
};

export type StrategyLog = {
  level: 'debug' | 'info' | 'warn' | 'error' | 'signal';
  strategy: string;
  message: string;
};

export type StrategyDecision = {
  decision: 'no_signal' | 'signal';
  signal: StrategySignal | null;
  logs: StrategyLog[];
  canProduceLiveCommands: false;
};

export type StrategyEngine = {
  analyze(input: StrategyInput): StrategyDecision;
  validateStrategyName(value: string): EaStrategyName;
};

export function createStrategyEngine(): StrategyEngine {
  return {
    analyze,
    validateStrategyName
  };
}

export function analyze(_input: StrategyInput): StrategyDecision {
  const replay = runReplay({
    account_id: _input.accountId,
    symbol: _input.symbol,
    current_price: _input.price,
    bars: _input.bars,
    smc: _input.smc
  });
  if (replay.signal != null) {
    return {
      decision: 'signal',
      signal: {
        strategy: validateStrategyName(replay.signal.strategy),
        side: replay.signal.side,
        entry: replay.signal.entry,
        stopLoss: replay.signal.stop_loss,
        tp1: replay.signal.tp1,
        tp2: replay.signal.tp2,
        score: replay.signal.score
      },
      logs: replay.logs.map((entry) => ({
        level: entry.level,
        strategy: entry.strategy,
        message: entry.msg
      })),
      canProduceLiveCommands: false
    };
  }

  return {
    decision: 'no_signal',
    signal: null,
    logs: replay.logs.map((entry) => ({
      level: entry.level,
      strategy: entry.strategy,
      message: entry.msg
    })),
    canProduceLiveCommands: false
  };
}

function validateStrategyName(value: string): EaStrategyName {
  if (!isEaStrategyName(value)) {
    throw new Error(`${value} is not an EA strategy name`);
  }
  return value;
}

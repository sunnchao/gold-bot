import { runReplay, summarizePositions, type PositionManagerPosition, type PositionManagerState } from '@gold-bot/trading-core';
import type { EaRecord, EaStore, PositionStateRecord } from '@gold-bot/persistence';

export class AnalysisService {
  constructor(private readonly store: EaStore, private readonly nowIso: () => string) {}

  analyzeAccountSymbol(accountId: string, symbol: string) {
    const latestTick = this.store.getLatestTick(accountId, symbol) ?? {};
    const positions = this.store.getPositions(accountId, symbol);
    return {
      replay: runReplay({
        account_id: accountId,
        symbol,
        analysis_time: this.nowIso(),
        current_price: currentPriceFromTick(latestTick),
        bars: {
          H1: this.store.getBars(accountId, symbol, 'H1'),
          H4: this.store.getBars(accountId, symbol, 'H4'),
          M30: this.store.getBars(accountId, symbol, 'M30'),
          M15: this.store.getBars(accountId, symbol, 'M15'),
          M5: this.store.getBars(accountId, symbol, 'M5'),
          M1: this.store.getBars(accountId, symbol, 'M1')
        },
        positions,
        position_states: this.store.loadPositionStates(accountId, symbol)
      }),
      positionSummary: summarizePositions({
        accountId,
        symbol,
        positions: positions.map(toPositionManagerPosition)
      })
    };
  }

  persistPositionStates(accountId: string, symbol: string, states: PositionManagerState[] | null): void {
    if (states == null) {
      return;
    }
    for (const state of states) {
      this.store.savePositionState(accountId, symbol, toPositionStateRecord(state, this.nowIso()));
    }
    this.store.deleteStalePositionStates(accountId, symbol, states.map((state) => state.ticket));
  }
}

function currentPriceFromTick(tick: EaRecord): number {
  const ask = typeof tick.ask === 'number' ? tick.ask : undefined;
  const bid = typeof tick.bid === 'number' ? tick.bid : undefined;
  return ask ?? bid ?? 0;
}

function toPositionManagerPosition(position: EaRecord): PositionManagerPosition {
  return {
    ticket: typeof position.ticket === 'number' ? position.ticket : undefined,
    symbol: typeof position.symbol === 'string' ? position.symbol : '',
    type: typeof position.type === 'string' ? position.type : '',
    lots: typeof position.lots === 'number' ? position.lots : undefined,
    openPrice: typeof position.openPrice === 'number' ? position.openPrice : undefined,
    open_price: typeof position.open_price === 'number' ? position.open_price : undefined,
    profit: typeof position.profit === 'number' ? position.profit : undefined,
    comment: typeof position.comment === 'string' ? position.comment : '',
    strategy: typeof position.strategy === 'string' ? position.strategy : '',
    magic: typeof position.magic === 'number' ? position.magic : undefined
  };
}

function toPositionStateRecord(state: PositionManagerState, nowIso: string): PositionStateRecord {
  return {
    ticket: state.ticket,
    tp1_hit: state.tp1Hit ?? state.tp1_hit ?? false,
    tp2_hit: state.tp2Hit ?? state.tp2_hit ?? false,
    max_profit_atr: state.maxProfitAtr ?? state.max_profit_atr ?? 0,
    be_moved: state.beMoved ?? state.be_moved ?? false,
    be_trigger_atr: state.beTriggerAtr ?? state.be_trigger_atr ?? 1.0,
    open_time: state.openTime ?? state.open_time ?? nowIso,
    last_modify_time: nowIso
  };
}

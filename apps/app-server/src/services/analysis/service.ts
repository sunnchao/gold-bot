import { runReplay, summarizePositions, type PositionManagerPosition, type PositionManagerState } from '@gold-bot/trading-core';
import { BE_TRIGGER_ATR_DEFAULT, type EaRecord, type EaStore, type PositionStateRecord } from '@gold-bot/persistence';

export class AnalysisService {
  constructor(private readonly store: EaStore, private readonly nowIso: () => string) {}

  async analyzeAccountSymbol(accountId: string, symbol: string) {
    const latestTick = (await this.store.getLatestTick(accountId, symbol)) ?? {};
    const heartbeat = (await this.store.getHeartbeat(accountId)) ?? {};
    const positions = filterPositionsForSymbol(symbol, await this.store.getPositions(accountId, symbol));
    const latestAIResult = (await this.store.getAIResults(accountId)).find((result) => result.symbol === symbol);
    const h1Bars = await this.store.getBars(accountId, symbol, 'H1');
    return {
      replay: runReplay({
        account_id: accountId,
        symbol,
        analysis_time: this.nowIso(),
        current_price: currentPriceForReplay(currentPriceFromTick(latestTick), h1Bars),
        bars: {
          H1: h1Bars,
          H4: await this.store.getBars(accountId, symbol, 'H4'),
          M30: await this.store.getBars(accountId, symbol, 'M30'),
          M15: await this.store.getBars(accountId, symbol, 'M15'),
          M5: await this.store.getBars(accountId, symbol, 'M5'),
          M1: await this.store.getBars(accountId, symbol, 'M1'),
          D1: await this.store.getBars(accountId, symbol, 'D1')
        },
        positions,
        position_states: await this.store.loadPositionStates(accountId, symbol),
        account: {
          equity: optionalNumberField(heartbeat, 'equity'),
          balance: optionalNumberField(heartbeat, 'balance')
        },
        ai_result: replayAIResult(latestAIResult)
      }),
      positionSummary: summarizePositions({
        accountId,
        symbol,
        positions: positions.map(toPositionManagerPosition)
      })
    };
  }

  async persistPositionStates(accountId: string, symbol: string, states: PositionManagerState[] | null): Promise<void> {
    if (states == null) {
      return;
    }
    for (const state of states) {
      await this.store.savePositionState(accountId, symbol, toPositionStateRecord(state, this.nowIso()));
    }
    await this.store.deleteStalePositionStates(accountId, symbol, states.map((state) => state.ticket));
  }
}

function replayAIResult(payload: EaRecord | undefined): { suggested_sl?: number; suggested_tp?: number } | undefined {
  if (payload == null) {
    return undefined;
  }
  return {
    suggested_sl: optionalNumberField(payload, 'suggested_sl'),
    suggested_tp: optionalNumberField(payload, 'suggested_tp')
  };
}

function currentPriceFromTick(tick: EaRecord): number {
  const ask = typeof tick.ask === 'number' ? tick.ask : undefined;
  const bid = typeof tick.bid === 'number' ? tick.bid : undefined;
  return ask ?? bid ?? 0;
}

function currentPriceForReplay(currentPrice: number, h1Bars: EaRecord[]): number {
  if (currentPrice !== 0) {
    return currentPrice;
  }
  const latestH1Close = h1Bars.at(-1)?.close;
  return typeof latestH1Close === 'number' ? latestH1Close : currentPrice;
}

function filterPositionsForSymbol(symbol: string, positions: EaRecord[]): EaRecord[] {
  const base = baseSymbol(symbol);
  return positions.filter((position) => {
    const positionSymbol = stringField(position, 'symbol');
    return positionSymbol.length === 0 || baseSymbol(positionSymbol) === base;
  });
}

function baseSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase().replace(/M#$/, '').replace(/#$/, '');
  switch (normalized) {
    case 'GOLD':
    case 'XAUUSD':
      return 'XAUUSD';
    case 'US100':
    case 'NAS100':
    case 'US100CASH':
      return 'US100CASH';
    case 'USOIL':
    case 'WTI':
    case 'USOILCASH':
      return 'USOILCASH';
    case 'UKOIL':
    case 'BRENT':
    case 'UKOILCASH':
      return 'UKOILCASH';
    default:
      return normalized;
  }
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function optionalNumberField(record: EaRecord, field: string): number | undefined {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
    be_trigger_atr: state.beTriggerAtr ?? state.be_trigger_atr ?? BE_TRIGGER_ATR_DEFAULT,
    best_sl: state.bestSl ?? state.best_sl ?? 0,
    open_time: state.openTime ?? state.open_time ?? nowIso,
    last_modify_time: nowIso,
    add_on_count: state.addOnCount ?? state.add_on_count ?? 0,
    last_add_on_time: state.lastAddOnTime ?? state.last_add_on_time ?? '',
    last_add_on_price: state.lastAddOnPrice ?? state.last_add_on_price ?? 0,
    group_id: state.groupId ?? state.group_id ?? '',
    group_avg_entry: state.groupAvgEntry ?? state.group_avg_entry ?? 0,
    group_best_sl: state.groupBestSl ?? state.group_best_sl ?? 0
  };
}

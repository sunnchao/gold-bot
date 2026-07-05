import {
  type EaRecord,
  type EaStore
} from '@gold-bot/persistence';

export const DEFAULT_ARBITRATION_MAX_WAIT_MS = 30_000;
export const DEFAULT_ARBITRATION_AUTO_PASS_SCORE = 8;
export const DEFAULT_ARBITRATION_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_PENDING_SIGNAL_TTL_MS = 5 * 60 * 1_000;

export type ArbitrationConfig = {
  maxWaitMs: number;
  timeoutAutoPassScore: number;
  pollIntervalMs: number;
  pendingSignalTtlMs: number;
};

export function defaultArbitrationConfig(): ArbitrationConfig {
  return {
    maxWaitMs: DEFAULT_ARBITRATION_MAX_WAIT_MS,
    timeoutAutoPassScore: DEFAULT_ARBITRATION_AUTO_PASS_SCORE,
    pollIntervalMs: DEFAULT_ARBITRATION_POLL_INTERVAL_MS,
    pendingSignalTtlMs: DEFAULT_PENDING_SIGNAL_TTL_MS
  };
}

export type ArbitrationStatus = 'approved' | 'rejected' | 'timeout';

export type ArbitrationResult = {
  signalId: number;
  status: ArbitrationStatus;
  reason: string;
};

export type ArbitrationVerdict = {
  execute: boolean;
  reason: string;
  result: ArbitrationResult;
};

export type ArbitrationLog = (message: string) => void;

export type ArbitrationManagerOptions = {
  store: EaStore;
  config?: Partial<ArbitrationConfig>;
  now?: () => Date;
  log?: ArbitrationLog;
  sleep?: (ms: number) => Promise<void>;
  signal?: () => AbortSignal;
};

type PendingSignalInfo = {
  signalId: number;
  accountId: string;
  symbol: string;
  score: number;
  createdAt: number;
};

export class ArbitrationManager {
  private readonly store: EaStore;
  private readonly config: ArbitrationConfig;
  private readonly now: () => Date;
  private readonly log: ArbitrationLog;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly getSignal: () => AbortSignal | undefined;
  private readonly pendingSignals = new Map<number, PendingSignalInfo>();

  constructor(options: ArbitrationManagerOptions) {
    this.store = options.store;
    this.config = { ...defaultArbitrationConfig(), ...options.config };
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => {});
    this.sleep = options.sleep ?? defaultSleep;
    this.getSignal = options.signal ?? (() => undefined);
  }

  async submitSignal(
    accountId: string,
    symbol: string,
    signal: SignalInput,
    options: { signal?: AbortSignal } = {}
  ): Promise<ArbitrationVerdict> {
    const score = numberField(signal, 'score');
    const pending: EaRecord = {
      account_id: accountId,
      symbol,
      status: 'pending',
      created_at: this.now().toISOString(),
      expires_at: new Date(this.now().getTime() + this.config.pendingSignalTtlMs).toISOString(),
      indicators: buildIndicatorsJSON(signal),
      side: stringField(signal, 'side'),
      score,
      strategy: stringField(signal, 'strategy')
    };

    this.store.savePendingSignal(pending);

    // The store clones the record and assigns the id internally; read it back to recover the id.
    const stored = this.findFreshPending(accountId, symbol, this.now().getTime());
    const signalId = stored != null ? numberField(stored, 'id') : 0;
    if (signalId <= 0) {
      const result: ArbitrationResult = { signalId: 0, status: 'timeout', reason: 'save_failed' };
      this.log(`[ARBITRATION] save pending signal failed: ${accountId}/${symbol}`);
      return { execute: false, reason: result.reason, result };
    }

    this.pendingSignals.set(signalId, {
      signalId,
      accountId,
      symbol,
      score,
      createdAt: this.now().getTime()
    });
    this.log(`[ARBITRATION] submit ${accountId}/${symbol} ${stringField(signal, 'side')} score=${score} (ID=${signalId})`);

    const result = await this.waitForArbitration(signalId, accountId, symbol, options.signal);

    this.pendingSignals.delete(signalId);

    if (result.status === 'approved') {
      this.log(`[ARBITRATION] approved ${accountId}/${symbol} (ID=${signalId})`);
      return { execute: true, reason: result.reason, result };
    }
    if (result.status === 'rejected') {
      this.log(`[ARBITRATION] rejected ${accountId}/${symbol} reason=${result.reason} (ID=${signalId})`);
      return { execute: false, reason: result.reason, result };
    }
    // timeout fallback: high score passes, low score abandoned
    if (score >= this.config.timeoutAutoPassScore) {
      this.log(`[ARBITRATION] timeout auto-pass ${accountId}/${symbol} score=${score} (ID=${signalId})`);
      return { execute: true, reason: 'timeout_auto_pass', result };
    }
    this.log(`[ARBITRATION] timeout abandoned ${accountId}/${symbol} score=${score} (ID=${signalId})`);
    return { execute: false, reason: 'timeout_abandoned', result };
  }

  private async waitForArbitration(
    signalId: number,
    accountId: string,
    symbol: string,
    signal?: AbortSignal
  ): Promise<ArbitrationResult> {
    const deadline = this.now().getTime() + this.config.maxWaitMs;
    while (true) {
      await this.sleep(this.config.pollIntervalMs);

      if (signal?.aborted || this.getSignal()?.aborted) {
        return { signalId, status: 'timeout', reason: 'context_cancelled' };
      }
      if (this.now().getTime() >= deadline) {
        return { signalId, status: 'timeout', reason: 'max_wait_exceeded' };
      }

      const current = this.findPending(signalId, accountId, symbol);
      if (current == null) {
        // signal expired or removed externally
        return { signalId, status: 'timeout', reason: 'expired' };
      }
      const status = stringField(current, 'status');
      if (status === 'approved' || status === 'rejected') {
        return {
          signalId,
          status: status as ArbitrationStatus,
          reason: stringField(current, 'arbitration_reason')
        };
      }
    }
  }

  private findPending(signalId: number, accountId: string, symbol: string): EaRecord | undefined {
    return this.store.getPendingSignalById(accountId, symbol, signalId);
  }

  private findFreshPending(accountId: string, symbol: string, createdAtMs: number): EaRecord | undefined {
    const signals = this.store.getPendingSignals(accountId, symbol);
    if (signals.length === 0) return undefined;
    const target = new Date(createdAtMs).toISOString();
    const byCreated = signals.find((entry) => stringField(entry, 'created_at') === target);
    return byCreated ?? signals[0];
  }

  getPendingSignals(accountId: string, symbol: string): EaRecord[] {
    return this.store.getPendingSignals(accountId, symbol);
  }

  updateArbitrationResult(signalId: number, result: 'approved' | 'rejected', reason: string): boolean {
    return this.store.updatePendingSignalArbitration(signalId, result, reason);
  }

  expireStaleSignals(): number {
    return this.store.expirePendingSignals(this.now().toISOString());
  }

  activeCount(): number {
    return this.pendingSignals.size;
  }
}

export type SignalInput = EaRecord;

function buildIndicatorsJSON(signal: SignalInput): string {
  const data: Record<string, unknown> = {
    side: stringField(signal, 'side'),
    entry: numberField(signal, 'entry'),
    stop_loss: numberField(signal, 'stop_loss'),
    tp1: numberField(signal, 'tp1'),
    tp2: numberField(signal, 'tp2'),
    score: numberField(signal, 'score'),
    strategy: stringField(signal, 'strategy'),
    atr: numberField(signal, 'atr'),
    scale_in_parent_ticket: numberField(signal, 'scale_in_parent_ticket'),
    weighted_avg_entry: numberField(signal, 'weighted_avg_entry'),
    unified_sl: numberField(signal, 'unified_sl'),
    scale_in_count: numberField(signal, 'scale_in_count')
  };
  const allStrategies = signal.all_strategies;
  if (Array.isArray(allStrategies) && allStrategies.length > 0) {
    data.all_strategies = allStrategies;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return '{}';
  }
}

function stringField(record: EaRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function numberField(record: EaRecord, field: string): number {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

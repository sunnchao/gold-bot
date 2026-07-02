import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { CommandLifecycleService } from './service.js';

describe('CommandLifecycleService', () => {
  it('keeps candidates shadow_only when the account is not in cutover mode', () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'shadow');
    const service = new CommandLifecycleService(store);

    const stored = service.acceptCandidate('90011087', {
      command_id: 'shadow_cmd',
      action: 'SIGNAL',
      source: 'ai_result',
      symbol: 'XAUUSD',
      strategy: 'ai_signal'
    });

    expect(stored.status).toBe('shadow_only');
    expect(store.pollCommands('90011087')).toEqual([]);
    expect(store.listShadowComparisons()).toEqual([
      {
        account_id: '90011087',
        symbol: 'XAUUSD',
        protocol_ok: true,
        signal_drift: false,
        command_drift: false,
        oracle_compared: false,
        source: 'ai_result',
        created_at: stored.created_at
      }
    ]);
  });

  it('queues candidates only for cutover accounts', () => {
    const store = createInMemoryEaStore();
    store.setRuntimeMode('90011087', 'cutover');
    const service = new CommandLifecycleService(store);

    const stored = service.acceptCandidate('90011087', {
      command_id: 'cutover_cmd',
      action: 'SIGNAL',
      source: 'ai_result',
      symbol: 'XAUUSD',
      strategy: 'ai_signal'
    });

    expect(stored.status).toBe('queued');
    expect(store.pollCommands('90011087')).toHaveLength(1);
    expect(store.listShadowComparisons()).toHaveLength(1);
    expect(store.listShadowComparisons()[0]).toMatchObject({
      account_id: '90011087',
      symbol: 'XAUUSD',
      oracle_compared: false,
      source: 'ai_result'
    });
  });

  it('uses the configured shadow default when no explicit runtime mode is stored', () => {
    const store = createInMemoryEaStore();
    const service = new CommandLifecycleService(store, 'shadow');

    const stored = service.acceptCandidate('90011087', {
      command_id: 'default_shadow_cmd',
      action: 'SIGNAL',
      source: 'ai_result',
      symbol: 'XAUUSD',
      strategy: 'ai_signal'
    });

    expect(stored.status).toBe('shadow_only');
    expect(store.pollCommands('90011087')).toEqual([]);
  });
});

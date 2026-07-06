import { describe, expect, it } from 'vitest';
import { createInMemoryEaStore } from '@gold-bot/persistence';
import { CommandLifecycleService } from './service.js';
import { ShadowService } from '../shadow/service.js';

describe('CommandLifecycleService', () => {
  it('keeps candidates shadow_only when the account is not in cutover mode', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'shadow');
    const shadow = new ShadowService(store, () => '2026-04-13T08:00:00.000Z');
    const service = new CommandLifecycleService(store, 'oracle', shadow);

    const stored = await service.acceptCandidate('90011087', {
      command_id: 'shadow_cmd',
      action: 'SIGNAL',
      source: 'ai_result',
      symbol: 'XAUUSD',
      strategy: 'ai_signal'
    });

    expect(stored.status).toBe('shadow_only');
    expect(await store.pollCommands('90011087')).toEqual([]);
    expect(await store.listShadowComparisons()).toEqual([
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

  it('queues candidates only for cutover accounts', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'cutover');
    const service = new CommandLifecycleService(store);

    const stored = await service.acceptCandidate('90011087', {
      command_id: 'cutover_cmd',
      action: 'SIGNAL',
      source: 'ai_result',
      symbol: 'XAUUSD',
      strategy: 'ai_signal'
    });

    expect(stored.status).toBe('queued');
    expect(await store.pollCommands('90011087')).toHaveLength(1);
    expect(await store.listShadowComparisons()).toHaveLength(1);
    expect((await store.listShadowComparisons())[0]).toMatchObject({
      account_id: '90011087',
      symbol: 'XAUUSD',
      oracle_compared: false,
      source: 'ai_result'
    });
  });

  it('records AI approve commands under the AI result shadow source', async () => {
    const store = createInMemoryEaStore();
    await store.setRuntimeMode('90011087', 'shadow');
    const shadow = new ShadowService(store, () => '2026-04-13T08:00:00.000Z');
    const service = new CommandLifecycleService(store, 'oracle', shadow);

    const stored = await service.acceptCandidate('90011087', {
      command_id: 'ai_pending_90011087_XAUUSD_buy',
      action: 'SIGNAL',
      source: 'ai_approve',
      symbol: 'XAUUSD',
      strategy: 'ai_signal'
    });

    expect(stored.source).toBe('ai_approve');
    expect(await store.getLatestShadowSnapshot('90011087', 'XAUUSD', 'ai_result')).toEqual(
      expect.objectContaining({
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ai_result',
        command: expect.objectContaining({ source: 'ai_approve' })
      })
    );
    expect(await store.listShadowComparisons()).toEqual([
      expect.objectContaining({
        account_id: '90011087',
        symbol: 'XAUUSD',
        source: 'ai_result'
      })
    ]);
  });

  it('uses the configured shadow default when no explicit runtime mode is stored', async () => {
    const store = createInMemoryEaStore();
    const service = new CommandLifecycleService(store, 'shadow');

    const stored = await service.acceptCandidate('90011087', {
      command_id: 'default_shadow_cmd',
      action: 'SIGNAL',
      source: 'ai_result',
      symbol: 'XAUUSD',
      strategy: 'ai_signal'
    });

    expect(stored.status).toBe('shadow_only');
    expect(await store.pollCommands('90011087')).toEqual([]);
  });

  it('uses the configured cutover default when no explicit runtime mode is stored', async () => {
    const store = createInMemoryEaStore();
    const service = new CommandLifecycleService(store, 'cutover');

    const stored = await service.acceptCandidate('90011087', {
      command_id: 'default_cutover_cmd',
      action: 'SIGNAL',
      source: 'live_strategy',
      symbol: 'XAUUSD',
      strategy: 'pullback'
    });

    expect(stored.status).toBe('queued');
    expect(await store.pollCommands('90011087')).toEqual([
      expect.objectContaining({ command_id: 'default_cutover_cmd', action: 'SIGNAL' })
    ]);
  });
});

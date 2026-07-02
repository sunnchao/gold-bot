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
  });
});

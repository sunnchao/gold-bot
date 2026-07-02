import { describe, expect, it } from 'vitest';
import { MT_ASSET_ROOTS } from './assets-manifest.js';

describe('MT asset manifest', () => {
  it('declares MT4 and MT5 source roots as read-only boundaries', () => {
    expect(MT_ASSET_ROOTS).toEqual([
      { platform: 'mt4', root: '../../mt4_ea', mode: 'read-only' },
      { platform: 'mt5', root: '../../mt5_ea', mode: 'read-only' }
    ]);
  });
});

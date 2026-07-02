import { describe, expect, it } from 'vitest';
import { EA_COMPAT_ENDPOINTS, extractAuthToken, isEaCompatEndpoint } from './endpoint.js';

describe('EA compatibility endpoints', () => {
  it('freezes the legacy EA route list', () => {
    expect(EA_COMPAT_ENDPOINTS).toEqual([
      '/register',
      '/heartbeat',
      '/tick',
      '/bars',
      '/positions',
      '/poll',
      '/order_result'
    ]);
  });

  it('rejects unknown endpoint values', () => {
    expect(isEaCompatEndpoint('/register')).toBe(true);
    expect(isEaCompatEndpoint('/api/analysis_payload/90011087')).toBe(false);
    expect(isEaCompatEndpoint('/orders')).toBe(false);
  });

  it('extracts auth tokens with Go-compatible priority', () => {
    expect(
      extractAuthToken(
        {
          'x-api-token': 'primary',
          'x-api-key': 'secondary'
        },
        '/poll?token=query'
      )
    ).toBe('primary');
    expect(extractAuthToken({ 'X-API-Key': 'secondary' }, '/poll?token=query')).toBe('secondary');
    expect(extractAuthToken({}, '/poll?token=query')).toBe('query');
    expect(extractAuthToken({}, '/poll')).toBeUndefined();
  });
});

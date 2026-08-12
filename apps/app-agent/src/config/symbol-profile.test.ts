import { describe, expect, it } from 'vitest';
import { getSymbolProfile } from './symbol-profile.js';

describe('getSymbolProfile lot bounds', () => {
  it('keeps standard gold at the default minimum lot size', () => {
    expect(getSymbolProfile('GOLD').minLots).toBe(0.01);
    expect(getSymbolProfile('GOLD').maxLots).toBe(0.5);
  });

  it('raises the minimum lot size for XM-style micro gold symbols', () => {
    expect(getSymbolProfile('GOLDm#').minLots).toBe(0.1);
    expect(getSymbolProfile('GOLDm#').maxLots).toBe(0.5);
  });

  it('does not mutate the base profile after resolving a micro symbol', () => {
    getSymbolProfile('GOLDm#');

    expect(getSymbolProfile('GOLD').minLots).toBe(0.01);
  });

  it('resolves XM-style micro silver symbols to the XAGUSD profile with micro lot bounds', () => {
    const profile = getSymbolProfile('SILVERm#');

    expect(profile.minLots).toBe(0.1);
    expect(profile.assetClass).toBe('metal');
    expect(profile.priceRange).toEqual([15, 50]);
  });

  it('resolves lowercase XM-style micro silver symbols to the XAGUSD profile', () => {
    const profile = getSymbolProfile('silverm#');

    expect(profile.minLots).toBe(0.1);
    expect(profile.assetClass).toBe('metal');
    expect(profile.priceRange).toEqual([15, 50]);
  });
});

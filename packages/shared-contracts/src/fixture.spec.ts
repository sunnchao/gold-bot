import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseOracleFixture } from './fixture.js';

const fixtureRoot = join(import.meta.dirname, '../../../tests/fixtures');

function readFixtureFiles(group: 'earoutes' | 'admin') {
  const dir = join(fixtureRoot, group);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      name,
      value: JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown
    }));
}

describe('Go oracle fixtures', () => {
  it('parses every EA route fixture', () => {
    const fixtures = readFixtureFiles('earoutes').map(({ value }) => parseOracleFixture(value));

    expect(fixtures).toHaveLength(7);
    expect(fixtures.map((fixture) => fixture.fixture).sort()).toEqual([
      'ea-bars',
      'ea-heartbeat',
      'ea-order-result',
      'ea-poll',
      'ea-positions',
      'ea-register',
      'ea-tick'
    ]);
  });

  it('parses every Admin and AI fixture', () => {
    const fixtures = readFixtureFiles('admin').map(({ value }) => parseOracleFixture(value));

    expect(fixtures).toHaveLength(11);
    expect(fixtures.map((fixture) => fixture.fixture).sort()).toEqual([
      'admin-accounts',
      'admin-ai-result',
      'admin-ai-result-v2-trade-plan',
      'admin-ai-symbols',
      'admin-analysis-payload',
      'admin-analysis-payload-v2',
      'admin-audit',
      'admin-events-stream-sample',
      'admin-overview',
      'admin-pending-signal',
      'admin-symbols'
    ]);
  });
});

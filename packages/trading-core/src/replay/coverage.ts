import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runReplay } from './replay.js';

export type ReplayCoverageSummary = {
  total: number;
  validated: number;
};

export type ReplayFixturePair = {
  snapshot: string;
  expected: string;
};

export function listReplayFixturePairs(fixtureRoot: string): ReplayFixturePair[] {
  const files = readdirSync(fixtureRoot);
  const snapshotFiles = files.filter((name) => name.endsWith('_snapshot.json'));
  const pairs: ReplayFixturePair[] = [];

  for (const snapshotFile of snapshotFiles) {
    const base = snapshotFile.replace('_snapshot.json', '');
    const expectedFile = `${base}_expected.json`;
    if (files.includes(expectedFile)) {
      pairs.push({
        snapshot: snapshotFile,
        expected: expectedFile
      });
    }
  }

  return pairs;
}

export function computeReplayCoverage(fixtureRoot: string): ReplayCoverageSummary {
  const pairs = listReplayFixturePairs(fixtureRoot);
  let validated = 0;

  for (const pair of pairs) {
    const snapshotPath = join(fixtureRoot, pair.snapshot);
    const expectedPath = join(fixtureRoot, pair.expected);
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as unknown;
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as {
      signal?: unknown;
      logs?: unknown;
      position_commands?: unknown;
    };

    const result = runReplay(snapshot);
    const signalMatch = stableStringify(result.signal) === stableStringify(expected.signal);
    const logsMatch = stableStringify(result.logs) === stableStringify(expected.logs);
    const commandsMatch = stableStringify(result.position_commands) === stableStringify(expected.position_commands);

    if (signalMatch && logsMatch && commandsMatch) {
      validated++;
    }
  }

  return {
    total: pairs.length,
    validated
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry));
  }
  if (value != null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = normalize(record[key]);
    }
    return out;
  }
  return value ?? null;
}

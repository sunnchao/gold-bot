import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadMigrations, runMigrations } from './migrate.js';

describe('migrate', () => {
  it('loads all migrations in order', () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0].version).toBe(1);
    expect(migrations[0].name).toBe('init');

    for (let i = 1; i < migrations.length; i++) {
      expect(migrations[i].version).toBeGreaterThan(migrations[i - 1].version);
    }
  });

  it('runs migrations on fresh database', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migrate-test-'));
    const dbPath = join(tmpDir, 'test.db');

    try {
      const db = new DatabaseSync(dbPath);
      runMigrations(db);

      const stmt = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version');
      const applied = stmt.all() as Array<{ version: number; name: string }>;

      expect(applied.length).toBeGreaterThan(0);
      expect(applied[0].version).toBe(1);
      expect(applied[0].name).toBe('init');

      db.close();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('skips already applied migrations', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migrate-test-'));
    const dbPath = join(tmpDir, 'test.db');

    try {
      const db = new DatabaseSync(dbPath);

      // Run migrations twice
      runMigrations(db);
      const firstRun = db.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as { count: number };

      runMigrations(db);
      const secondRun = db.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as { count: number };

      expect(secondRun.count).toBe(firstRun.count);

      db.close();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('creates all expected tables', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migrate-test-'));
    const dbPath = join(tmpDir, 'test.db');

    try {
      const db = new DatabaseSync(dbPath);
      runMigrations(db);

      const stmt = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      const tables = (stmt.all() as Array<{ name: string }>).map((row) => row.name);

      expect(tables).toContain('schema_migrations');
      expect(tables).toContain('ea_snapshots');
      expect(tables).toContain('ea_events');
      expect(tables).toContain('runtime_state');
      expect(tables).toContain('runtime_commands');
      expect(tables).toContain('position_states');
      expect(tables).toContain('shadow_comparisons');
      expect(tables).toContain('shadow_snapshots');
      expect(tables).toContain('decision_events');
      expect(tables).toContain('tokens');
      expect(tables).toContain('token_accounts');

      db.close();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

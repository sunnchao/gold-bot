import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export function loadMigrations(): Migration[] {
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  return files.map((file) => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename: ${file}`);
    }
    const version = parseInt(match[1], 10);
    const name = match[2];
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    return { version, name, sql };
  });
}

export function runMigrations(db: DatabaseSync): void {
  // Ensure schema_migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const migrations = loadMigrations();
  const appliedStmt = db.prepare('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(
    (appliedStmt.all() as Array<{ version: number }>).map((row) => row.version)
  );

  const insertStmt = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    try {
      db.exec(migration.sql);
      insertStmt.run(migration.version, migration.name, new Date().toISOString());
      console.log(`✓ Applied migration ${migration.version}_${migration.name}`);
    } catch (error) {
      console.error(`✗ Migration ${migration.version}_${migration.name} failed:`, error);
      throw error;
    }
  }
}

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

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

function toPostgresSql(sql: string): string {
  return sql
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGSERIAL PRIMARY KEY')
    .replace(/CURRENT_TIMESTAMP/g, 'CURRENT_TIMESTAMP');
}

export type PostgresClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
};

export async function runMigrationsPostgres(client: PostgresClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const migrations = loadMigrations();
  const appliedResult = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(
    (appliedResult.rows as Array<{ version: number }>).map((row) => row.version)
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await client.query('BEGIN');
    try {
      await client.query(toPostgresSql(migration.sql));
      await client.query(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)',
        [migration.version, migration.name, new Date().toISOString()]
      );
      await client.query('COMMIT');
      console.log(`✓ Applied postgres migration ${migration.version}_${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`✗ Postgres migration ${migration.version}_${migration.name} failed:`, error);
      throw error;
    }
  }
}

import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { PinoLoggerService } from '../utils/logger.service.js';
import type { AISignalResult } from '../types/agent.js';

export interface AnalysisResultRow {
  id: number;
  account_id: string;
  symbol: string;
  bias: string;
  confidence: number;
  exit_suggestion: string;
  risk_alert: number;
  alert_reason: string | null;
  action: string | null;
  direction: string | null;
  reasoning: string | null;
  sr_levels: string | null;
  result_json: string;
  duration_ms: number;
  created_at: string;
}

@Injectable()
export class AnalysisStoreService implements OnApplicationShutdown {
  private readonly db: Database.Database;

  constructor(logger: PinoLoggerService) {
    const resolvedPath =
      process.env.SQLITE_DB_PATH ?? path.join(process.cwd(), 'data', 'analysis.db');
    const dir = path.dirname(resolvedPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    logger.instance.info({ dbPath: resolvedPath }, 'AnalysisStore: database opened');
    this.initDatabase();
  }

  initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_results (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id    TEXT    NOT NULL,
        symbol        TEXT    NOT NULL,
        bias          TEXT    NOT NULL,
        confidence    INTEGER NOT NULL,
        exit_suggestion TEXT  NOT NULL,
        risk_alert    INTEGER NOT NULL DEFAULT 0,
        alert_reason  TEXT,
        action        TEXT,
        direction     TEXT,
        reasoning     TEXT,
        sr_levels     TEXT,
        result_json   TEXT    NOT NULL,
        duration_ms   INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_account_symbol
        ON analysis_results (account_id, symbol, created_at DESC);
    `);
  }

  saveResult(
    accountId: string,
    symbol: string,
    result: AISignalResult,
    duration: number,
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO analysis_results
        (account_id, symbol, bias, confidence, exit_suggestion, risk_alert,
         alert_reason, action, direction, reasoning, sr_levels, result_json, duration_ms)
      VALUES
        (@accountId, @symbol, @bias, @confidence, @exitSuggestion, @riskAlert,
         @alertReason, @action, @direction, @reasoning, @srLevels, @resultJson, @durationMs)
    `);

    stmt.run({
      accountId,
      symbol,
      bias: result.bias,
      confidence: result.confidence,
      exitSuggestion: result.exit_suggestion,
      riskAlert: result.risk_alert ? 1 : 0,
      alertReason: result.alert_reason ?? null,
      action: result.arbitration?.action ?? null,
      direction: result.arbitration?.direction ?? null,
      reasoning: result.arbitration?.reasoning ?? null,
      srLevels: result.sr_levels ? JSON.stringify(result.sr_levels) : null,
      resultJson: JSON.stringify(result),
      durationMs: duration,
    });
  }

  getRecentResults(accountId: string, symbol: string, limit = 10): AnalysisResultRow[] {
    const stmt = this.db.prepare(`
      SELECT * FROM analysis_results
      WHERE account_id = @accountId AND symbol = @symbol
      ORDER BY created_at DESC
      LIMIT @limit
    `);

    return stmt.all({ accountId, symbol, limit }) as AnalysisResultRow[];
  }

  onApplicationShutdown(): void {
    this.db.close();
  }
}

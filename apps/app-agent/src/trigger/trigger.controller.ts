import { Controller, Param, Post, Headers, Query, HttpException, HttpStatus, Optional, Inject } from '@nestjs/common';
import { WorkflowService } from '../graph/workflow.service.js';
import { BarSourceService } from '../config/bar-source.service.js';

/** Whitelist of allowed symbol values — prevents prompt injection */
const ALLOWED_SYMBOLS = new Set([
  'XAUUSD', 'XAGUSD', 'GOLD', 'GBPJPY', 'EURJPY', 'USDJPY',
  'GBPUSD', 'USDCAD', 'EURUSD', 'AUDUSD', 'NZDUSD', 'USDCNH',
  'US100CASH', 'USOILCASH', 'UKOILCASH', 'GOLDM#', 'SILVERM#',
]);

/** Cooldown window per (account,symbol) to prevent duplicate analysis */
const IDEMPOTENCY_WINDOW_MS = 60_000;

const recentTriggers = new Map<string, number>();

function normalizeSymbolForMatch(symbol: string): string {
  return symbol.trim().toUpperCase();
}

@Controller('api/v2')
export class TriggerController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly barSource: BarSourceService,
    @Optional() @Inject('GOLD_AGENT_API_TOKEN') private readonly apiToken?: string,
  ) {}

  @Post('trigger_analysis/:account/:symbol')
  async triggerAnalysis(
    @Param('account') account: string,
    @Param('symbol') symbol: string,
    @Headers('x-api-token') requestToken: string,
    @Query('force') force?: string,
  ) {
    // 1. Auth: require x-api-token header matching expected token
    if (this.apiToken && requestToken !== this.apiToken) {
      throw new HttpException({ error: 'forbidden', message: 'Invalid or missing API token' }, HttpStatus.FORBIDDEN);
    }

    // 2. Symbol whitelist — prevents prompt injection
    const normalized = normalizeSymbolForMatch(symbol);
    if (!ALLOWED_SYMBOLS.has(normalized)) {
      throw new HttpException({ error: 'bad_request', message: `Symbol '${symbol}' is not allowed` }, HttpStatus.BAD_REQUEST);
    }

    // 3. Account ai_symbols whitelist — exact account contract match, fail closed.
    const accountSymbols = await this.barSource.accountSymbols(account);
    const tradableSymbol = accountSymbols.find((accountSymbol) => normalizeSymbolForMatch(accountSymbol) === normalized);
    if (!tradableSymbol) {
      throw new HttpException(
        { error: 'symbol_not_loaded', message: `Symbol '${symbol}' is not loaded by account '${account}'` },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 4. Idempotency — skip duplicate triggers within 60s
    const idempotencyKey = `${account}:${tradableSymbol}`;
    const lastTrigger = recentTriggers.get(idempotencyKey);
    const now = Date.now();
    if (lastTrigger && (now - lastTrigger) < IDEMPOTENCY_WINDOW_MS) {
      return {
        triggered: false,
        reason: 'recently_triggered',
        account,
        symbol: tradableSymbol,
        timestamp: new Date().toISOString(),
      };
    }
    recentTriggers.set(idempotencyKey, now);

    // Clean stale entries every 20 triggers
    if (recentTriggers.size > 20) {
      for (const [key, ts] of recentTriggers) {
        if (now - ts > IDEMPOTENCY_WINDOW_MS * 2) {
          recentTriggers.delete(key);
        }
      }
    }

    // 5. Execute (force=true skips market-closed check)
    const forceAnalyze = force === 'true' || force === '1';
    await this.workflow.run(account, [tradableSymbol], { forceAnalyze });

    return {
      triggered: true,
      account,
      symbol: tradableSymbol,
      timestamp: new Date().toISOString(),
    };
  }
}

import { Controller, Param, Post, Headers, Query, HttpException, HttpStatus, Optional, Inject } from '@nestjs/common';
import { WorkflowService } from '../graph/workflow.service.js';

/** Whitelist of allowed symbol values — prevents prompt injection */
const ALLOWED_SYMBOLS = new Set([
  'XAUUSD', 'XAGUSD', 'GOLD', 'GBPJPY', 'EURJPY', 'USDJPY',
  'GBPUSD', 'USDCAD', 'EURUSD', 'AUDUSD', 'NZDUSD', 'USDCNH',
  'US100CASH', 'USOILCASH', 'UKOILCASH', 'GOLDM#',
]);

/** Cooldown window per (account,symbol) to prevent duplicate analysis */
const IDEMPOTENCY_WINDOW_MS = 60_000;

const recentTriggers = new Map<string, number>();

@Controller('api/v2')
export class TriggerController {
  constructor(
    private readonly workflow: WorkflowService,
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
    const normalized = symbol.toUpperCase();
    if (!ALLOWED_SYMBOLS.has(normalized)) {
      throw new HttpException({ error: 'bad_request', message: `Symbol '${symbol}' is not allowed` }, HttpStatus.BAD_REQUEST);
    }

    // 3. Idempotency — skip duplicate triggers within 60s
    const idempotencyKey = `${account}:${normalized}`;
    const lastTrigger = recentTriggers.get(idempotencyKey);
    const now = Date.now();
    if (lastTrigger && (now - lastTrigger) < IDEMPOTENCY_WINDOW_MS) {
      return {
        triggered: false,
        reason: 'recently_triggered',
        account,
        symbol: normalized,
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

    // 4. Execute (force=true skips market-closed check)
    const forceAnalyze = force === 'true' || force === '1';
    await this.workflow.run(account, [symbol], { forceAnalyze });

    return {
      triggered: true,
      account,
      symbol: normalized,
      timestamp: new Date().toISOString(),
    };
  }
}

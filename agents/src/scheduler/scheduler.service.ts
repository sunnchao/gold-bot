import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ANALYSIS_QUEUE, POSITION_POLL_QUEUE } from '../constants.js';
import { AppConfigService } from '../config/app-config.service.js';
import { GoldbotApiService } from '../tools/goldbot-api.js';
import { getLogger } from '../utils/logger.js';

export interface SchedulerStatus {
  running: boolean;
  lastRunTime: string | null;
}

const SYMBOL_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class SchedulerService implements OnModuleDestroy, OnModuleInit {
  private running = false;
  private lastRunTime: string | null = null;
  private symbolRefreshTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectQueue(ANALYSIS_QUEUE) private readonly analysisQueue: Queue,
    @InjectQueue(POSITION_POLL_QUEUE) private readonly positionPollQueue: Queue,
    private readonly config: AppConfigService,
    private readonly goldbotApi: GoldbotApiService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshAccountSymbols();
    this.startSymbolRefreshTimer();

    const analysisRepeatableJobs = await this.analysisQueue.getRepeatableJobs();
    for (const job of analysisRepeatableJobs) {
      await this.analysisQueue.removeRepeatableByKey(job.key);
    }

    await this.analysisQueue.add(
      'scheduled-analysis',
      {},
      {
        repeat: {
          pattern: this.config.scheduleCron,
        },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    );

    const positionPollRepeatableJobs = await this.positionPollQueue.getRepeatableJobs();
    for (const job of positionPollRepeatableJobs) {
      await this.positionPollQueue.removeRepeatableByKey(job.key);
    }

    await this.positionPollQueue.add(
      'position-poll',
      {},
      {
        repeat: {
          every: 15 * 60 * 1000,
        },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    );

    this.running = true;
    this.lastRunTime = new Date().toISOString();
  }

  onModuleDestroy(): void {
    if (this.symbolRefreshTimer) {
      clearInterval(this.symbolRefreshTimer);
      this.symbolRefreshTimer = null;
    }
  }

  private startSymbolRefreshTimer(): void {
    if (this.symbolRefreshTimer) {
      clearInterval(this.symbolRefreshTimer);
    }

    this.symbolRefreshTimer = setInterval(() => {
      void this.refreshAccountSymbols();
    }, SYMBOL_REFRESH_INTERVAL_MS);

    this.symbolRefreshTimer.unref();
  }

  private async refreshAccountSymbols(): Promise<void> {
    const logger = getLogger();

    await Promise.all(
      this.config.staticAccounts.map(async (account) => {
        try {
          const { symbols } = await this.goldbotApi.fetchAccountSymbols(account.id);
          if (symbols.length === 0) {
            this.config.updateAccountSymbols(account.id, account.symbols);
            logger.warn(
              { accountId: account.id, fallbackSymbols: account.symbols },
              'Fetched no symbols; keeping configured fallback symbols',
            );
            return;
          }

          this.config.updateAccountSymbols(account.id, symbols);
          logger.info(
            { accountId: account.id, symbols },
            `Fetched symbols: [${symbols.join(', ')}]`,
          );
        } catch (err) {
          this.config.updateAccountSymbols(account.id, account.symbols);
          logger.warn(
            { err, accountId: account.id, fallbackSymbols: account.symbols },
            'Failed to fetch account symbols; keeping configured fallback symbols',
          );
        }
      }),
    );
  }

  getStatus(): SchedulerStatus {
    return {
      running: this.running,
      lastRunTime: this.lastRunTime,
    };
  }
}

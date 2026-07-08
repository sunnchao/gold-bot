import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { OnModuleInit } from '@nestjs/common';
import { ANALYSIS_QUEUE } from '../constants.js';
import { AppConfigService } from '../config/app-config.service.js';
import { WorkflowService } from '../graph/workflow.service.js';
import { AnalysisStoreService } from '../store/analysis-store.service.js';
import { getLogger } from '../utils/logger.js';

export interface AnalysisJobResult {
  succeeded: number;
  failed: number;
  saveFailed: number;
  total: number;
  totalDuration: number;
}

@Processor(ANALYSIS_QUEUE, {
  concurrency: 3,
  // Prevent BullMQ from re-delivering a stalled job while LLM calls are in flight.
  // Worst case: fetch(30s×3) + parallel LLM(120s×3) + risk(120s×3) + mao(120s×3) + publish(30s×3)
  // ≈ 15 min; 10 min buffer keeps jobs alive without duplicate delivery.
  lockDuration: 600_000,
  maxStalledCount: 1,
})
export class AnalysisProcessor extends WorkerHost {
  constructor(
    private readonly config: AppConfigService,
    private readonly workflow: WorkflowService,
    private readonly store: AnalysisStoreService,
    @InjectQueue(ANALYSIS_QUEUE) private readonly analysisQueue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.analysisQueue.clean(0, 100, 'completed');
    await this.analysisQueue.clean(0, 50, 'failed');
  }

  async process(job: Job): Promise<AnalysisJobResult> {
    const logger = getLogger();
    const jobStart = Date.now();
    logger.info({ jobId: job.id, name: job.name }, 'Scheduler: processing job');
    let saveFailed = 0;

    const tasks = this.config.accounts.flatMap((account) =>
      account.symbols.map((symbol) => ({
        accountId: account.id,
        symbol,
      })),
    );

    const results = await Promise.allSettled(
      tasks.map(async ({ accountId, symbol }) => {
        const itemStart = Date.now();
        try {
          const result = await this.workflow.run(accountId, [symbol]);
          const durations = result.durations ?? {};
          const finalSignals = result.finalSignals ?? {};

          const duration = durations[symbol] ?? result.duration ?? Date.now() - itemStart;
          const finalSignal = finalSignals[symbol] ?? result.finalSignal;
          const bias = finalSignal?.bias ?? 'N/A';
          const action = finalSignal?.arbitration?.action ?? 'N/A';

          logger.info(
            { accountId, symbol, duration, bias, action },
            'Scheduler: analysis completed',
          );

          if (finalSignal) {
            try {
              this.store.saveResult(accountId, symbol, finalSignal, duration);
              logger.info({ accountId, symbol }, 'Scheduler: result saved to store');
            } catch (err) {
              saveFailed += 1;
              const errMsg = err instanceof Error ? err.message : String(err);
              logger.error({ err, errMsg, accountId, symbol }, 'Scheduler: saveResult failed');
            }
          }

          return { accountId, symbol };
        } catch (err) {
          const duration = Date.now() - itemStart;
          logger.error(
            { err, accountId, symbol, duration },
            'Scheduler: analysis failed',
          );
          throw err;
        }
      }),
    );

    const succeeded = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.filter((result) => result.status === 'rejected').length;
    const totalDuration = Date.now() - jobStart;
    const total = tasks.length;

    logger.info(
      { jobId: job.id, succeeded, failed, saveFailed, totalDuration, total },
      'Scheduler: job completed',
    );

    return { succeeded, failed, saveFailed, total, totalDuration };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    getLogger().error({ jobId: job?.id, err }, 'Scheduler: job failed');
  }

  @OnWorkerEvent('error')
  onError(err: Error): void {
    getLogger().error({ err }, 'Scheduler: worker error');
  }
}

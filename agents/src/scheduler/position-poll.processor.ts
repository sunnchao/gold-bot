import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { POSITION_POLL_QUEUE } from '../constants.js';
import { AppConfigService } from '../config/app-config.service.js';
import { WorkflowService } from '../graph/workflow.service.js';
import { getLogger } from '../utils/logger.js';

export interface PositionPollJobResult {
  analyzed: number;
  posted: number;
  skipped: number;
  total: number;
}

@Processor(POSITION_POLL_QUEUE, { concurrency: 1 })
export class PositionPollProcessor extends WorkerHost {
  constructor(
    private readonly config: AppConfigService,
    private readonly workflow: WorkflowService,
  ) {
    super();
  }

  async process(job: Job): Promise<PositionPollJobResult> {
    const logger = getLogger();
    logger.info({ jobId: job.id, name: job.name }, 'Position poll: processing job');

    let analyzed = 0;
    let posted = 0;
    let skipped = 0;

    for (const account of this.config.accounts) {
      for (const symbol of account.symbols) {
        // Run workflow but skip Feishu publishing (scheduled-analysis handles that)
        analyzed += 1;
        const result = await this.workflow.run(account.id, [symbol], { skipFeishu: true });
        const finalSignal = result.finalSignal;

        if (!finalSignal || finalSignal.exit_suggestion === 'hold') {
          skipped += 1;
          continue;
        }

        // Publisher inside workflow already posts to goldbot API
        posted += 1;
      }
    }

    const total = this.config.accounts.reduce(
      (count, account) => count + account.symbols.length,
      0,
    );

    logger.info({ jobId: job.id, analyzed, posted, skipped, total }, 'Position poll: job completed');

    return { analyzed, posted, skipped, total };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    getLogger().error({ jobId: job?.id, err }, 'Position poll: job failed');
  }

  @OnWorkerEvent('error')
  onError(err: Error): void {
    getLogger().error({ err }, 'Position poll: worker error');
  }
}

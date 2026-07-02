import type { RuntimeMode } from '@gold-bot/shared-contracts';

export type RuntimeStateRecord = {
  account_id: string;
  mode: RuntimeMode;
  cutover_enabled: boolean;
  updated_at: string;
};

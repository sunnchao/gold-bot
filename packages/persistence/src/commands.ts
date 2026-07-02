import type { CommandSource, CommandStatus } from '@gold-bot/shared-contracts';
import type { EaCommand, EaRecord } from './index.js';

export type CommandCandidate = EaRecord & {
  command_id?: string;
  action: string;
  source: CommandSource;
  symbol?: string;
};

export type StoredCommand = EaCommand & {
  account_id: string;
  status: CommandStatus;
  source: CommandSource;
  created_at: string;
  delivered_at?: string;
  result?: string;
  ticket?: number;
};

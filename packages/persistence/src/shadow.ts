export type ShadowComparison = {
  account_id: string;
  symbol: string;
  protocol_ok: boolean;
  signal_drift: boolean;
  command_drift: boolean;
  oracle_compared: boolean;
  source: 'ea_analysis' | 'position_review' | 'ai_result';
  created_at: string;
};

export type ShadowComparisonFilter = {
  account_id?: string;
  symbol?: string;
  source?: ShadowComparison['source'];
  protocol_ok?: boolean;
  signal_drift?: boolean;
  command_drift?: boolean;
  oracle_compared?: boolean;
  created_at_gte?: string;
  created_at_lte?: string;
};

export type ShadowComparisonSummary = {
  comparisons: number;
  protocol_errors: number;
  signal_drifts: number;
  command_drifts: number;
  oracle_compared: number;
  first_created_at: string;
  last_created_at: string;
};

export type ShadowRuntimeSnapshot = {
  account_id: string;
  symbol: string;
  source: 'ea_analysis' | 'position_review' | 'ai_result';
  signal?: unknown;
  command?: unknown;
  created_at: string;
};

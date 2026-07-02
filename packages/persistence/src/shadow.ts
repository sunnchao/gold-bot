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

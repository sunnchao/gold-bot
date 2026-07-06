export type DecisionStage =
  | 'candidate_signal'
  | 'ai_result'
  | 'risk_gate'
  | 'command_enqueued'
  | 'command_delivered'
  | 'order_result';

export type DecisionStatus = 'pending' | 'accepted' | 'rejected' | 'clamped' | 'delivered' | 'acked' | 'failed';

export type DecisionEvent = {
  id: number;
  decision_id: string;
  account_id: string;
  symbol: string;
  stage: DecisionStage;
  status: DecisionStatus;
  reason_codes: string[];
  summary: Record<string, unknown>;
  related_command_id: string;
  created_at: string;
};

export type DecisionEventInput = Omit<DecisionEvent, 'id'>;

export type DecisionEventFilter = {
  account_id: string;
  symbol?: string;
  status?: DecisionStatus | string;
  limit?: number;
};

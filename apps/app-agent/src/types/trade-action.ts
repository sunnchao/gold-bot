/**
 * TradeAction — function calling 下单动作类型。
 * 由 comprehensive-analyst 第二阶段 invokeWithTools() 产生。
 */

export type TradeActionType =
  | 'place_pending_order'
  | 'place_market_order'
  | 'do_nothing';

export interface PendingOrderAction {
  type: 'place_pending_order';
  side: 'buy' | 'sell';
  entry_price: number;          // 挂单触发价格
  stop_loss: number;
  take_profit_1: number;
  take_profit_2?: number;
  lots: number;                 // profile-constrained MT4 lots
  order_type: 'limit' | 'stop'; // limit=回调入场, stop=突破入场
  expiry_hours?: number;        // 默认 4
  reason: string;               // 中英双语
}

export interface MarketOrderAction {
  type: 'place_market_order';
  side: 'buy' | 'sell';
  stop_loss: number;
  take_profit_1: number;
  take_profit_2?: number;
  lots: number;
  reason: string;
}

export interface DoNothingAction {
  type: 'do_nothing';
  reasoning: string;
}

export type TradeAction = PendingOrderAction | MarketOrderAction | DoNothingAction;

/**
 * Anthropic Messages API tool schema for the second-phase tool_use call.
 * Three tools: place_pending_order / place_market_order / do_nothing.
 * LLM is forced to call exactly one by callers with tool_choice: { type: 'any' }.
 */
export const TRADE_ACTION_TOOLS = [
  {
    name: 'place_pending_order',
    description:
      'Place a pending order (BUY_LIMIT or SELL_LIMIT) that triggers when price reaches a target level. ' +
      'Use this when the LLM suggests a precise entry price DIFFERENT from the current market price ' +
      '(e.g., "等待回调至 4145 入场" — wait for pullback to 4145). ' +
      'Required when entry_price != current market price. ' +
      'The order auto-expires in 4 hours if not triggered.',
    input_schema: {
      type: 'object',
      required: ['side', 'entry_price', 'stop_loss', 'take_profit_1', 'lots', 'order_type', 'reason'],
      properties: {
        side: { type: 'string', enum: ['buy', 'sell'] },
        entry_price: { type: 'number', description: 'Pending order trigger price (must differ from current price)' },
        stop_loss: { type: 'number' },
        take_profit_1: { type: 'number' },
        take_profit_2: { type: 'number' },
        lots: { type: 'number' },
        order_type: { type: 'string', enum: ['limit', 'stop'], description: 'limit=回调入场, stop=突破入场' },
        expiry_hours: { type: 'number', default: 4 },
        reason: { type: 'string', description: 'Bilingual explanation (Chinese first, English in parens)' },
      },
    },
  },
  {
    name: 'place_market_order',
    description:
      'Place a market order at the current bid/ask. Use only when the LLM wants to open IMMEDIATELY ' +
      'at the current price (no entry target).',
    input_schema: {
      type: 'object',
      required: ['side', 'stop_loss', 'take_profit_1', 'lots', 'reason'],
      properties: {
        side: { type: 'string', enum: ['buy', 'sell'] },
        stop_loss: { type: 'number' },
        take_profit_1: { type: 'number' },
        take_profit_2: { type: 'number' },
        lots: { type: 'number' },
        reason: { type: 'string' },
      },
    },
  },
  {
    name: 'do_nothing',
    description:
      'No trade action. Use when the LLM recommends hold / wait for confirmation / no edge. ' +
      'MUST provide a `reasoning` string.',
    input_schema: {
      type: 'object',
      required: ['reasoning'],
      properties: { reasoning: { type: 'string' } },
    },
  },
] as const;

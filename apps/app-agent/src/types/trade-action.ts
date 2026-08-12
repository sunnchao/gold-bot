/**
 * TradeAction — function calling 下单动作类型。
 * 由 comprehensive-analyst 第二阶段 invokeWithTools() 产生。
 */

export type TradeActionType =
  | 'place_pending_order'
  | 'place_market_order'
  | 'modify_order'
  | 'close_order'
  | 'do_nothing';

export interface PendingOrderAction {
  type: 'place_pending_order';
  account_id?: string;
  symbol?: string;
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
  account_id?: string;
  symbol?: string;
  side: 'buy' | 'sell';
  stop_loss: number;
  take_profit_1: number;
  take_profit_2?: number;
  lots: number;
  reason: string;
}

export interface DoNothingAction {
  type: 'do_nothing';
  account_id?: string;
  reasoning: string;
}

export interface ModifyOrderAction {
  type: 'modify_order';
  account_id: string;
  symbol: string;
  ticket: number;
  new_sl?: number;
  new_tp1?: number;
  new_tp2?: number;
  reason: string;
}

export interface CloseOrderAction {
  type: 'close_order';
  account_id: string;
  symbol: string;
  ticket: number;
  reason: string;
}

export type TradeAction =
  | PendingOrderAction
  | MarketOrderAction
  | ModifyOrderAction
  | CloseOrderAction
  | DoNothingAction;

/**
 * Anthropic Messages API tool schema for the second-phase tool_use call.
 * Tools: place_pending_order / place_market_order / modify_order / close_order / do_nothing.
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
      required: ['account_id', 'symbol', 'side', 'entry_price', 'stop_loss', 'take_profit_1', 'lots', 'order_type', 'reason'],
      properties: {
        account_id: { type: 'string', description: 'Target account id. Must match the provided account context.' },
        symbol: { type: 'string', description: 'Exact tradable contract symbol loaded by the target account.' },
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
      required: ['account_id', 'symbol', 'side', 'stop_loss', 'take_profit_1', 'lots', 'reason'],
      properties: {
        account_id: { type: 'string', description: 'Target account id. Must match the provided account context.' },
        symbol: { type: 'string', description: 'Exact tradable contract symbol loaded by the target account.' },
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
    name: 'modify_order',
    description:
      'Modify an existing order for the specified account only. ' +
      'The tuple (account_id, symbol, ticket) must match a position visible in that account context.',
    input_schema: {
      type: 'object',
      required: ['account_id', 'symbol', 'ticket', 'reason'],
      properties: {
        account_id: { type: 'string' },
        symbol: { type: 'string' },
        ticket: { type: 'number' },
        new_sl: { type: 'number' },
        new_tp1: { type: 'number' },
        new_tp2: { type: 'number' },
        reason: { type: 'string' },
      },
    },
  },
  {
    name: 'close_order',
    description:
      'Close an existing order for the specified account only. ' +
      'The tuple (account_id, symbol, ticket) must match a position visible in that account context.',
    input_schema: {
      type: 'object',
      required: ['account_id', 'symbol', 'ticket', 'reason'],
      properties: {
        account_id: { type: 'string' },
        symbol: { type: 'string' },
        ticket: { type: 'number' },
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
      required: ['account_id', 'reasoning'],
      properties: {
        account_id: { type: 'string', description: 'Target account id. Must match the provided account context.' },
        reasoning: { type: 'string' },
      },
    },
  },
] as const;

/**
 * Legacy second-phase tool schema used when MARKET_FIRST_ENABLED=false.
 * This preserves the pre-market-first contract: no account_id/symbol fields
 * and no position-management tools.
 */
export const TRADE_ACTION_TOOLS_LEGACY = [
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

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
  lots: number;                 // 0.01–0.10
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

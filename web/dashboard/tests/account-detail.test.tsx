import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AccountDetailPage } from '../components/account-detail-page'

const mockDetail = {
  status: 'OK',
  account: {
    account_id: '90011087',
    balance: 1000.5,
    equity: 1100.25,
    margin: 88.4,
    free_margin: 1011.85,
    currency: 'USD',
    leverage: 500,
    broker: 'Demo Broker',
    server_name: 'Demo-1',
    connected: true
  },
  market: {
    symbol: 'XAUUSD',
    bid: 3335.55,
    ask: 3335.75,
    spread: 0.2,
    time: '08:00:00'
  },
  positions: [
    {
      ticket: 123456,
      strategy: 'pullback',
      direction: 'BUY',
      lots: 0.2,
      profit: 25.5,
      pnl_percent: 0.38,
      entry_price: 3330.2,
      current_price: 3335.75,
      sl: 3328,
      tp: 3342.5,
      hold_hours: 5.5,
      comment: 'test trade'
    }
  ],
  indicators: {
    H1: {
      close: 3335.75,
      ema20: 3334.4,
      ema50: 3330.2,
      rsi: 52.1,
      adx: 71.5,
      atr: 2.64,
      macd_hist: -0.82,
      bb_upper: 3341.03,
      bb_middle: 0,
      bb_lower: 3330.8,
      stoch_k: 61.4,
      bars_count: 150
    }
  },
  ai_result: {
    bias: 'bullish',
    confidence: 0.84,
    exit_plan: 'hold'
  }
}

describe('AccountDetailPage', () => {
  it('renders account, position and ai result sections', () => {
    render(<AccountDetailPage accountId="90011087" initialData={mockDetail} />)

    expect(screen.getByText('90011087')).toBeInTheDocument()
    expect(screen.getByText('pullback')).toBeInTheDocument()
    expect(screen.getByText(/bullish/i)).toBeInTheDocument()
  })
})

'use client'

import { startTransition, useEffect, useState } from 'react'
import { getAccountDetail, type AccountDetail } from '../lib/api'
import { DashboardShell } from './dashboard-shell'
import { EmptyState, JsonPreview, Panel, ToneBadge, formatMoney, formatNumber } from './ui'

export function AccountDetailPage({
  accountId,
  initialData
}: {
  accountId: string
  initialData?: AccountDetail
}) {
  const [data, setData] = useState<AccountDetail | null>(initialData ?? null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!accountId || initialData) {
      return
    }

    let cancelled = false
    void getAccountDetail(accountId)
      .then((next) => {
        if (cancelled) {
          return
        }
        startTransition(() => {
          setData(next)
        })
        setError('')
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Failed to load account detail.')
        }
      })

    return () => {
      cancelled = true
    }
  }, [accountId, initialData])

  return (
    <DashboardShell
      active="accounts"
      eyebrow="Account Detail"
      title={accountId || 'Account detail'}
      description="Exact compatibility payload rendered from the Go admin API: runtime capital, market snapshot, positions, indicators and latest AI output."
      status={data?.status ?? 'CONNECTING'}
    >
      {error ? (
        <div className="rounded-3xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {!accountId ? (
        <Panel title="Account detail" subtitle="Open an account card from the overview or account fleet page.">
          <EmptyState title="No account selected" detail="The static export shell is ready, but no account ID was resolved from the current path." />
        </Panel>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel title="Capital Snapshot" subtitle={`${data.account.broker} • ${data.account.server_name}`}>
              <div className="metric-grid">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Balance</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatMoney(data.account.balance, data.account.currency)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Equity</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatMoney(data.account.equity, data.account.currency)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Free Margin</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatMoney(data.account.free_margin, data.account.currency)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Leverage</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">1:{data.account.leverage}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <ToneBadge tone={data.account.connected ? 'green' : 'red'}>
                  {data.account.connected ? 'connected' : 'offline'}
                </ToneBadge>
                <ToneBadge tone="blue">{data.market.symbol}</ToneBadge>
              </div>
            </Panel>

            <Panel title="Market Snapshot" subtitle="Latest tick data preserved from the EA wire protocol.">
              <div className="metric-grid">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Bid</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatNumber(data.market.bid)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Ask</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatNumber(data.market.ask)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Spread</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatNumber(data.market.spread)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Tick Time</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{data.market.time || 'n/a'}</p>
                </div>
              </div>
            </Panel>
          </div>

          <Panel title="Open Positions" subtitle="Live positions plus position-management context from the compatibility payload.">
            {data.positions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.2em] text-stone-500">
                    <tr>
                      <th className="pb-3">Ticket</th>
                      <th className="pb-3">Strategy</th>
                      <th className="pb-3">Direction</th>
                      <th className="pb-3">Lots</th>
                      <th className="pb-3">Profit</th>
                      <th className="pb-3">Hold</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.positions.map((position) => (
                      <tr key={position.ticket}>
                        <td className="py-4 pr-4 text-stone-100">{position.ticket}</td>
                        <td className="py-4 pr-4 text-stone-300">{position.strategy}</td>
                        <td className="py-4 pr-4">
                          <ToneBadge tone={position.direction === 'BUY' ? 'green' : 'red'}>{position.direction}</ToneBadge>
                        </td>
                        <td className="py-4 pr-4 text-stone-300">{position.lots}</td>
                        <td className="py-4 pr-4 text-stone-300">{formatMoney(position.profit, data.account.currency)}</td>
                        <td className="py-4 text-stone-300">{position.hold_hours.toFixed(2)}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No positions" detail="The account payload currently reports no open trades." />
            )}
          </Panel>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel title="Indicator Packs" subtitle="Latest enriched bars grouped by timeframe.">
              <div className="space-y-4">
                {Object.entries(data.indicators)
                  .filter(([, pack]) => Boolean(pack))
                  .map(([timeframe, pack]) =>
                    pack ? (
                      <article key={timeframe} className="rounded-2xl bg-black/20 px-4 py-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-100">{timeframe}</p>
                          <ToneBadge tone="blue">{pack.bars_count} bars</ToneBadge>
                        </div>
                        <div className="metric-grid">
                          <Metric label="Close" value={formatNumber(pack.close)} />
                          <Metric label="EMA20" value={formatNumber(pack.ema20)} />
                          <Metric label="EMA50" value={formatNumber(pack.ema50)} />
                          <Metric label="RSI" value={formatNumber(pack.rsi)} />
                          <Metric label="ADX" value={formatNumber(pack.adx)} />
                          <Metric label="ATR" value={formatNumber(pack.atr)} />
                        </div>
                      </article>
                    ) : null
                  )}
              </div>
            </Panel>

            <Panel title="AI Result" subtitle="Latest stored Aurex compatibility result for this account.">
              <JsonPreview value={data.ai_result} />
            </Panel>
          </div>
        </div>
      ) : (
        <Panel title="Loading account detail" subtitle={`Waiting for /api/v1/accounts/${accountId} to respond.`}>
          <EmptyState title="Loading detail" detail="The Go API is preparing the compatibility payload for this account." />
        </Panel>
      )}
    </DashboardShell>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-stone-100">{value}</p>
    </div>
  )
}

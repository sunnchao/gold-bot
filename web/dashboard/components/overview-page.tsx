'use client'

import { startTransition, useEffect, useState } from 'react'
import { connectEventStream } from '../lib/events'
import {
  getOverview,
  resolveDashboardToken,
  type DashboardEvent,
  type OverviewResponse
} from '../lib/api'
import { DashboardShell } from './dashboard-shell'
import { EmptyState, Panel, ToneBadge, formatMoney, formatTimestamp } from './ui'

export function OverviewPage({ initialData }: { initialData?: OverviewResponse }) {
  const [data, setData] = useState<OverviewResponse | null>(initialData ?? null)
  const [events, setEvents] = useState<DashboardEvent[]>([])
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState('')

  useEffect(() => {
    if (initialData) {
      return
    }

    let cancelled = false
    setLoading(true)
    void getOverview()
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
        if (cancelled) {
          return
        }
        setError(reason instanceof Error ? reason.message : 'Failed to load overview.')
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [initialData])

  useEffect(() => {
    const token = resolveDashboardToken()
    if (!token) {
      return
    }
    return connectEventStream(token, (event: DashboardEvent) => {
      setEvents((current) => [event, ...current].slice(0, 8))
    })
  }, [])

  return (
    <DashboardShell
      active="overview"
      eyebrow="Gold Bolt"
      title="Operational Control Surface"
      description="Track account connectivity, market eligibility and cutover readiness from the same snapshot the Go server exposes to operators."
      status={data?.status ?? 'CONNECTING'}
    >
      {error ? (
        <div className="rounded-3xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data?.cards.map((card) => (
          <Panel key={card.title} title={card.title} subtitle={card.detail}>
            <div className="flex items-center justify-between gap-4">
              <p className="text-3xl font-semibold tracking-tight text-stone-50">{card.value}</p>
              <ToneBadge tone={card.tone}>{card.tone}</ToneBadge>
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.9fr]">
        <Panel
          title="Accounts"
          subtitle={
            data ? `Snapshot generated ${formatTimestamp(data.generated_at)} from /api/v1/overview.` : 'Waiting for the first server snapshot.'
          }
        >
          {!data && loading ? (
            <EmptyState title="Loading snapshot" detail="Waiting for the Go API to return the first overview payload." />
          ) : data && data.accounts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.2em] text-stone-500">
                  <tr>
                    <th className="pb-3">Account</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Balance</th>
                    <th className="pb-3">Equity</th>
                    <th className="pb-3">Positions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.accounts.map((account) => (
                    <tr key={account.account_id} className="align-top">
                      <td className="py-4 pr-4">
                        <a href={`/accounts/${account.account_id}/`} className="font-semibold text-stone-50 underline-offset-4 hover:underline">
                          {account.account_id}
                        </a>
                        <p className="mt-1 text-stone-400">{account.broker}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{account.server_name}</p>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="flex flex-wrap gap-2">
                          <ToneBadge tone={account.connected ? 'green' : 'red'}>
                            {account.connected ? 'connected' : 'offline'}
                          </ToneBadge>
                          <ToneBadge tone={account.market_open && account.is_trade_allowed ? 'blue' : 'orange'}>
                            {account.market_open && account.is_trade_allowed ? 'tradeable' : 'restricted'}
                          </ToneBadge>
                        </div>
                      </td>
                      <td className="py-4 pr-4 text-stone-200">{formatMoney(account.balance)}</td>
                      <td className="py-4 pr-4 text-stone-200">{formatMoney(account.equity)}</td>
                      <td className="py-4 text-stone-200">{account.positions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No accounts" detail="No MT4 terminals have reported a runtime snapshot yet." />
          )}
        </Panel>

        <Panel title="Live Event Rail" subtitle="SSE stream from /api/v1/events/stream using the same admin token.">
          {events.length > 0 ? (
            <div className="space-y-3">
              {events.map((event) => (
                <article key={event.event_id} className="rounded-2xl bg-black/20 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-stone-100">{event.event_type}</p>
                    <ToneBadge tone="blue">{event.source}</ToneBadge>
                  </div>
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-stone-500">
                    {event.account_id || 'system'} • {formatTimestamp(event.timestamp)}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No live events yet" detail="When AI results or cutover events are published, they will appear here without reloading the page." />
          )}
        </Panel>
      </div>
    </DashboardShell>
  )
}

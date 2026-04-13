'use client'

import { startTransition, useEffect, useState } from 'react'
import { getAccounts, type OverviewAccount } from '../lib/api'
import { DashboardShell } from './dashboard-shell'
import { EmptyState, Panel, ToneBadge, formatMoney } from './ui'

export function AccountsPage() {
  const [accounts, setAccounts] = useState<OverviewAccount[]>([])
  const [status, setStatus] = useState('CONNECTING')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void getAccounts()
      .then((response) => {
        if (cancelled) {
          return
        }
        startTransition(() => {
          setAccounts(response.accounts)
        })
        setStatus(response.status)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Failed to load accounts.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <DashboardShell
      active="accounts"
      eyebrow="Account Workspace"
      title="Account Fleet"
      description="Drill into the latest runtime snapshots, then pivot into per-account indicators, positions and AI output."
      status={status}
    >
      {error ? (
        <div className="rounded-3xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {accounts.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <Panel key={account.account_id} title={account.account_id} subtitle={`${account.broker} • ${account.server_name}`}>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <ToneBadge tone={account.connected ? 'green' : 'red'}>
                    {account.connected ? 'connected' : 'offline'}
                  </ToneBadge>
                  <ToneBadge tone={account.market_open && account.is_trade_allowed ? 'blue' : 'orange'}>
                    {account.market_open && account.is_trade_allowed ? 'tradeable' : 'restricted'}
                  </ToneBadge>
                </div>
                <div className="metric-grid">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Balance</p>
                    <p className="mt-2 text-xl font-semibold text-stone-50">{formatMoney(account.balance)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Equity</p>
                    <p className="mt-2 text-xl font-semibold text-stone-50">{formatMoney(account.equity)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Positions</p>
                    <p className="mt-2 text-xl font-semibold text-stone-50">{account.positions}</p>
                  </div>
                </div>
                <a
                  href={`/accounts/${account.account_id}/`}
                  className="inline-flex rounded-full bg-amber-300/12 px-4 py-2 text-sm font-medium text-amber-100 ring-1 ring-amber-200/30 transition hover:bg-amber-300/18"
                >
                  Open account detail
                </a>
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel title="Account Fleet" subtitle="No account snapshots are available yet.">
          <EmptyState title="No runtime data" detail="Wait for MT4 clients to send /register and /heartbeat payloads, then refresh this page." />
        </Panel>
      )}
    </DashboardShell>
  )
}

'use client'

import { startTransition, useEffect, useState } from 'react'
import { getAudit, type AuditResponse } from '../lib/api'
import { DashboardShell } from './dashboard-shell'
import { EmptyState, Panel, ToneBadge, formatPercent, formatTimestamp } from './ui'

export function AuditPage({ initialData }: { initialData?: AuditResponse }) {
  const [data, setData] = useState<AuditResponse | null>(initialData ?? null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (initialData) {
      return
    }

    let cancelled = false
    void getAudit()
      .then((next) => {
        if (cancelled) {
          return
        }
        startTransition(() => {
          setData(next)
        })
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Failed to load cutover audit.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [initialData])

  const report = data?.report

  return (
    <DashboardShell
      active="audit"
      eyebrow="Dual-Track Cutover"
      title="Audit & Readiness"
      description="Keep Python-vs-Go parity visible. Replay validation, mirrored traffic drift and protocol error rates all roll up into a single go-live readiness view."
      status={data?.status ?? 'CONNECTING'}
    >
      {error ? (
        <div className="rounded-3xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Readiness" subtitle={data ? `Snapshot generated ${formatTimestamp(data.generated_at)}.` : 'Waiting for cutover report.'}>
          {report ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <ToneBadge tone={report.ready ? 'green' : 'orange'}>{report.ready ? 'ready' : 'not ready'}</ToneBadge>
                {report.last_shadow_event_at ? (
                  <span className="text-sm text-stone-400">Last shadow event: {formatTimestamp(report.last_shadow_event_at)}</span>
                ) : (
                  <span className="text-sm text-stone-500">No mirrored traffic observed yet.</span>
                )}
              </div>
              <div className="metric-grid">
                <Metric label="Protocol Error Rate" value={formatPercent(report.protocol_error_rate)} />
                <Metric label="Signal Drift" value={formatPercent(report.signal_drift_rate)} />
                <Metric label="Command Drift" value={formatPercent(report.command_drift_rate)} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Missing capabilities</p>
                {report.missing_capabilities.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {report.missing_capabilities.map((item) => (
                      <ToneBadge key={item} tone="orange">
                        {item}
                      </ToneBadge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-stone-400">All required capabilities are present. Only threshold compliance decides readiness.</p>
                )}
              </div>
            </div>
          ) : (
            <EmptyState title="No report yet" detail="The Go API has not returned an audit payload yet." />
          )}
        </Panel>

        <Panel title="Cutover Summary" subtitle="Direct reflection of the Go cutover service checks.">
          {data && data.summary.length > 0 ? (
            <div className="space-y-3">
              {data.summary.map((item) => (
                <article key={item.label} className="rounded-2xl bg-black/20 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-stone-100">{item.label}</p>
                    <ToneBadge tone={item.tone}>{item.value}</ToneBadge>
                  </div>
                  <p className="mt-2 text-sm text-stone-400">{item.detail}</p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No summary" detail="The cutover service has not published readiness checks yet." />
          )}
        </Panel>
      </div>
    </DashboardShell>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-stone-50">{value}</p>
    </div>
  )
}

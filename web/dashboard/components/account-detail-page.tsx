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
          setError(reason instanceof Error ? reason.message : '加载账户详情失败。')
        }
      })

    return () => {
      cancelled = true
    }
  }, [accountId, initialData])

  return (
    <DashboardShell
      active="accounts"
      eyebrow="账户详情"
      title={accountId || '账户详情'}
      description="资金快照、市场行情、持仓详情、技术指标和最新 AI 分析结果。"
      status={data?.status ?? '连接中'}
    >
      {error ? (
        <div className="rounded-3xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {!accountId ? (
        <Panel title="账户详情" subtitle="从总览或账户列表页进入查看具体账户。">
          <EmptyState title="未选择账户" detail="静态导出面板已就绪，但未从当前路径解析到账户 ID。" />
        </Panel>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel title="资金快照" subtitle={`${data.account.broker} · ${data.account.server_name}`}>
              <div className="metric-grid">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">余额</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatMoney(data.account.balance, data.account.currency)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">净值</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatMoney(data.account.equity, data.account.currency)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">可用保证金</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatMoney(data.account.free_margin, data.account.currency)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">杠杆</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">1:{data.account.leverage}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <ToneBadge tone={data.account.connected ? 'green' : 'red'}>
                  {data.account.connected ? '已连接' : '离线'}
                </ToneBadge>
                <ToneBadge tone="blue">{data.market.symbol}</ToneBadge>
              </div>
            </Panel>

            <Panel title="行情快照" subtitle="EA 最新推送的 Tick 数据。">
              <div className="metric-grid">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">买价</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatNumber(data.market.bid)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">卖价</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatNumber(data.market.ask)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">点差</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{formatNumber(data.market.spread)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Tick 时间</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-50">{data.market.time || '无'}</p>
                </div>
              </div>
            </Panel>
          </div>

          <Panel title="当前持仓" subtitle="实时持仓列表及仓位管理上下文。">
            {data.positions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.2em] text-stone-500">
                    <tr>
                      <th className="pb-3">订单号</th>
                      <th className="pb-3">策略</th>
                      <th className="pb-3">方向</th>
                      <th className="pb-3">手数</th>
                      <th className="pb-3">盈亏</th>
                      <th className="pb-3">持仓时长</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.positions.map((position) => (
                      <tr key={position.ticket}>
                        <td className="py-4 pr-4 text-stone-100">{position.ticket}</td>
                        <td className="py-4 pr-4 text-stone-300">{position.strategy}</td>
                        <td className="py-4 pr-4">
                          <ToneBadge tone={position.direction === 'BUY' ? 'green' : 'red'}>{position.direction === 'BUY' ? '买入' : '卖出'}</ToneBadge>
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
              <EmptyState title="暂无持仓" detail="当前账户没有未平仓交易。" />
            )}
          </Panel>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel title="技术指标" subtitle="按时间周期分组的最新 K 线指标数据。">
              <div className="space-y-4">
                {Object.entries(data.indicators)
                  .filter(([, pack]) => Boolean(pack))
                  .map(([timeframe, pack]) =>
                    pack ? (
                      <article key={timeframe} className="rounded-2xl bg-black/20 px-4 py-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-100">{timeframe}</p>
                          <ToneBadge tone="blue">{pack.bars_count} 根K线</ToneBadge>
                        </div>
                        <div className="metric-grid">
                          <Metric label="收盘价" value={formatNumber(pack.close)} />
                          <Metric label="EMA20" value={formatNumber(pack.ema20)} />
                          <Metric label="EMA50" value={formatNumber(pack.ema50)} />
                          <Metric label="RSI" value={formatNumber(pack.rsi)} />
                          <Metric label="ADX" value={formatNumber(pack.adx)} />
                          <Metric label="ATR" value={formatNumber(pack.atr)} />
                          {pack.macd_hist != null && <Metric label="MACD柱" value={formatNumber(pack.macd_hist)} />}
                          {pack.stoch_k != null && <Metric label="StochK" value={formatNumber(pack.stoch_k)} />}
                          {pack.stoch_d != null && <Metric label="StochD" value={formatNumber(pack.stoch_d)} />}
                          {pack.vol_sma != null && <Metric label="VolSMA" value={formatNumber(pack.vol_sma)} />}
                          {pack.bb_upper != null && <Metric label="BB上轨" value={formatNumber(pack.bb_upper)} />}
                          {pack.bb_lower != null && <Metric label="BB下轨" value={formatNumber(pack.bb_lower)} />}
                          {pack.fib_382 != null && <Metric label="Fib38.2%" value={formatNumber(pack.fib_382)} />}
                          {pack.fib_618 != null && <Metric label="Fib61.8%" value={formatNumber(pack.fib_618)} />}
                          {pack.pp != null && <Metric label="枢轴PP" value={formatNumber(pack.pp)} />}
                          {pack.r1 != null && <Metric label="R1" value={formatNumber(pack.r1)} />}
                          {pack.s1 != null && <Metric label="S1" value={formatNumber(pack.s1)} />}
                        </div>
                      </article>
                    ) : null
                  )}
              </div>
            </Panel>

            <Panel title="AI 分析结果" subtitle="该账户最新存储的 AI 兼容性分析结果。">
              <JsonPreview value={data.ai_result} />
            </Panel>
          </div>
        </div>
      ) : (
        <Panel title="加载账户详情" subtitle={`正在请求 /api/v1/accounts/${accountId}...`}>
          <EmptyState title="加载中" detail="Go API 正在准备该账户的详细数据。" />
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
import React, { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

// ── Formatters ────────────────────────────────────────────────────────────────

function pct(v) {
  if (v == null) return '-'
  return `${v.toFixed(1)}%`
}

function avgRet(v) {
  if (v == null) return '-'
  return `${v >= 0 ? '+' : ''}${v.toFixed(3)}%`
}

function fmtPhp(n) {
  if (n == null) return '-'
  return '₱' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 0 })
}

function fmtUsd(n) {
  if (n == null) return '-'
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// ── Sub-components ────────────────────────────────────────────────────────────

const SHARPE_COLOR = {
  SUSPICIOUS:  'text-amber-400',
  EXCELLENT:   'text-emerald-400',
  GOOD:        'text-green-400',
  ACCEPTABLE:  'text-blue-400',
  WEAK:        'text-yellow-400',
  NEGATIVE:    'text-red-400',
}

const HORIZON_ROWS = [
  { label: '1h',  pctKey: 'pctPositiveReturn1h',  avgKey: 'avgReturn1h'  },
  { label: '3h',  pctKey: 'pctPositiveReturn3h',  avgKey: 'avgReturn3h'  },
  { label: '6h',  pctKey: 'pctPositiveReturn6h',  avgKey: 'avgReturn6h'  },
  { label: '12h', pctKey: 'pctPositiveReturn12h', avgKey: 'avgReturn12h' },
  { label: '24h', pctKey: 'pctPositiveReturn24h', avgKey: 'avgReturn24h' },
  { label: '72h', pctKey: 'pctPositiveReturn72h', avgKey: 'avgReturn72h' },
]

function StatRow({ label, value, valueClass = 'text-slate-200' }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className={`text-sm font-medium ${valueClass}`}>{value}</span>
    </div>
  )
}

function SectionLabel({ children }) {
  return <p className="label text-xs mb-2 mt-4 first:mt-0">{children}</p>
}

const EquityTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-0.5">{d?.timestamp?.slice(0, 10)}</p>
      <p className="text-white font-bold">{fmtPhp(d?.portfolioPhp)}</p>
      <p className="text-slate-400">{fmtUsd(d?.btcPrice)}/BTC</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BtcBacktestCard() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')  // 'overview' | 'winrates' | 'signals'

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'btc_config', 'btc_backtest_summary'), (snap) => {
      setSummary(snap.exists() ? snap.data() : null)
      setLoading(false)
    }, () => setLoading(false))
    return () => unsub()
  }, [])

  if (loading) {
    return (
      <div className="card">
        <p className="label mb-2">BTC Backtest</p>
        <p className="text-slate-500 text-sm animate-pulse">Loading...</p>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="card">
        <p className="label mb-2">BTC Backtest</p>
        <p className="text-slate-500 text-sm">No backtest data yet.</p>
        <p className="text-slate-600 text-xs mt-2 leading-relaxed">
          Run the <code className="text-slate-400">runBtcBacktest</code> Cloud Function to generate results.
          It runs automatically on the 1st and 15th of each month.
        </p>
      </div>
    )
  }

  const sim  = summary.simulation || {}
  const dd   = summary.drawdown   || {}
  const sr   = summary.sharpeRatio
  const cl   = summary.consecutiveLosses || {}
  const curve = summary.equityCurveSampled || []

  const isGain = (sim.unrealizedPhp ?? 0) >= 0

  // Y domain for equity chart
  const phpValues = curve.map((p) => p.portfolioPhp).filter(Boolean)
  const minPhp = phpValues.length ? Math.min(...phpValues) : 0
  const maxPhp = phpValues.length ? Math.max(...phpValues) : 1

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="label">BTC Backtest — {summary.lookbackDays ?? 365}d</p>
          {summary.computedAt && (
            <p className="text-slate-600 text-xs mt-0.5">
              {new Date(summary.computedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
        <span className="text-slate-500 text-xs">{summary.totalActionable ?? 0} buys</span>
      </div>

      {/* Tab switcher */}
      <div className="flex bg-slate-700/60 rounded-lg p-0.5 gap-0.5 mb-4">
        {[['overview', 'Overview'], ['winrates', 'Win Rates'], ['signals', 'Signals']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-1 rounded-md text-xs font-semibold transition-all ${
              tab === key ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ──────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-4">

          {/* Equity curve chart */}
          {curve.length > 1 && (
            <div>
              <SectionLabel>Portfolio Equity Curve (PHP)</SectionLabel>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={curve} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f97316" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="timestamp" hide />
                  <YAxis
                    domain={[minPhp * 0.95, maxPhp * 1.02]}
                    tick={{ fill: '#64748b', fontSize: 9 }}
                    tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                    width={38}
                  />
                  <Tooltip content={<EquityTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="portfolioPhp"
                    stroke="#f97316"
                    strokeWidth={1.5}
                    fill="url(#equityGrad)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Simulation result */}
          <div className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
            <SectionLabel>Simulated Portfolio (₱/USD {sim.phpPerUsd ?? 57.5}, fee {((sim.feeRate ?? 0.001) * 100).toFixed(1)}%)</SectionLabel>
            <div className="space-y-1.5">
              <StatRow label="BTC Held"     value={`₿ ${sim.btcAccumulated?.toFixed(6) ?? '-'}`} />
              <StatRow label="Avg Cost"     value={fmtUsd(sim.avgCostUsd)} />
              <StatRow label="Invested"     value={fmtPhp(sim.totalInvestedPhp)} />
              <StatRow label="Fees Paid"    value={fmtPhp(sim.totalFeesPaidPhp)} valueClass="text-slate-500" />
              <StatRow label="Portfolio"    value={fmtPhp(sim.portfolioPhp)} />
              <div className="flex justify-between items-center pt-1 border-t border-slate-700">
                <span className="text-slate-400 text-sm">Unrealized</span>
                <div className="text-right">
                  <p className={`text-sm font-bold ${isGain ? 'text-green-400' : 'text-red-400'}`}>
                    {isGain ? '+' : ''}{fmtPhp(sim.unrealizedPhp)}
                  </p>
                  {sim.unrealizedPct != null && (
                    <p className={`text-xs ${isGain ? 'text-green-500' : 'text-red-500'}`}>
                      {isGain ? '+' : ''}{sim.unrealizedPct.toFixed(2)}%
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Risk metrics grid */}
          <div>
            <SectionLabel>Risk Metrics</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {/* CAGR */}
              <div className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
                <p className="label text-xs mb-1">CAGR</p>
                <p className={`text-base font-bold ${(summary.cagr ?? 0) >= 7 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {summary.cagr != null ? `${summary.cagr >= 0 ? '+' : ''}${summary.cagr.toFixed(1)}%` : '-'}
                </p>
                <p className="text-slate-600 text-xs mt-0.5">Beat SPY if &gt; 7–9%</p>
              </div>

              {/* Sharpe */}
              <div className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
                <p className="label text-xs mb-1">Sharpe Ratio</p>
                <p className={`text-base font-bold ${SHARPE_COLOR[sr?.interpretation] ?? 'text-slate-300'}`}>
                  {sr?.annualized != null ? sr.annualized.toFixed(2) : '-'}
                </p>
                <p className="text-slate-600 text-xs mt-0.5">{sr?.interpretation?.replace(/_/g, ' ') ?? '-'}</p>
              </div>

              {/* Max drawdown */}
              <div className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
                <p className="label text-xs mb-1">Max Drawdown</p>
                <p className={`text-base font-bold ${(dd.maxDrawdownPct ?? 0) > 50 ? 'text-red-400' : (dd.maxDrawdownPct ?? 0) > 15 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {dd.maxDrawdownPct != null ? `-${dd.maxDrawdownPct.toFixed(1)}%` : '-'}
                </p>
                <p className="text-slate-600 text-xs mt-0.5">
                  {dd.maxDrawdownDays != null ? `${dd.maxDrawdownDays}d longest` : ''}
                </p>
              </div>

              {/* Avg drawdown */}
              <div className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
                <p className="label text-xs mb-1">Avg Drawdown</p>
                <p className="text-base font-bold text-slate-200">
                  {dd.avgDrawdownDays != null ? `${dd.avgDrawdownDays}d` : '-'}
                </p>
                <p className="text-slate-600 text-xs mt-0.5">
                  {dd.drawdownCount != null ? `${dd.drawdownCount} periods` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* Consecutive losses */}
          <div className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
            <SectionLabel>Consecutive Losing Buys (24h)</SectionLabel>
            <div className="flex gap-6">
              <div>
                <p className="text-slate-500 text-xs">Max streak</p>
                <p className={`text-lg font-bold ${(cl.maxConsecutiveLosses ?? 0) > 5 ? 'text-red-400' : 'text-slate-200'}`}>
                  {cl.maxConsecutiveLosses ?? '-'}
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Avg streak</p>
                <p className="text-lg font-bold text-slate-200">{cl.avgConsecutiveLosses ?? '-'}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Streak count</p>
                <p className="text-lg font-bold text-slate-200">{cl.streakCount ?? '-'}</p>
              </div>
            </div>
            {cl.maxConsecutiveLosses > 0 && (
              <p className="text-slate-600 text-xs mt-2 leading-relaxed">
                Worst case: {cl.maxConsecutiveLosses} buys in a row that were lower 24h later.
                Capital needed for that streak: {fmtPhp((cl.maxConsecutiveLosses ?? 0) * 1000)}.
              </p>
            )}
          </div>

          {/* Win Rate (Price Higher After) */}
          <div>
            <SectionLabel>Win Rate (Price Higher After)</SectionLabel>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: '1h',  pctKey: 'pctPositiveReturn1h',  avgKey: 'avgReturn1h'  },
                { label: '6h',  pctKey: 'pctPositiveReturn6h',  avgKey: 'avgReturn6h'  },
                { label: '24h', pctKey: 'pctPositiveReturn24h', avgKey: 'avgReturn24h' },
                { label: '72h', pctKey: 'pctPositiveReturn72h', avgKey: 'avgReturn72h' },
              ].map(({ label, pctKey, avgKey }) => {
                const wr = summary[pctKey]
                const ar = summary[avgKey]
                const color = wr != null && wr >= 60 ? 'text-emerald-400' : wr != null && wr >= 50 ? 'text-yellow-400' : 'text-red-400'
                return (
                  <div key={label} className="bg-slate-700/40 rounded-lg p-2.5 border border-slate-600 text-center">
                    <p className={`text-lg font-bold ${color}`}>{pct(wr)}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{label}</p>
                    {ar != null && (
                      <p className={`text-xs font-mono mt-1 ${ar >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {avgRet(ar)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Win rates tab ─────────────────────────────────────────────────────── */}
      {tab === 'winrates' && (
        <div className="space-y-4">
          <div>
            <SectionLabel>Win Rate by Horizon ({summary.totalActionable ?? 0} buys)</SectionLabel>
            <div className="space-y-1.5">
              {HORIZON_ROWS.map(({ label, pctKey, avgKey }) => {
                const wr  = summary[pctKey]
                const ar  = summary[avgKey]
                const bar = wr != null ? Math.round(wr) : 0
                const barColor = bar >= 60 ? 'bg-green-500' : bar >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-slate-500 text-xs w-7">{label}</span>
                    <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${bar}%` }} />
                    </div>
                    <span className="text-slate-300 text-xs w-10 text-right">{pct(wr)}</span>
                    <span className={`text-xs w-16 text-right font-mono ${ar != null && ar >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {avgRet(ar)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Bucket breakdown */}
          {summary.bucketWinRates && (
            <div>
              <SectionLabel>Win Rate by Bucket (24h)</SectionLabel>
              <div className="space-y-2">
                {Object.entries(summary.bucketWinRates).map(([bucket, stats]) => (
                  stats.count > 0 && (
                    <div key={bucket} className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-300 text-xs font-medium">{bucket.replace(/_/g, ' ')}</span>
                        <span className="text-slate-500 text-xs">{stats.count} buys</span>
                      </div>
                      <div className="flex gap-4 text-xs">
                        <span>Win: <span className="text-white font-bold">{pct(stats.pct24h)}</span></span>
                        <span>Avg: <span className={`font-bold ${(stats.avg24h ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{avgRet(stats.avg24h)}</span></span>
                      </div>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Hold signal effectiveness */}
          <div className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
            <SectionLabel>NO_BUY Effectiveness</SectionLabel>
            <StatRow
              label={`Price fell within 6h (${summary.noBuyTotal ?? 0} signals)`}
              value={pct(summary.noBuyEffectiveness)}
              valueClass={(summary.noBuyEffectiveness ?? 0) >= 50 ? 'text-green-400' : 'text-yellow-400'}
            />
          </div>
        </div>
      )}

      {/* ── Signals tab ───────────────────────────────────────────────────────── */}
      {tab === 'signals' && (
        <div className="space-y-4">
          <div>
            <SectionLabel>Signal Distribution ({summary.totalHours?.toLocaleString() ?? 0} hours checked)</SectionLabel>
            {summary.signalBreakdown && (
              <div className="space-y-1.5">
                {Object.entries(summary.signalBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([sig, count]) => {
                    const pctOfTotal = summary.totalHours ? (count / summary.totalHours * 100).toFixed(1) : '-'
                    return (
                      <div key={sig} className="flex items-center gap-2">
                        <span className="text-slate-400 text-xs w-28 truncate">{sig.replace(/_/g, ' ')}</span>
                        <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-orange-500"
                            style={{ width: `${pctOfTotal}%` }}
                          />
                        </div>
                        <span className="text-slate-500 text-xs w-8 text-right">{pctOfTotal}%</span>
                        <span className="text-slate-600 text-xs w-10 text-right">{count}</span>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>

          {/* Best / worst */}
          {(summary.bestSignal || summary.worstSignal) && (
            <div>
              <SectionLabel>Best / Worst Buy (24h return)</SectionLabel>
              <div className="space-y-2">
                {summary.bestSignal && (
                  <div className="bg-green-900/30 rounded-lg p-2.5 border border-green-800">
                    <p className="text-green-400 text-xs font-bold">Best: +{summary.bestSignal.return24h?.toFixed(2)}%</p>
                    <p className="text-slate-500 text-xs">{summary.bestSignal.timestamp?.slice(0, 16)} · {summary.bestSignal.signal?.replace(/_/g, ' ')}</p>
                  </div>
                )}
                {summary.worstSignal && (
                  <div className="bg-red-900/30 rounded-lg p-2.5 border border-red-800">
                    <p className="text-red-400 text-xs font-bold">Worst: {summary.worstSignal.return24h?.toFixed(2)}%</p>
                    <p className="text-slate-500 text-xs">{summary.worstSignal.timestamp?.slice(0, 16)} · {summary.worstSignal.signal?.replace(/_/g, ' ')}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sharpe detail */}
          {sr && (
            <div className="bg-slate-700/40 rounded-lg p-3 border border-slate-600">
              <SectionLabel>Sharpe Ratio Detail</SectionLabel>
              <div className="space-y-1">
                <StatRow label="Annualized Sharpe" value={sr.annualized?.toFixed(2)} valueClass={SHARPE_COLOR[sr.interpretation] ?? 'text-slate-300'} />
                <StatRow label="Interpretation" value={sr.interpretation} />
                <StatRow label="Mean 24h return" value={avgRet(sr.meanReturn24h)} />
                <StatRow label="Std dev 24h" value={`${sr.stdReturn24h?.toFixed(3)}%`} />
                <StatRow label="Sample count" value={sr.sampleCount} />
              </div>
              <p className="text-slate-600 text-xs mt-2 leading-relaxed">
                Good: &gt;0.75 · Excellent: &gt;2 · Suspicious if &gt;3 (likely look-ahead bias)
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

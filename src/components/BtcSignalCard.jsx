import React from 'react'

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return '-'
  return Number(n).toFixed(decimals)
}

function fmtUsd(n, decimals = 2) {
  if (n === null || n === undefined) return '-'
  return '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtPhp(n, decimals = 0) {
  if (n === null || n === undefined) return '-'
  return '₱' + Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function toDate(val) {
  if (!val) return null
  if (typeof val === 'string') return new Date(val)
  if (typeof val.toDate === 'function') return val.toDate()
  if (val.seconds) return new Date(val.seconds * 1000)
  return null
}

function formatSignalTime(val) {
  const d = toDate(val)
  if (!d) return null
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' })
  const date = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
  return `${date} · ${time}`
}

function timeAgo(val) {
  const d = toDate(val)
  if (!d) return null
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const SIGNAL_CONFIG = {
  NO_BUY:      { label: 'NO BUY',       bg: 'bg-neutral-800',    text: 'text-slate-300',   border: 'border-neutral-800', dot: 'bg-slate-400'   },
  BUY:         { label: 'BUY',          bg: 'bg-blue-900/60',     text: 'text-blue-300',    border: 'border-blue-600',    dot: 'bg-blue-400'    },
  BUY_MORE:    { label: 'BUY MORE',     bg: 'bg-green-900/60',    text: 'text-green-300',   border: 'border-green-600',   dot: 'bg-green-400'   },
  AGGRESSIVE:  { label: 'AGGRESSIVE',   bg: 'bg-emerald-900/70',  text: 'text-emerald-200', border: 'border-emerald-400', dot: 'bg-emerald-300' },
  PRIORITY_BUY:{ label: 'PRIORITY BUY', bg: 'bg-orange-900/70',   text: 'text-orange-200',  border: 'border-orange-400',  dot: 'bg-orange-300'  },
  OPP_GAP_WAIT:{ label: 'GAP WAIT',    bg: 'bg-yellow-900/40',   text: 'text-yellow-400',  border: 'border-yellow-700',  dot: 'bg-yellow-500'  },
  BUDGET_CAP:  { label: 'BUDGET CAP',   bg: 'bg-red-900/60',      text: 'text-red-300',     border: 'border-red-500',     dot: 'bg-red-400'     },
}

const RSI_COLOR = {
  OVERSOLD:   'text-emerald-400',
  OVERBOUGHT: 'text-red-400',
  NEUTRAL:    'text-slate-300',
  'N/A':      'text-slate-500',
}

const FEAR_COLOR = {
  EXTREME_FEAR:  'text-emerald-400',
  FEAR:          'text-green-400',
  NEUTRAL:       'text-slate-300',
  GREED:         'text-orange-400',
  EXTREME_GREED: 'text-red-400',
  'N/A':         'text-slate-500',
}

export default function BtcSignalCard({ signal }) {
  if (!signal) {
    return (
      <div className="card">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
          <p className="text-slate-400 text-sm">
            No BTC signal yet. The hourly check runs every hour, 24/7.
          </p>
        </div>
      </div>
    )
  }

  const signalKey = signal.signal || 'NO_BUY'
  const config    = SIGNAL_CONFIG[signalKey] || SIGNAL_CONFIG.NO_BUY

  const price        = signal.currentPrice
  const amount       = signal.amount ?? 0
  const hourlyChange = signal.hourlyChange ?? null
  const hourlyPct    = signal.hourlyChangePct ?? null
  const checkedAt    = signal.timestamp ?? null
  const rsi          = signal.rsi ?? null
  const rsiLabel     = signal.rsiLabel ?? 'N/A'
  const fearLabel    = signal.fearGreedLabel ?? 'N/A'
  const fearIndex    = signal.fearGreedIndex ?? null

  const isBuySignal = signal.isActionable && amount > 0
  const isUp   = hourlyChange !== null && hourlyChange > 0
  const isDown = hourlyChange !== null && hourlyChange < 0

  return (
    <div className={`card border-2 ${config.border}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">

        {/* Left: main signal content */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${config.dot}`} />
              <span className="label">Latest BTC Signal</span>
            </div>
            {checkedAt && (
              <span className="text-slate-500 text-xs">
                {formatSignalTime(checkedAt)}
                <span className="text-slate-700 ml-1">· {timeAgo(checkedAt)}</span>
              </span>
            )}
          </div>

          {/* Signal badge + amount */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className={`badge ${config.bg} ${config.text} text-base px-4 py-1.5 font-bold`}>
              {config.label}
            </span>
            {isBuySignal && (
              <span className="text-2xl font-bold text-white">{fmtPhp(amount)}</span>
            )}
          </div>

          {/* Market row */}
          <div className="mb-3">
            <p className="text-slate-600 text-xs font-medium uppercase tracking-wide mb-2">Market</p>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="label">BTC Price</p>
                <p className="text-xl font-bold text-white">
                  {fmtUsd(price, 2)}
                  {price != null && signal.phpPerUsd && (
                    <span className="text-slate-500 text-sm font-medium ml-1">({fmtPhp(price * signal.phpPerUsd, 0)})</span>
                  )}
                </p>
              </div>
              <div>
                <p className="label">1h Change</p>
                <p className={`text-xl font-bold ${isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-300'}`}>
                  {hourlyChange !== null ? (isUp ? '+' : '') : ''}{fmtUsd(hourlyChange, 2)}
                  {hourlyChange != null && signal.phpPerUsd && (
                    <span className="text-sm font-medium ml-1">({hourlyChange >= 0 ? '+' : ''}{fmtPhp(hourlyChange * signal.phpPerUsd, 0)})</span>
                  )}
                  {' '}
                  <span className="text-base font-medium">
                    ({hourlyPct !== null ? (isUp ? '+' : '') + fmt(hourlyPct, 3) : '-'}%)
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Dip signals */}
          {signal.dipSignals && signal.dipSignals.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {signal.dipSignals.map((ds, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded bg-red-900/30 border border-red-700 text-red-400">
                  {ds.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}

          {/* Recommendation */}
          {signal.recommendation && (
            <p className="text-slate-300 text-sm leading-relaxed bg-neutral-900 rounded-lg px-4 py-3 border border-neutral-800">
              {signal.recommendation}
            </p>
          )}
        </div>

        {/* Right: context panel */}
        <div className="sm:w-52 space-y-3">

          {/* RSI */}
          <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
            <p className="label mb-1">RSI (1h)</p>
            <p className={`text-sm font-bold ${RSI_COLOR[rsiLabel] || 'text-slate-300'}`}>
              {rsi != null ? `${rsi.toFixed(1)}` : 'N/A'}
              <span className="text-slate-500 font-normal text-xs ml-1">
                {rsiLabel === 'OVERSOLD' ? 'oversold' : rsiLabel === 'OVERBOUGHT' ? 'overbought' : 'neutral'}
              </span>
            </p>
          </div>

          {/* Fear & Greed */}
          <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
            <p className="label mb-1">Fear & Greed</p>
            <p className={`text-sm font-bold ${FEAR_COLOR[fearLabel] || 'text-slate-300'}`}>
              {fearIndex != null ? fearIndex : 'N/A'}
              <span className="text-slate-500 font-normal text-xs ml-1">
                {fearLabel.replace(/_/g, ' ').toLowerCase()}
              </span>
            </p>
          </div>

          {/* Drawdown */}
          {signal.drawdownPct != null && (
            <div className={`rounded-lg p-3 border ${signal.drawdownPct >= 5 ? 'bg-red-900/30 border-red-700' : signal.drawdownPct >= 3 ? 'bg-orange-900/30 border-orange-700' : 'bg-neutral-900 border-neutral-800'}`}>
              <p className="label mb-1">Drawdown</p>
              <p className={`text-sm font-bold ${signal.drawdownPct >= 5 ? 'text-red-400' : signal.drawdownPct >= 3 ? 'text-orange-400' : 'text-slate-300'}`}>
                -{fmt(signal.drawdownPct, 1)}%
              </p>
              {signal.drawdownHigh != null && (
                <p className="text-slate-500 text-xs mt-0.5">from {fmtUsd(signal.drawdownHigh, 0)}{signal.phpPerUsd ? ` (${fmtPhp(signal.drawdownHigh * signal.phpPerUsd, 0)})` : ''}</p>
              )}
            </div>
          )}

          {/* Volume */}
          {signal.volumeRatio != null && (
            <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
              <p className="label mb-1">Volume</p>
              <p className={`text-sm font-bold ${signal.volumeRatio >= 1.2 ? 'text-emerald-400' : 'text-slate-400'}`}>
                {fmt(signal.volumeRatio, 2)}x avg
              </p>
            </div>
          )}

          {/* Vs Avg Cost */}
          {signal.vsAvg && signal.avgCost && (
            <div className="bg-neutral-900 rounded-lg p-3 border border-neutral-800">
              <p className="label mb-1">vs Avg Cost</p>
              <p className={`text-sm font-bold ${signal.vsAvg === 'BELOW_AVG' ? 'text-green-400' : signal.vsAvg === 'ABOVE_AVG' ? 'text-red-400' : 'text-slate-300'}`}>
                {fmtUsd(signal.avgCost, 0)}
                {signal.phpPerUsd && <span className="text-slate-500 font-normal text-xs ml-1">({fmtPhp(signal.avgCost * signal.phpPerUsd, 0)})</span>}
                <span className="text-slate-500 font-normal text-xs ml-1">
                  {signal.vsAvg === 'BELOW_AVG' ? 'below' : signal.vsAvg === 'ABOVE_AVG' ? 'above' : 'at'}
                </span>
              </p>
            </div>
          )}

          {/* Trend warning */}
          {signal.trendWarning && (
            <div className="bg-yellow-900/30 rounded-lg p-3 border border-yellow-700">
              <p className="label mb-1">Trend</p>
              <p className="text-xs font-bold text-yellow-300">
                {signal.trendWarning.replace(/_/g, ' ')}
              </p>
            </div>
          )}

          {/* Macro drawdown */}
          {signal.macroDrawdownActive && (
            <div className="bg-red-900/30 rounded-lg p-3 border border-red-700">
              <p className="label mb-1">Macro</p>
              <p className="text-xs font-bold text-red-300">DRAWDOWN ACTIVE</p>
              <p className="text-slate-500 text-xs">Buy sizes reduced to 60%</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-neutral-800">
        <p className="text-slate-500 text-xs">
          Hourly buy signal · Drawdown from 30d high · ₱10k/month cap · ₱500–₱1,000 per buy · RSI + Fear&Greed modifiers
        </p>
      </div>
    </div>
  )
}

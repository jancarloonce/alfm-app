import React from 'react'

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return '-'
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtPeso(n) {
  if (n === null || n === undefined || n === 0) return '₱0'
  return '₱' + Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

const SIGNAL_CONFIG = {
  NO_BUY: {
    label: 'NO BUY',
    bg: 'bg-slate-700',
    text: 'text-slate-300',
    border: 'border-slate-600',
    dot: 'bg-slate-400',
    desc: 'NAVPU is too high. Hold and wait for a dip.',
  },
  WATCH: {
    label: 'WATCH',
    bg: 'bg-yellow-900/60',
    text: 'text-yellow-300',
    border: 'border-yellow-600',
    dot: 'bg-yellow-400',
    desc: 'Monitor closely. Small buy only if dip signal confirmed.',
  },
  WATCH_SKIP: {
    label: 'WATCH / SKIP',
    bg: 'bg-yellow-900/40',
    text: 'text-yellow-400',
    border: 'border-yellow-700',
    dot: 'bg-yellow-500',
    desc: 'Watch tier but no dip signal. Skip this one.',
  },
  BUY: {
    label: 'BUY',
    bg: 'bg-blue-900/60',
    text: 'text-blue-300',
    border: 'border-blue-500',
    dot: 'bg-blue-400',
    desc: 'Good entry point. Standard buy recommended.',
  },
  BUY_MORE: {
    label: 'BUY MORE',
    bg: 'bg-green-900/60',
    text: 'text-green-300',
    border: 'border-green-500',
    dot: 'bg-green-400',
    desc: 'Solid dip. Increase your position.',
  },
  AGGRESSIVE: {
    label: 'AGGRESSIVE',
    bg: 'bg-emerald-900/70',
    text: 'text-emerald-300',
    border: 'border-emerald-400',
    dot: 'bg-emerald-400',
    desc: 'Strong dip. Deploy more capital aggressively.',
  },
  PRIORITY_BUY: {
    label: 'PRIORITY BUY',
    bg: 'bg-emerald-900/90',
    text: 'text-emerald-200',
    border: 'border-emerald-300',
    dot: 'bg-emerald-300',
    desc: 'NAVPU is below your avg price. Highest priority entry.',
  },
  NO_SECOND_BUY: {
    label: 'NO 2ND BUY',
    bg: 'bg-orange-900/60',
    text: 'text-orange-300',
    border: 'border-orange-500',
    dot: 'bg-orange-400',
    desc: 'Already bought once this month. No exception applies.',
  },
  MONTHLY_CAP: {
    label: 'MONTHLY CAP',
    bg: 'bg-red-900/60',
    text: 'text-red-300',
    border: 'border-red-500',
    dot: 'bg-red-400',
    desc: 'Monthly buy limit reached (2 buys). Wait until next month.',
  },
}

export default function SignalCard({ signal, todayNavpu, dailyChange }) {
  if (!signal && todayNavpu === null) {
    return (
      <div className="card">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
          <p className="text-slate-400 text-sm">
            No signal generated yet today. The daily function runs at 9:00 AM PH time.
          </p>
        </div>
      </div>
    )
  }

  const signalKey = signal?.signal || 'NO_BUY'
  const config = SIGNAL_CONFIG[signalKey] || SIGNAL_CONFIG.NO_BUY
  const navpu = signal?.todayNavpu ?? todayNavpu
  const change = signal?.dailyChange ?? dailyChange
  const changePct = signal?.dailyChangePct ?? (change !== null && navpu ? ((change / (navpu - change)) * 100).toFixed(2) : null)
  const amount = signal?.amount ?? 0
  const isUp = change !== null && change > 0
  const isDown = change !== null && change < 0

  return (
    <div className={`card border-2 ${config.border}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        {/* Left: Signal info */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-3 h-3 rounded-full ${config.dot}`} />
            <span className="label">Today's Signal</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className={`badge ${config.bg} ${config.text} text-base px-4 py-1.5`}>
              {config.label}
            </span>
            {amount > 0 && (
              <span className="text-2xl font-bold text-white">
                {fmtPeso(amount)}
              </span>
            )}
          </div>

          {/* NAVPU + change */}
          <div className="flex flex-wrap gap-6 mb-4">
            <div>
              <p className="label">NAVPU</p>
              <p className="text-xl font-bold text-white">
                ₱{fmt(navpu, 2)}
              </p>
            </div>
            <div>
              <p className="label">Daily Change</p>
              <p
                className={`text-xl font-bold ${
                  isUp
                    ? 'text-green-400'
                    : isDown
                    ? 'text-red-400'
                    : 'text-slate-300'
                }`}
              >
                {change !== null ? (isUp ? '+' : '') : ''}
                {fmt(change, 4)}{' '}
                <span className="text-base font-medium">
                  ({changePct !== null ? (isUp ? '+' : '') + changePct : '-'}%)
                </span>
              </p>
            </div>
            {signal?.vsAvg && (
              <div>
                <p className="label">vs Avg Price</p>
                <p
                  className={`text-base font-semibold ${
                    signal.vsAvg === 'BELOW_AVG'
                      ? 'text-emerald-400'
                      : signal.vsAvg === 'ABOVE_AVG'
                      ? 'text-slate-400'
                      : 'text-yellow-400'
                  }`}
                >
                  {signal.vsAvg === 'BELOW_AVG'
                    ? 'Below ₱45.48'
                    : signal.vsAvg === 'ABOVE_AVG'
                    ? 'Above ₱45.48'
                    : 'At ₱45.48'}
                </p>
              </div>
            )}
          </div>

          {/* Recommendation */}
          {signal?.recommendation && (
            <p className="text-slate-300 text-sm leading-relaxed bg-slate-700/50 rounded-lg px-4 py-3 border border-slate-600">
              {signal.recommendation}
            </p>
          )}

          {/* Stagger warning */}
          {signal?.staggerWarning && (
            <div className="mt-3 flex items-start gap-2 text-amber-300 bg-amber-900/30 border border-amber-700 rounded-lg px-4 py-3">
              <span className="text-lg">⚠️</span>
              <p className="text-sm font-medium">
                STAGGER WARNING: Extreme drop detected. Consider splitting this buy into 2–3
                smaller purchases over the next few days. Each purchase counts toward your
                monthly cap.
              </p>
            </div>
          )}
        </div>

        {/* Right: Dip signals + flags */}
        <div className="sm:w-56 space-y-3">
          {signal?.dipSignals && signal.dipSignals.length > 0 && (
            <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
              <p className="label mb-2">Dip Signals</p>
              <div className="space-y-1">
                {signal.dipSignals.map((ds) => (
                  <span
                    key={ds}
                    className="block text-xs font-medium text-amber-300 bg-amber-900/30 rounded px-2 py-1"
                  >
                    {ds.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {signal?.divCycle && signal.divCycle !== 'N/A' && (
            <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
              <p className="label mb-1">Dividend Cycle</p>
              <p
                className={`text-xs font-bold ${
                  signal.divCycle === 'POST_RECORD'
                    ? 'text-green-400'
                    : 'text-yellow-400'
                }`}
              >
                {signal.divCycle === 'POST_RECORD'
                  ? 'POST-RECORD WINDOW'
                  : 'PRE-RECORD CAUTION'}
              </p>
            </div>
          )}

          {signal?.trendWarning && (
            <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
              <p className="label mb-1">Trend Warning</p>
              <p className="text-xs font-bold text-orange-400">
                {String(signal.trendWarning).replace(/_/g, ' ')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Execution tip */}
      <div className="mt-4 pt-4 border-t border-slate-700">
        <p className="text-slate-500 text-xs">
          ⏰ Execution tip: Place your order{' '}
          <span className="text-slate-400 font-semibold">before 2:00 PM PH time</span> to
          capture today's NAVPU.
        </p>
      </div>
    </div>
  )
}

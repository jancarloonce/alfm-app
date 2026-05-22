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

function fmtPhp(n) {
  if (n === null || n === undefined || n === 0) return '₱0'
  return '₱' + Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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
  // ── Swing trade signals ──────────────────────────────────────────────────────
  SCAN: {
    label: 'SCANNING',
    bg: 'bg-slate-700',
    text: 'text-slate-300',
    border: 'border-slate-600',
    dot: 'bg-slate-400',
    desc: 'Watching for entry: need -3% to -8% drop + RSI <35 + stabilization.',
  },
  KILL_SWITCH: {
    label: 'KILL SWITCH',
    bg: 'bg-red-900/60',
    text: 'text-red-300',
    border: 'border-red-600',
    dot: 'bg-red-400',
    desc: '7-day decline ≤ -10%. New entries paused for 24h.',
  },
  ENTRY_1: {
    label: 'ENTRY 1 / 3',
    bg: 'bg-orange-900/70',
    text: 'text-orange-200',
    border: 'border-orange-400',
    dot: 'bg-orange-300',
    desc: 'All entry conditions met. Deploy Entry 1 of 3 on PDAX.',
  },
  ADD_ENTRY: {
    label: 'ADD ENTRY',
    bg: 'bg-orange-900/90',
    text: 'text-orange-100',
    border: 'border-orange-300',
    dot: 'bg-orange-200',
    desc: 'Price dropped -2% from last entry. Add next tranche.',
  },
  HOLDING: {
    label: 'HOLDING',
    bg: 'bg-blue-900/60',
    text: 'text-blue-300',
    border: 'border-blue-600',
    dot: 'bg-blue-400',
    desc: 'In position. Waiting for TP or time exit.',
  },
  TP_HIT: {
    label: 'TP HIT +6%',
    bg: 'bg-emerald-900/90',
    text: 'text-emerald-100',
    border: 'border-emerald-300',
    dot: 'bg-emerald-200',
    desc: 'Take Profit hit. Sell ALL on PDAX. (~+5% net)',
  },
  TIME_EXIT: {
    label: 'TIME EXIT',
    bg: 'bg-yellow-900/70',
    text: 'text-yellow-200',
    border: 'border-yellow-500',
    dot: 'bg-yellow-400',
    desc: '120h hold limit reached. Exit at market on PDAX.',
  },
  STOP_LOSS: {
    label: 'STOP LOSS',
    bg: 'bg-red-900/90',
    text: 'text-red-100',
    border: 'border-red-400',
    dot: 'bg-red-300',
    desc: '-8% stop loss hit. Sell ALL on PDAX immediately.',
  },
  // ── Legacy signals (kept for backtest display compat) ────────────────────────
  NO_BUY:      { label: 'NO BUY',      bg: 'bg-slate-700',       text: 'text-slate-300',   border: 'border-slate-600',   dot: 'bg-slate-400'   },
  WATCH_SKIP:  { label: 'WATCH/SKIP',  bg: 'bg-yellow-900/40',   text: 'text-yellow-400',  border: 'border-yellow-700',  dot: 'bg-yellow-500'  },
  BUDGET_CAP:  { label: 'BUDGET CAP', bg: 'bg-red-900/60',      text: 'text-red-300',     border: 'border-red-500',     dot: 'bg-red-400'     },
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

/**
 * BtcSignalCard
 *
 * Displays the latest BTC hourly signal from Firestore (btc_signals collection).
 * Mirrors the ALFM SignalCard layout but uses BTC-specific fields:
 *   - Price in USD instead of NAVPU in PHP
 *   - Hourly change instead of daily change
 *   - RSI and Fear & Greed labels
 *   - No dividend cycle row
 *
 * @param {object|null} signal  Latest doc from btc_signals, or null if no signal yet
 */
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

  const signalKey = signal.signal || 'SCAN'
  const config    = SIGNAL_CONFIG[signalKey] || SIGNAL_CONFIG.SCAN

  const price        = signal.currentPrice
  const amount       = signal.amount ?? 0
  const hourlyChange = signal.hourlyChange ?? null
  const hourlyPct    = signal.hourlyChangePct ?? null
  const checkedAt    = signal.timestamp ?? null
  const rsi          = signal.rsi ?? null

  const isEntry     = signalKey === 'ENTRY_1' || signalKey === 'ADD_ENTRY'
  const isHolding   = signalKey === 'HOLDING'
  const isTP        = signalKey === 'TP_HIT'
  const isExit      = ['TIME_EXIT', 'STOP_LOSS'].includes(signalKey)
  const isScan      = signalKey === 'SCAN' || signalKey === 'KILL_SWITCH'

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
            {isEntry && amount > 0 && (
              <span className="text-2xl font-bold text-white">{fmtPhp(amount)}</span>
            )}
          </div>

          {/* Market · USD row (always visible) */}
          <div className="mb-3">
            <p className="text-slate-600 text-xs font-medium uppercase tracking-wide mb-2">Market · USD</p>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="label">BTC Price</p>
                <p className="text-xl font-bold text-white">{fmtUsd(price, 2)}</p>
              </div>
              <div>
                <p className="label">1h Change</p>
                <p className={`text-xl font-bold ${isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-300'}`}>
                  {hourlyChange !== null ? (isUp ? '+' : '') : ''}{fmtUsd(hourlyChange, 2)}{' '}
                  <span className="text-base font-medium">
                    ({hourlyPct !== null ? (isUp ? '+' : '') + fmt(hourlyPct, 3) : '-'}%)
                  </span>
                </p>
              </div>
              {signal.change24hPct != null && (
                <div>
                  <p className="label">24h Change</p>
                  <p className={`text-xl font-bold ${signal.change24hPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {signal.change24hPct >= 0 ? '+' : ''}{fmt(signal.change24hPct, 2)}%
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Holding / TP / Exit details */}
          {(isHolding || isTP || isExit) && signal.avgEntryPriceUsd != null && (
            <div className={`rounded-xl p-4 mb-4 border ${
              isExit && signalKey === 'STOP_LOSS' ? 'bg-red-900/20 border-red-700' :
              isExit ? 'bg-yellow-900/20 border-yellow-700' :
              isTP ? 'bg-green-900/20 border-green-700' :
              'bg-blue-900/20 border-blue-700'
            }`}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="label text-xs">Avg Entry</p>
                  <p className="text-white font-bold">{fmtUsd(signal.avgEntryPriceUsd, 0)}</p>
                </div>
                <div>
                  <p className="label text-xs">From Entry</p>
                  <p className={`font-bold ${(signal.pctFromEntry ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(signal.pctFromEntry ?? 0) >= 0 ? '+' : ''}{fmt(signal.pctFromEntry, 2)}%
                  </p>
                </div>
                {isHolding && (
                  <>
                    <div>
                      <p className="label text-xs">Next Target</p>
                      <p className="text-blue-300 font-bold">
                        {fmtUsd(signal.tpUsd, 0)}
                        <span className="text-slate-500 text-xs ml-1">TP 100%</span>
                      </p>
                    </div>
                    <div>
                      <p className="label text-xs">Stop Loss</p>
                      <p className="text-red-400 font-bold">{fmtUsd(signal.stopLossUsd, 0)}</p>
                    </div>
                  </>
                )}
                {isTP && (
                  <div className="col-span-2">
                    <p className="text-green-300 text-sm font-bold text-center">
                      {`Sell ALL on PDAX now — position closed${signal.totalDeployedPhp ? ` (~${fmtPhp(signal.totalDeployedPhp * 1.06)})` : ''}`}
                    </p>
                  </div>
                )}
                {isExit && (
                  <div className="col-span-2">
                    <p className={`text-sm font-bold text-center ${signalKey === 'STOP_LOSS' ? 'text-red-300' : 'text-yellow-300'}`}>
                      {signalKey === 'STOP_LOSS' ? 'EXIT ALL IMMEDIATELY — stop loss hit' : 'Exit at market — 120h limit reached'}
                    </p>
                  </div>
                )}
              </div>
              {isHolding && signal.pctFromEntry != null && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">Progress to TP (+6%)</span>
                    <span className="text-blue-400">{fmt(Math.max(0, signal.pctFromEntry), 2)} / 6%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-blue-500 transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, signal.pctFromEntry / 6 * 100))}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recommendation */}
          {signal.recommendation && (
            <p className="text-slate-300 text-sm leading-relaxed bg-slate-700/50 rounded-lg px-4 py-3 border border-slate-600">
              {signal.recommendation}
            </p>
          )}
        </div>

        {/* Right: context panel */}
        <div className="sm:w-52 space-y-3">

          {/* RSI */}
          <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
            <p className="label mb-1">RSI (1h)</p>
            <p className={`text-sm font-bold ${rsi != null && rsi < 35 ? 'text-emerald-400' : rsi != null && rsi > 70 ? 'text-red-400' : 'text-slate-300'}`}>
              {rsi != null ? `${rsi.toFixed(1)}` : 'N/A'}
              <span className="text-slate-500 font-normal text-xs ml-1">
                {rsi != null && rsi < 35 ? 'oversold ✓' : rsi != null && rsi > 70 ? 'overbought' : 'neutral'}
              </span>
            </p>
          </div>

          {/* 24h / 7d change */}
          <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
            <p className="label mb-2">Price Change</p>
            <div className="space-y-1">
              {signal.change24hPct != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">24h</span>
                  <span className={signal.change24hPct < -3 && signal.change24hPct >= -8 ? 'text-emerald-400 font-bold' : signal.change24hPct < -8 ? 'text-red-400' : 'text-slate-300'}>
                    {signal.change24hPct >= 0 ? '+' : ''}{fmt(signal.change24hPct, 2)}%
                    {signal.change24hPct < -3 && signal.change24hPct >= -8 && ' ✓'}
                  </span>
                </div>
              )}
              {signal.change7dPct != null && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">7d</span>
                  <span className={signal.change7dPct <= -10 ? 'text-red-400 font-bold' : 'text-slate-300'}>
                    {signal.change7dPct >= 0 ? '+' : ''}{fmt(signal.change7dPct, 2)}%
                    {signal.change7dPct <= -10 && ' ⚠'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Entry conditions (when scanning) */}
          {isScan && signal.entrySignals && (
            <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
              <p className="label mb-2">Conditions Met</p>
              <div className="space-y-1">
                {(signal.entrySignals || []).map((s, i) => (
                  <p key={i} className="text-xs text-emerald-400">✓ {s}</p>
                ))}
                {(signal.missingConditions || []).slice(0, 3).map((s, i) => (
                  <p key={i} className="text-xs text-slate-500">✗ {s}</p>
                ))}
              </div>
            </div>
          )}

          {/* Macro mode */}
          {signal.macroMode && signal.macroMode !== 'NORMAL' && (
            <div className={`rounded-lg p-3 border ${signal.macroMode === 'PAUSED' ? 'bg-red-900/30 border-red-700' : 'bg-yellow-900/30 border-yellow-700'}`}>
              <p className="label mb-1">Macro Mode</p>
              <p className={`text-xs font-bold ${signal.macroMode === 'PAUSED' ? 'text-red-300' : 'text-yellow-300'}`}>
                {signal.macroMode === 'PAUSED' ? 'KILL SWITCH ACTIVE' : 'REDUCED SIZE (below 200 MA)'}
              </p>
            </div>
          )}

          {/* Volume */}
          {signal.volumeRatio != null && (
            <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
              <p className="label mb-1">Volume</p>
              <p className={`text-sm font-bold ${signal.volumeRatio >= 1.2 ? 'text-emerald-400' : 'text-slate-400'}`}>
                {fmt(signal.volumeRatio, 2)}× avg
                {signal.volumeRatio >= 1.2 && <span className="text-xs ml-1">✓</span>}
              </p>
            </div>
          )}

          {/* Hold time if in position */}
          {isHolding && signal.hoursHeld != null && (
            <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
              <p className="label mb-1">Hold Time</p>
              <p className={`text-sm font-bold ${signal.hoursHeld >= 72 ? 'text-emerald-400' : 'text-slate-300'}`}>
                {signal.hoursHeld}h
                {signal.hoursHeld >= 72 && <span className="text-xs text-emerald-500 ml-1">edge zone</span>}
              </p>
              {signal.hoursToExit != null && (
                <p className="text-slate-600 text-xs mt-0.5">hard exit in {signal.hoursToExit}h</p>
              )}
            </div>
          )}

          {/* TP status if holding */}
          {isHolding && (
            <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
              <p className="label mb-2">Take Profits</p>
              <div className="space-y-1 text-xs">
                {[
                  { label: 'TP +6% · sell ALL', done: false, price: signal.tpUsd },
                ].map(({ label, done, price: tp }, i) => (
                  <div key={i} className={`flex justify-between ${done ? 'text-slate-600 line-through' : 'text-slate-300'}`}>
                    <span>{label}</span>
                    <span className="text-slate-500">{fmtUsd(tp, 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-700">
        <p className="text-slate-500 text-xs">
          ₿ Swing trade · Checks every hour · Entry: -3 to -8% drop + RSI &lt;35 + stabilization · TP +6% sell ALL (~+5% net) · SL -8% · Hard exit 120h
        </p>
      </div>
    </div>
  )
}

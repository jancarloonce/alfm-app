import React from 'react'

function fmtUsd(n, decimals = 2) {
  if (n === null || n === undefined) return '-'
  return '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtPhp(n, decimals = 2) {
  if (n === null || n === undefined) return '-'
  return '₱' + Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmt(n, decimals = 4) {
  if (n === null || n === undefined) return '-'
  return Number(n).toFixed(decimals)
}

const MONTHLY_BUDGET = 10000   // PHP — hard monthly spend cap

/**
 * BtcPositionCard
 *
 * Displays the user's BTC holdings and monthly buy progress.
 * Handles the "no position yet" state gracefully — shows a getting-started
 * hint rather than empty zeroes.
 *
 * Position data comes from Firestore btc_position/current:
 *   units         — BTC held (e.g. 0.001)
 *   avgCost       — average purchase price in USD
 *   totalCostPhp  — total PHP invested
 *   marketValuePhp — current market value in PHP (updated each signal run)
 *
 * Monthly buy progress comes from btc_buys collection query in App.jsx,
 * passed down as monthlyBuyCount (0–4+).
 *
 * @param {object|null} position           btc_position/current doc, or null
 * @param {number|null} currentPriceUsd    Latest BTC price in USD (from signal)
 * @param {number}      monthlySpentPhp    Total PHP spent on BTC this calendar month
 * @param {number|null} phpPerUsd          Exchange rate (optional, for live PHP calc)
 */
export default function BtcPositionCard({ position, currentPriceUsd, monthlySpentPhp, phpPerUsd, btcTrades = [] }) {
  const posState          = position?.state || 'FLAT'
  const currentBalancePhp = position?.currentBalancePhp ?? MONTHLY_BUDGET
  const inPosition        = posState === 'BUILDING' || posState === 'FULL'

  const completedTrades = btcTrades.filter((t) => t.holdHours != null)
  const avgHoldHours    = completedTrades.length > 0
    ? completedTrades.reduce((sum, t) => sum + t.holdHours, 0) / completedTrades.length : null
  const totalProfit     = btcTrades.reduce((sum, t) => sum + (t.estimatedProfitPhp || t.profitPhp || 0), 0)

  // ── FLAT ─────────────────────────────────────────────────────────────────────
  if (!inPosition) {
    return (
      <div className="card h-full">
        <div className="flex items-center justify-between mb-3">
          <p className="label">BTC Position</p>
          <span className="text-xs font-bold px-2 py-0.5 rounded border border-slate-600 bg-slate-700/50 text-slate-400">FLAT</span>
        </div>
        <div className="bg-slate-700/30 rounded-lg px-3 py-2 mb-4 flex justify-between items-center">
          <span className="text-slate-400 text-xs">Available Balance</span>
          <span className="text-white font-bold">{fmtPhp(currentBalancePhp, 0)}</span>
        </div>
        <div className="flex flex-col items-center justify-center py-4 text-center space-y-3">
          <div className="text-3xl text-slate-600">₿</div>
          <p className="text-slate-400 text-sm">No open position.</p>
          <p className="text-slate-500 text-xs leading-relaxed max-w-xs">
            Scanning for entry: -3 to -8% drop + RSI &lt;35 + stabilization. Up to 3 staggered entries of {fmtPhp(currentBalancePhp / 3, 0)} each.
          </p>
          {currentPriceUsd && (
            <div className="bg-slate-700/50 rounded-lg px-4 py-3 border border-slate-600 w-full text-left">
              <p className="label text-xs mb-1">Current BTC Price</p>
              <p className="text-white font-bold text-lg">{fmtUsd(currentPriceUsd, 2)}</p>
            </div>
          )}
        </div>
        {(btcTrades.length > 0) && (
          <div className="border-t border-slate-700/60 mt-3 pt-3 space-y-1">
            {avgHoldHours !== null && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">Avg hold per trade</span>
                <span className="text-slate-500">{avgHoldHours < 24 ? `${avgHoldHours.toFixed(0)}h` : `${(avgHoldHours / 24).toFixed(1)}d`} <span className="text-slate-700">(72h edge zone)</span></span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-slate-600">Completed trades</span>
              <span className="text-slate-500">{btcTrades.length} · {totalProfit >= 0 ? '+' : ''}{fmtPhp(totalProfit, 0)}</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── BUILDING / FULL ──────────────────────────────────────────────────────────
  const exitSignal        = position?.exitSignal || null
  const entries           = position.entries || []
  const entryCount        = position.entryCount || entries.length
  const avgEntryPriceUsd  = position.avgEntryPriceUsd
  const totalDeployedPhp  = position.totalDeployedPhp || 0
  const firstEntryTs      = position.firstEntryTimestamp
  const hardExitTs        = position.hardExitTimestamp
  const stopLossUsd       = position.stopLossUsd
  const tpUsd             = position.tpUsd

  const livePrice      = currentPriceUsd ?? avgEntryPriceUsd
  const unrealizedPct  = avgEntryPriceUsd && livePrice
    ? ((livePrice - avgEntryPriceUsd) / avgEntryPriceUsd) * 100 : null
  const isUp           = unrealizedPct != null && unrealizedPct >= 0

  const holdHours    = firstEntryTs ? Math.round((Date.now() - new Date(firstEntryTs).getTime()) / 3600000) : null
  const hoursToExit  = hardExitTs   ? Math.round((new Date(hardExitTs).getTime() - Date.now()) / 3600000)   : null

  // Progress to TP (+6%)
  const progressToTp = unrealizedPct != null ? Math.min(100, Math.max(0, unrealizedPct / 6 * 100)) : 0

  const stateColor = posState === 'FULL' ? 'border-orange-500 bg-orange-900/50 text-orange-300' : 'border-blue-700 bg-blue-900/50 text-blue-300'

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-3">
        <p className="label">BTC Position</p>
        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${stateColor}`}>
          {posState === 'FULL' ? `FULL · ${entryCount}/3` : `BUILDING · ${entryCount}/3`}
        </span>
      </div>

      {/* Exit alert */}
      {exitSignal && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 mb-3">
          <p className="text-red-300 font-bold text-sm">
            {exitSignal === 'TP_HIT' && '🎯 Take Profit Hit — sell on PDAX now'}
            {exitSignal === 'TIME_EXIT' && '⏰ Time Limit Reached — sell on PDAX now'}
            {exitSignal === 'STOP_LOSS' && '🛑 Stop Loss Hit — sell on PDAX now'}
          </p>
          <p className="text-red-400 text-xs mt-1">Position stays open until you confirm the sell below.</p>
        </div>
      )}

      {/* Balance + deployed */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-slate-700/30 rounded-lg px-3 py-2">
          <p className="text-slate-500 text-xs">Balance</p>
          <p className="text-white font-bold">{fmtPhp(currentBalancePhp, 0)}</p>
        </div>
        <div className="bg-slate-700/30 rounded-lg px-3 py-2">
          <p className="text-slate-500 text-xs">Deployed</p>
          <p className="text-orange-300 font-bold">{fmtPhp(totalDeployedPhp, 0)}</p>
        </div>
      </div>

      {/* Staggered entries */}
      <div className="mb-3">
        <p className="label text-xs mb-2">Entries ({entryCount}/{position.entryCount ?? 3 <= 3 ? 3 : entryCount})</p>
        <div className="space-y-1">
          {entries.map((e, i) => (
            <div key={i} className="flex justify-between items-center bg-slate-700/30 rounded px-2 py-1.5 text-xs">
              <span className="text-slate-400">Entry {i + 1}</span>
              <span className="text-white font-medium">{fmtUsd(e.priceUsd, 0)}</span>
              <span className="text-slate-500">{fmtPhp(e.amountPhp, 0)}</span>
              <span className="text-slate-600">{e.timestamp ? new Date(e.timestamp).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true }) : ''}</span>
            </div>
          ))}
          {Array.from({ length: Math.max(0, 3 - entryCount) }).map((_, i) => (
            <div key={`empty-${i}`} className="flex items-center bg-slate-800/30 rounded px-2 py-1.5 text-xs border border-dashed border-slate-700">
              <span className="text-slate-700">Entry {entryCount + i + 1} — waiting for -2% drop</span>
            </div>
          ))}
        </div>
      </div>

      {/* Avg entry + current + P&L */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="bg-slate-700/30 rounded-lg p-2">
          <p className="text-slate-500 text-xs">Avg Entry</p>
          <p className="text-white font-bold text-sm">{fmtUsd(avgEntryPriceUsd, 0)}</p>
        </div>
        <div className="bg-slate-700/30 rounded-lg p-2">
          <p className="text-slate-500 text-xs">Current</p>
          <p className="text-white font-bold text-sm">{fmtUsd(livePrice, 0)}</p>
        </div>
        <div className="bg-slate-700/30 rounded-lg p-2">
          <p className="text-slate-500 text-xs">P&L</p>
          <p className={`font-bold text-sm ${isUp ? 'text-green-400' : 'text-red-400'}`}>
            {isUp ? '+' : ''}{unrealizedPct?.toFixed(2) ?? '—'}%
          </p>
        </div>
      </div>

      {/* Progress to TP */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-500">Progress to TP (+6%)</span>
          <span className={unrealizedPct != null && unrealizedPct >= 6 ? 'text-green-400' : 'text-slate-400'}>
            {unrealizedPct != null ? `${Math.min(unrealizedPct, 6).toFixed(2)} / 6%` : '—'}
          </span>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-1.5">
          <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${progressToTp}%` }} />
        </div>
      </div>

      {/* Take profit levels */}
      <div className="space-y-1 mb-3">
        {[
          { label: 'TP +6% · sell ALL', triggered: false, price: tpUsd },
        ].map(({ label, triggered, price: tp }, i) => (
          <div key={i} className={`flex justify-between text-xs px-2 py-1 rounded ${triggered ? 'bg-green-900/20 text-green-600 line-through' : 'text-slate-400'}`}>
            <span>{label}</span>
            <span className="text-slate-500">{fmtUsd(tp, 0)}</span>
          </div>
        ))}
        <div className="flex justify-between text-xs px-2 py-1 text-red-700">
          <span>Stop loss -8%</span>
          <span>{fmtUsd(stopLossUsd, 0)}</span>
        </div>
      </div>

      {/* Hold time */}
      <div className="border-t border-slate-700/60 pt-2 space-y-1">
        {holdHours != null && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Holding</span>
            <span className={holdHours >= 72 ? 'text-green-400 font-medium' : 'text-slate-300'}>
              {holdHours < 24 ? `${holdHours}h` : `${(holdHours / 24).toFixed(1)}d`}
              {holdHours >= 72 && ' · edge zone'}
            </span>
          </div>
        )}
        {hoursToExit != null && hoursToExit > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-600">Hard exit in</span>
            <span className={hoursToExit < 24 ? 'text-yellow-500' : 'text-slate-500'}>
              {hoursToExit < 24 ? `${hoursToExit}h` : `${(hoursToExit / 24).toFixed(1)}d`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

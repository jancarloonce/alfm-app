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

const MONTHLY_BUDGET = 10000

export default function BtcPositionCard({ position, currentPriceUsd, monthlySpentPhp, phpPerUsd, totalRealizedPnlPhp }) {
  const units        = position?.units ?? 0
  const avgCost      = position?.avgCost ?? 0
  const totalCostPhp = position?.totalCostPhp ?? 0
  const hasPosition  = units > 0

  const budgetUsed    = monthlySpentPhp ?? 0
  const budgetPct     = Math.min(100, (budgetUsed / MONTHLY_BUDGET) * 100)
  const budgetLeft    = Math.max(0, MONTHLY_BUDGET - budgetUsed)

  const marketValuePhp = hasPosition && currentPriceUsd && phpPerUsd
    ? units * currentPriceUsd * phpPerUsd
    : null
  const unrealizedPhp = marketValuePhp !== null ? marketValuePhp - totalCostPhp : null
  const unrealizedPct = totalCostPhp > 0 && unrealizedPhp !== null
    ? (unrealizedPhp / totalCostPhp) * 100
    : null
  const isUp = unrealizedPhp !== null && unrealizedPhp >= 0

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-3">
        <p className="label">BTC Position</p>
        {hasPosition ? (
          <span className="text-xs font-bold px-2 py-0.5 rounded border border-orange-600 bg-orange-900/50 text-orange-300">
            HOLDING
          </span>
        ) : (
          <span className="text-xs font-bold px-2 py-0.5 rounded border border-neutral-800 bg-neutral-800/50 text-slate-400">
            NO POSITION
          </span>
        )}
      </div>

      {/* Monthly budget progress */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-500">Monthly Budget</span>
          <span className="text-slate-400">{fmtPhp(budgetUsed, 0)} / {fmtPhp(MONTHLY_BUDGET, 0)}</span>
        </div>
        <div className="w-full bg-neutral-800 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${budgetPct >= 100 ? 'bg-red-500' : budgetPct >= 75 ? 'bg-yellow-500' : 'bg-orange-500'}`}
            style={{ width: `${budgetPct}%` }}
          />
        </div>
        <p className="text-slate-600 text-xs mt-1">{fmtPhp(budgetLeft, 0)} remaining</p>
      </div>

      {hasPosition ? (
        <>
          {/* Current value hero */}
          {marketValuePhp !== null && (
            <div className="text-center mb-4">
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">Current Value</p>
              <p className="text-white font-bold text-2xl">{fmtPhp(marketValuePhp, 0)}</p>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className={`font-bold text-sm ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                  {isUp ? '+' : ''}{fmtPhp(unrealizedPhp, 0)}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${isUp ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
                  {unrealizedPct !== null ? (isUp ? '+' : '') + unrealizedPct.toFixed(2) + '%' : '-'}
                </span>
              </div>
            </div>
          )}

          {/* Realized P&L */}
          {totalRealizedPnlPhp != null && totalRealizedPnlPhp !== 0 && (
            <div className="flex items-center justify-between bg-neutral-900 rounded-lg px-3 py-2 mb-4">
              <p className="text-slate-500 text-xs">Realized P&L</p>
              <p className={`font-bold text-sm ${totalRealizedPnlPhp >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {totalRealizedPnlPhp >= 0 ? '+' : ''}{fmtPhp(totalRealizedPnlPhp, 0)}
              </p>
            </div>
          )}

          {/* Position details */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-neutral-900 rounded-lg px-3 py-2">
              <p className="text-slate-500 text-xs">BTC Held</p>
              <p className="text-white font-bold text-sm">{fmt(units, 6)}</p>
            </div>
            <div className="bg-neutral-900 rounded-lg px-3 py-2">
              <p className="text-slate-500 text-xs">Avg Cost</p>
              <p className="text-white font-bold text-sm">
                {fmtUsd(avgCost, 0)}
                {phpPerUsd && avgCost ? <span className="text-slate-500 font-normal text-xs ml-1">({fmtPhp(avgCost * phpPerUsd, 0)})</span> : null}
              </p>
            </div>
            <div className="bg-neutral-900 rounded-lg px-3 py-2">
              <p className="text-slate-500 text-xs">Invested</p>
              <p className="text-slate-200 font-bold text-sm">{fmtPhp(totalCostPhp, 0)}</p>
            </div>
            {currentPriceUsd && (
              <div className="bg-neutral-900 rounded-lg px-3 py-2">
                <p className="text-slate-500 text-xs">BTC Price</p>
                <p className="text-white font-bold text-sm">
                  {fmtUsd(currentPriceUsd, 0)}
                  {phpPerUsd ? <span className="text-slate-500 font-normal text-xs ml-1">({fmtPhp(currentPriceUsd * phpPerUsd, 0)})</span> : null}
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-4 text-center space-y-3">
          <div className="text-3xl text-slate-600">₿</div>
          <p className="text-slate-400 text-sm">No BTC position yet.</p>
          <p className="text-slate-500 text-xs leading-relaxed max-w-xs">
            The engine checks hourly and recommends ₱500–₱1,000 buys when conditions are right.
          </p>
          {currentPriceUsd && (
            <div className="bg-neutral-900 rounded-lg px-4 py-3 border border-neutral-800 w-full text-left">
              <p className="label text-xs mb-1">Current BTC Price</p>
              <p className="text-white font-bold text-lg">
                {fmtUsd(currentPriceUsd, 2)}
                {phpPerUsd ? <span className="text-slate-500 font-normal text-sm ml-1">({fmtPhp(currentPriceUsd * phpPerUsd, 0)})</span> : null}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

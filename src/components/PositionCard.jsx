import React from 'react'

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return '-'
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtPeso(n, decimals = 2) {
  if (n === null || n === undefined) return '-'
  return (
    '₱' +
    Number(n).toLocaleString('en-PH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}

export default function PositionCard({ position, todayNavpu, monthlyBuyCount, dividendBuyDone, rspBuyDone }) {
  if (!position) {
    return (
      <div className="card">
        <p className="label mb-3">Your Position</p>
        <p className="text-slate-500 text-sm">No position data available.</p>
      </div>
    )
  }

  // If we have today's navpu, recalculate market value and unrealized gain
  const liveNavpu = todayNavpu ?? position.avgPrice
  const units = position.units
  const avgPrice = position.avgPrice
  const totalCost = position.totalCost
  const marketValue = units * liveNavpu
  const unrealizedGain = marketValue - totalCost
  const unrealizedGainPct = totalCost > 0 ? (unrealizedGain / totalCost) * 100 : 0

  const isGain = unrealizedGain >= 0

  const oppDots = [0, 1].map((i) => ({
    filled: i < monthlyBuyCount,
    capped: monthlyBuyCount >= 2,
  }))

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-4">
        <p className="label">Your Position</p>
        <div className="flex items-center gap-3">
          {/* Opportunity bucket */}
          <div className="flex items-center gap-1" title={`Opportunity buys: ${monthlyBuyCount}/2`}>
            {oppDots.map((dot, i) => (
              <div
                key={i}
                className={`w-2.5 h-2.5 rounded-full border-2 transition-colors ${
                  dot.capped && dot.filled
                    ? 'bg-red-500 border-red-400'
                    : dot.filled
                    ? 'bg-emerald-500 border-emerald-400'
                    : 'bg-transparent border-neutral-800'
                }`}
              />
            ))}
            <span className="text-slate-500 text-xs">Opp {monthlyBuyCount}/2</span>
          </div>
          {/* Divider */}
          <span className="text-slate-700 text-xs">·</span>
          {/* Dividend bucket */}
          <div className="flex items-center gap-1" title={dividendBuyDone ? 'Dividend buy used this month' : 'Dividend buy available'}>
            <div
              className={`w-2.5 h-2.5 rounded-full border-2 transition-colors ${
                dividendBuyDone ? 'bg-amber-500 border-amber-400' : 'bg-transparent border-neutral-800'
              }`}
            />
            <span className={`text-xs ${dividendBuyDone ? 'text-amber-500' : 'text-slate-500'}`}>
              Div {dividendBuyDone ? '1/1' : '0/1'}
            </span>
          </div>
          {/* RSP bucket (BPI Bond only) */}
          {rspBuyDone !== undefined && (
            <>
              <span className="text-slate-700 text-xs">·</span>
              <div className="flex items-center gap-1" title={rspBuyDone ? 'RSP ₱1k done this month' : 'RSP ₱1k pending'}>
                <div
                  className={`w-2.5 h-2.5 rounded-full border-2 transition-colors ${
                    rspBuyDone ? 'bg-violet-500 border-violet-400' : 'bg-transparent border-neutral-800'
                  }`}
                />
                <span className={`text-xs ${rspBuyDone ? 'text-violet-400' : 'text-slate-500'}`}>
                  RSP {rspBuyDone ? '1/1' : '0/1'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-end">
          <div>
            <p className="label text-xs">Units Held</p>
            <p className="text-xl font-bold text-white">{fmt(units, 2)}</p>
          </div>
          <div className="text-right">
            <p className="label text-xs">Avg Price</p>
            <p className="text-xl font-bold text-white">{fmtPeso(avgPrice, 2)}</p>
          </div>
        </div>

        <div className="border-t border-neutral-800 pt-3 space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400 text-sm">Total Cost</span>
            <span className="text-slate-200 text-sm font-medium">{fmtPeso(totalCost, 2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 text-sm">Market Value</span>
            <span className="text-slate-200 text-sm font-medium">{fmtPeso(marketValue, 2)}</span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-neutral-800">
            <span className="text-slate-400 text-sm">Unrealized {isGain ? 'Gain' : 'Loss'}</span>
            <div className="text-right">
              <p
                className={`text-sm font-bold ${
                  isGain ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {isGain ? '+' : ''}{fmtPeso(unrealizedGain, 2)}
              </p>
              <p
                className={`text-xs ${isGain ? 'text-green-500' : 'text-red-500'}`}
              >
                {isGain ? '+' : ''}{fmt(unrealizedGainPct, 2)}%
              </p>
            </div>
          </div>
        </div>

        {todayNavpu && (
          <p className="text-slate-600 text-xs pt-1">
            Live calc using NAVPU ₱{fmt(todayNavpu, 2)}
          </p>
        )}
      </div>
    </div>
  )
}

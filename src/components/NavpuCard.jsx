import React from 'react'

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return '-'
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function getTierForNavpu(navpu, avgPrice, thresholds) {
  if (navpu === null || navpu === undefined) return null
  const ap = avgPrice || 45.48
  if (navpu < ap) return 'PRIORITY BUY'
  if (thresholds) {
    if (navpu >= thresholds.noBuyThreshold) return 'NO BUY'
    if (navpu >= thresholds.watchThreshold) return 'WATCH'
    if (navpu >= thresholds.buyThreshold) return 'BUY'
    if (navpu >= thresholds.buyMoreThreshold) return 'BUY MORE'
    return 'AGGRESSIVE'
  }
  if (navpu >= 46.50) return 'NO BUY'
  if (navpu >= 46.20) return 'WATCH'
  if (navpu >= 46.00) return 'BUY'
  if (navpu >= 45.80) return 'BUY MORE'
  return 'AGGRESSIVE'
}

export default function NavpuCard({ todayNavpu, dailyChange, navHigh, navLow, navMean, thresholds }) {
  const avgPrice = 45.48 // will come from position in future
  const isUp = dailyChange !== null && dailyChange > 0
  const isDown = dailyChange !== null && dailyChange < 0
  const tier = getTierForNavpu(todayNavpu, avgPrice, thresholds)

  const changePct =
    dailyChange !== null && todayNavpu !== null
      ? ((dailyChange / (todayNavpu - dailyChange)) * 100).toFixed(2)
      : null

  return (
    <div className="card h-full">
      <p className="label mb-4">NAVPU Today</p>

      {/* Main NAVPU */}
      <div className="text-center mb-4">
        <p className="text-4xl font-black text-white">
          ₱{fmt(todayNavpu, 2)}
        </p>
        <div
          className={`mt-2 text-lg font-semibold ${
            isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-400'
          }`}
        >
          {dailyChange !== null ? (
            <>
              {isUp ? '▲' : isDown ? '▼' : '-'} {isUp ? '+' : ''}
              {fmt(dailyChange, 4)}{' '}
              <span className="text-sm">
                ({isUp ? '+' : ''}{changePct}%)
              </span>
            </>
          ) : (
            'No change data'
          )}
        </div>
        {tier && (
          <div className="mt-2">
            <span
              className={`text-xs font-bold px-3 py-1 rounded-full ${
                tier === 'NO BUY'
                  ? 'bg-slate-700 text-slate-300'
                  : tier === 'WATCH'
                  ? 'bg-yellow-900 text-yellow-300'
                  : tier === 'BUY'
                  ? 'bg-blue-900 text-blue-300'
                  : tier === 'BUY MORE'
                  ? 'bg-green-900 text-green-300'
                  : 'bg-emerald-900 text-emerald-300'
              }`}
            >
              {tier}
            </span>
          </div>
        )}
      </div>

      {/* 90-day stats */}
      <div className="border-t border-slate-700 pt-3 space-y-2">
        <p className="label text-xs mb-2">90-Day Range</p>
        <div className="flex justify-between">
          <span className="text-slate-400 text-sm">High</span>
          <span className="text-green-400 text-sm font-medium">₱{fmt(navHigh, 2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400 text-sm">Mean</span>
          <span className="text-slate-300 text-sm font-medium">₱{fmt(navMean, 2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400 text-sm">Low</span>
          <span className="text-red-400 text-sm font-medium">₱{fmt(navLow, 2)}</span>
        </div>
      </div>

      {/* Tier reference */}
      <div className="border-t border-slate-700 pt-3 mt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="label text-xs">Buy Tiers</p>
          {thresholds && (
            <span className="text-slate-500 text-xs">{thresholds.dataPoints} days data</span>
          )}
        </div>
        <div className="space-y-1">
          {(thresholds ? [
            { range: `≥ ₱${fmt(thresholds.noBuyThreshold)}`, label: 'No Buy', color: 'text-slate-400' },
            { range: `₱${fmt(thresholds.watchThreshold)}–${fmt(thresholds.noBuyThreshold - 0.01)}`, label: 'Watch (₱1k)', color: 'text-yellow-400' },
            { range: `₱${fmt(thresholds.buyThreshold)}–${fmt(thresholds.watchThreshold - 0.01)}`, label: 'Buy (₱2.5k)', color: 'text-blue-400' },
            { range: `₱${fmt(thresholds.buyMoreThreshold)}–${fmt(thresholds.buyThreshold - 0.01)}`, label: 'Buy More (₱3.5k)', color: 'text-green-400' },
            { range: `< ₱${fmt(thresholds.buyMoreThreshold)}`, label: 'Aggressive (₱5k)', color: 'text-emerald-400' },
            { range: `< ₱${fmt(avgPrice)}`, label: 'Priority Buy (₱5k)', color: 'text-emerald-300' },
          ] : [
            { range: '≥ 46.50', label: 'No Buy', color: 'text-slate-400' },
            { range: '46.20–46.49', label: 'Watch (₱1k)', color: 'text-yellow-400' },
            { range: '46.00–46.19', label: 'Buy (₱2.5k)', color: 'text-blue-400' },
            { range: '45.80–45.99', label: 'Buy More (₱3.5k)', color: 'text-green-400' },
            { range: '≤ 45.79', label: 'Aggressive (₱5k)', color: 'text-emerald-400' },
            { range: '< 45.48', label: 'Priority Buy (₱5k)', color: 'text-emerald-300' },
          ]).map((t) => (
            <div key={t.range} className="flex justify-between text-xs">
              <span className="text-slate-500">{t.range}</span>
              <span className={t.color}>{t.label}</span>
            </div>
          ))}
        </div>
        {thresholds && (
          <p className="text-slate-600 text-xs mt-2">
            Auto-updated · {new Date(thresholds.computedAt).toLocaleDateString('en-PH')}
          </p>
        )}
      </div>
    </div>
  )
}

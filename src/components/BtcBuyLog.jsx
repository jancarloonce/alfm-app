import React from 'react'

function fmtPhp(n) {
  if (n == null) return '-'
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtUsd(n) {
  if (n == null) return '-'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const SIGNAL_BADGE = {
  BUY:          'bg-blue-900/60 text-blue-300',
  BUY_MORE:     'bg-green-900/60 text-green-300',
  AGGRESSIVE:   'bg-emerald-900/70 text-emerald-300',
  PRIORITY_BUY: 'bg-emerald-900/90 text-emerald-200',
  WATCH:        'bg-yellow-900/60 text-yellow-300',
}

/**
 * BtcBuyLog
 *
 * Displays the chronological buy history from the btc_buys collection.
 *
 * @param {Array} buys  Array of btc_buys documents, sorted newest-first
 */
export default function BtcBuyLog({ buys = [] }) {
  if (buys.length === 0) {
    return (
      <div className="card">
        <p className="label mb-3">BTC Buy Log</p>
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
          <div className="text-3xl">₿</div>
          <p className="text-slate-400 text-sm">No buys recorded yet.</p>
          <p className="text-slate-500 text-xs">
            Tap <span className="text-orange-400 font-medium">₿ I Bought</span> after each purchase to log it here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <p className="label">BTC Buy Log</p>
        <span className="text-slate-500 text-xs">{buys.length} buy{buys.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {buys.map((buy, i) => {
          const badgeClass = SIGNAL_BADGE[buy.signalName] || 'bg-slate-700 text-slate-300'
          return (
            <div
              key={buy.id ?? i}
              className="bg-slate-700/40 rounded-lg px-3 py-2.5 border border-slate-600"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-slate-300 text-sm font-medium">{buy.date}</span>
                    {buy.signalName && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badgeClass}`}>
                        {buy.signalName.replace(/_/g, ' ')}
                      </span>
                    )}
                    {buy.bucket === 'extreme_override' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 font-medium">
                        EXTREME
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
                    <span>Price: <span className="text-slate-300">{fmtUsd(buy.btcPriceUsd)}</span></span>
                    <span>Rate: <span className="text-slate-300">₱{buy.phpPerUsd?.toFixed(2) ?? '-'}/USD</span></span>
                    <span>Avg after: <span className="text-slate-300">{fmtUsd(buy.avgCostAfterUsd)}</span></span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-white font-bold text-sm">{fmtPhp(buy.amountPhp)}</p>
                  <p className="text-slate-500 text-xs">₿ {buy.unitsBought?.toFixed(6) ?? '-'}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

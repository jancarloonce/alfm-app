import React from 'react'

function fmtPhp(n, decimals = 0) {
  if (n == null) return '-'
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtUsd(n) {
  if (n == null) return '-'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtTime(ts) {
  if (!ts) return null
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (isNaN(d)) return null
  return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' })
}

const SIGNAL_BADGE = {
  BUY:          'bg-blue-900/60 text-blue-300',
  BUY_MORE:     'bg-green-900/60 text-green-300',
  AGGRESSIVE:   'bg-emerald-900/70 text-emerald-300',
  PRIORITY_BUY: 'bg-emerald-900/90 text-emerald-200',
}

export default function BtcBuyLog({ buys = [], phpPerUsd }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <p className="label">BTC Buy Log</p>
        {buys.length > 0 && (
          <span className="text-xs text-slate-500">{buys.length} buys</span>
        )}
      </div>

      {buys.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
          <div className="text-3xl">₿</div>
          <p className="text-slate-400 text-sm">No buys recorded yet.</p>
          <p className="text-slate-500 text-xs">
            Tap <span className="text-orange-400 font-medium">₿ I Bought</span> after each purchase to log it here.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {buys.map((buy, i) => {
            const badgeClass = SIGNAL_BADGE[buy.signalName] || 'bg-neutral-800 text-slate-300'
            return (
              <div key={buy.id ?? i} className="bg-neutral-900 rounded-lg px-3 py-2.5 border border-neutral-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-slate-300 text-sm font-medium">{buy.date}{fmtTime(buy.timestamp || buy.createdAt) && <span className="text-slate-500 font-normal text-xs ml-1">{fmtTime(buy.timestamp || buy.createdAt)}</span>}</span>
                      {buy.signalName && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badgeClass}`}>
                          {buy.signalName.replace(/_/g, ' ')}
                        </span>
                      )}
                      {buy.bucket === 'extreme_override' && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 font-medium">EXTREME</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
                      <span>Price: <span className="text-slate-300">{fmtUsd(buy.btcPriceUsd)}</span>{phpPerUsd && buy.btcPriceUsd ? <span className="text-slate-500"> ({fmtPhp(buy.btcPriceUsd * phpPerUsd)})</span> : null}</span>
                      <span>Rate: <span className="text-slate-300">₱{buy.phpPerUsd?.toFixed(2) ?? '-'}/USD</span></span>
                      <span>Avg after: <span className="text-slate-300">{fmtUsd(buy.avgCostAfterUsd)}</span>{phpPerUsd && buy.avgCostAfterUsd ? <span className="text-slate-500"> ({fmtPhp(buy.avgCostAfterUsd * phpPerUsd)})</span> : null}</span>
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
      )}
    </div>
  )
}

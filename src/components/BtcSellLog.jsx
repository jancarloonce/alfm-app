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

export default function BtcSellLog({ sells = [], phpPerUsd }) {
  const totalRealized = sells.reduce((sum, s) => sum + (s.realizedPnlPhp || 0), 0)

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <p className="label">BTC Sell Log</p>
        {sells.length > 0 && (
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${totalRealized >= 0 ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
            {totalRealized >= 0 ? '+' : ''}{fmtPhp(totalRealized)}
          </span>
        )}
      </div>

      {sells.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
          <div className="text-3xl">₿</div>
          <p className="text-slate-400 text-sm">No sells recorded yet.</p>
          <p className="text-slate-500 text-xs">
            Tap <span className="text-neutral-300 font-medium">₿ I Sold</span> after each sale to log it here.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {sells.map((sell, i) => {
            const pnl = sell.realizedPnlPhp ?? 0
            const isProfit = pnl >= 0
            return (
              <div key={sell.id ?? i} className="bg-neutral-900 rounded-lg px-3 py-2.5 border border-neutral-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-slate-300 text-sm font-medium">{sell.date}{fmtTime(sell.timestamp || sell.createdAt) && <span className="text-slate-500 font-normal text-xs ml-1">{fmtTime(sell.timestamp || sell.createdAt)}</span>}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${isProfit ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300'}`}>
                        {isProfit ? 'PROFIT' : 'LOSS'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
                      <span>Sold: <span className="text-slate-300">₿{sell.unitsSold?.toFixed(6) ?? '-'}</span></span>
                      <span>Price: <span className="text-slate-300">{fmtUsd(sell.sellPriceUsd)}</span>{phpPerUsd && sell.sellPriceUsd ? <span className="text-slate-500"> ({fmtPhp(sell.sellPriceUsd * phpPerUsd)})</span> : null}</span>
                      <span>Rate: <span className="text-slate-300">₱{sell.phpPerUsd?.toFixed(2) ?? '-'}/USD</span></span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold text-sm ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                      {isProfit ? '+' : ''}{fmtPhp(pnl)}
                    </p>
                    <p className="text-slate-500 text-xs">{fmtPhp(sell.proceedsPhp)}</p>
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

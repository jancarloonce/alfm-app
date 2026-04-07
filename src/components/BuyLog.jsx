import React, { useState } from 'react'

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

function fmt(n, decimals = 4) {
  if (n === null || n === undefined) return '-'
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

const SIGNAL_COLORS = {
  NO_BUY: 'text-slate-400',
  WATCH: 'text-yellow-400',
  BUY: 'text-blue-400',
  BUY_MORE: 'text-green-400',
  AGGRESSIVE: 'text-emerald-400',
  PRIORITY_BUY: 'text-emerald-300',
}

export default function BuyLog({ buys }) {
  const [page, setPage] = useState(1)
  const pageSize = 10
  const totalPages = Math.ceil(buys.length / pageSize)
  const paged = buys.slice((page - 1) * pageSize, page * pageSize)

  if (buys.length === 0) {
    return (
      <div className="card">
        <p className="label mb-3">Buy Log</p>
        <p className="text-slate-500 text-sm">No buys recorded yet. Use the "I Bought" button to record your first purchase.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="label">Buy Log</p>
          <p className="text-slate-500 text-xs mt-0.5">{buys.length} total purchase{buys.length !== 1 ? 's' : ''}</p>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 transition-colors"
            >
              ← Prev
            </button>
            <span className="text-slate-400 text-xs">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 disabled:opacity-40 hover:bg-slate-600 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-slate-700">
              <th className="pb-2 pr-4 text-slate-400 font-medium text-xs">Date</th>
              <th className="pb-2 pr-4 text-slate-400 font-medium text-xs">Amount</th>
              <th className="pb-2 pr-4 text-slate-400 font-medium text-xs">NAVPU</th>
              <th className="pb-2 pr-4 text-slate-400 font-medium text-xs">Units</th>
              <th className="pb-2 pr-4 text-slate-400 font-medium text-xs">New Avg Price</th>
              <th className="pb-2 text-slate-400 font-medium text-xs">Month</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {paged.map((buy) => (
              <tr key={buy.id} className="hover:bg-slate-700/30 transition-colors">
                <td className="py-2.5 pr-4 text-slate-300 font-medium">{buy.date}</td>
                <td className="py-2.5 pr-4 text-white font-bold">
                  {fmtPeso(buy.amount, 0)}
                </td>
                <td className="py-2.5 pr-4 text-slate-300">₱{Number(buy.navpu).toFixed(2)}</td>
                <td className="py-2.5 pr-4 text-slate-300">{fmt(buy.unitsBought, 4)}</td>
                <td className="py-2.5 pr-4 text-slate-300">₱{Number(buy.newAvgPrice).toFixed(4)}</td>
                <td className="py-2.5 text-slate-500 text-xs">{buy.monthYear}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

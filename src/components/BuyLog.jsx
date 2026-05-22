import React, { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'

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

function EditNavpuCell({ buy, onDone }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(buy.navpu))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const save = async () => {
    const parsed = parseFloat(value)
    if (!parsed || parsed <= 0) { setErr('Invalid'); return }
    if (parsed === buy.navpu) { setEditing(false); return }
    setSaving(true)
    setErr(null)
    try {
      const fn = httpsCallable(functions, 'correctBuyNavpu')
      await fn({ buyId: buy.id, newNavpu: parsed })
      setEditing(false)
      onDone?.()
    } catch (e) {
      setErr(e.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <span
        className="group flex items-center gap-1 cursor-pointer"
        onClick={() => setEditing(true)}
        title="Click to correct NAVPU"
      >
        ₱{Number(buy.navpu).toFixed(2)}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
        </svg>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        className="w-20 bg-slate-900 border border-emerald-500 rounded px-1.5 py-0.5 text-white text-sm focus:outline-none"
      />
      <button
        onClick={save}
        disabled={saving}
        className="text-xs px-1.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
      >
        {saving ? '…' : 'Save'}
      </button>
      <button
        onClick={() => setEditing(false)}
        className="text-xs px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
      >
        ✕
      </button>
      {err && <span className="text-red-400 text-xs">{err}</span>}
    </span>
  )
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
                <td className="py-2.5 pr-4 text-slate-300">
                  <EditNavpuCell buy={buy} />
                </td>
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

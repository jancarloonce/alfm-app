import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'

// Upcoming record dates: div/unit is estimated until confirmed
const FUTURE_RECORDS = [
  { date: '2026-03-27', divPerUnit: 0.24 },
  { date: '2026-04-28', divPerUnit: 0.24 },
  { date: '2026-05-28', divPerUnit: 0.24 },
  { date: '2026-06-26', divPerUnit: 0.24 },
]

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatDateShort(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })
}

function fmtPeso(n) {
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getUnitsAtDate(buys, dateStr) {
  const sorted = [...buys]
    .filter((b) => b.date <= dateStr && b.totalUnitsAfter != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  return sorted.length > 0 ? sorted[sorted.length - 1].totalUnitsAfter : null
}

export default function DividendCard({ todayStr, buys = [] }) {
  const [dividends, setDividends] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(collection(db, 'dividends'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setDividends(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
    return () => unsub()
  }, [])

  const pastDividends = dividends.filter((r) => r.date < todayStr)
  const futureRecords = FUTURE_RECORDS.filter((r) => r.date >= todayStr)
  const nextRecord = futureRecords[0] || FUTURE_RECORDS[FUTURE_RECORDS.length - 1]
  const lastPast = pastDividends[pastDividends.length - 1]

  const daysToRecord = daysBetween(todayStr, nextRecord.date)
  const daysSinceRecord = lastPast ? daysBetween(lastPast.date, todayStr) : null

  const isPostRecord = daysSinceRecord !== null && daysSinceRecord >= 1 && daysSinceRecord <= 3
  const isPreRecord = daysToRecord >= 0 && daysToRecord <= 7

  const totalEarned = pastDividends.reduce((sum, r) => sum + (r.earned || r.units * r.divPerUnit), 0)
  const avgDivPerUnit = pastDividends.length > 0
    ? pastDividends.reduce((sum, r) => sum + r.divPerUnit, 0) / pastDividends.length
    : 0

  const currentUnits = getUnitsAtDate(buys, todayStr) || (lastPast?.units ?? 0)
  const estNextDiv = currentUnits * nextRecord.divPerUnit
  const nextPayoutDate = addDays(nextRecord.date, 15)

  if (loading) {
    return (
      <div className="card h-full">
        <p className="label mb-2">Dividend Cycle</p>
        <p className="text-slate-500 text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <div className="card h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="label">Dividend Cycle</p>
        {isPostRecord && (
          <span className="text-xs font-bold px-2 py-0.5 rounded bg-green-900/50 text-green-400 border border-green-700">
            POST-RECORD
          </span>
        )}
        {isPreRecord && !isPostRecord && (
          <span className="text-xs font-bold px-2 py-0.5 rounded bg-yellow-900/50 text-yellow-400 border border-yellow-700">
            PRE-RECORD
          </span>
        )}
      </div>

      {isPostRecord && (
        <div className="bg-green-900/30 border border-green-700/50 rounded-lg px-3 py-2 -mt-2">
          <p className="text-green-300 text-xs">Day {daysSinceRecord} after record date. Dip buys may apply.</p>
        </div>
      )}
      {isPreRecord && !isPostRecord && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-3 py-2 -mt-2">
          <p className="text-yellow-300 text-xs">
            {daysToRecord} day{daysToRecord !== 1 ? 's' : ''} to record. Avoid buying near peak.
          </p>
        </div>
      )}

      {/* Hero metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-900/20 border border-emerald-800/50 rounded-lg px-3 py-3 text-center">
          <p className="text-slate-400 text-xs mb-1">Total Dividends Earned</p>
          <p className="text-emerald-400 font-black text-xl">{fmtPeso(totalEarned)}</p>
          <p className="text-slate-500 text-xs mt-0.5">{pastDividends.length} months</p>
        </div>
        <div className="bg-slate-700/40 rounded-lg px-3 py-3 text-center">
          <p className="text-slate-400 text-xs mb-1">Est. Next Payout</p>
          <p className="text-white font-black text-xl">{fmtPeso(estNextDiv)}</p>
          <p className="text-slate-500 text-xs mt-0.5">
            {currentUnits.toLocaleString('en-PH', { maximumFractionDigits: 0 })} units x ₱{nextRecord.divPerUnit}
          </p>
        </div>
      </div>

      {/* Next record + payout */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-700/30 rounded-lg px-3 py-2">
          <p className="text-slate-500 text-xs mb-1">Next Record</p>
          <p className="text-white text-sm font-semibold">{formatDate(nextRecord.date)}</p>
          <p className="text-slate-400 text-xs mt-0.5">
            {daysToRecord > 0 ? `${daysToRecord}d away` : daysToRecord === 0 ? 'Today' : `${Math.abs(daysToRecord)}d ago`}
          </p>
        </div>
        <div className="bg-slate-700/30 rounded-lg px-3 py-2">
          <p className="text-slate-500 text-xs mb-1">Est. Payout</p>
          <p className="text-white text-sm font-semibold">{formatDate(nextPayoutDate)}</p>
          <p className="text-slate-400 text-xs mt-0.5">~15d after record</p>
        </div>
      </div>

      {/* History toggle */}
      {pastDividends.length > 0 && (
        <>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="w-full text-center text-slate-500 hover:text-slate-300 text-xs py-2 border border-slate-700 rounded transition-colors"
          >
            {showHistory ? 'Hide' : 'Show'} dividend history ({pastDividends.length} months)
          </button>

          {showHistory && (
            <div className="space-y-1">
              <div className="grid grid-cols-4 text-slate-600 text-xs px-2 pb-1">
                <span>Month</span>
                <span className="text-right">Units</span>
                <span className="text-right">₱/unit</span>
                <span className="text-right">Earned</span>
              </div>
              {[...pastDividends].reverse().map((r) => {
                const earned = r.earned ?? r.units * r.divPerUnit
                return (
                  <div key={r.date} className="grid grid-cols-4 items-center bg-slate-700/20 rounded px-2 py-1.5 text-xs">
                    <span className="text-slate-300 font-medium">{r.month}</span>
                    <span className="text-slate-400 text-right">
                      {r.units.toLocaleString('en-PH', { maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-slate-400 text-right">₱{r.divPerUnit}</span>
                    <span className="text-emerald-400 font-semibold text-right">{fmtPeso(earned)}</span>
                  </div>
                )
              })}
              <div className="grid grid-cols-4 border-t border-slate-700 pt-2 px-2 text-xs">
                <span className="text-slate-400 font-medium col-span-3">Total</span>
                <span className="text-emerald-400 font-black text-right">{fmtPeso(totalEarned)}</span>
              </div>
              <div className="grid grid-cols-4 px-2 text-xs">
                <span className="text-slate-600 col-span-3">Avg ₱/unit</span>
                <span className="text-slate-500 text-right">₱{avgDivPerUnit.toFixed(4)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Upcoming dates */}
      <div>
        <p className="text-slate-500 text-xs font-medium mb-2">Upcoming Record Dates</p>
        <div className="space-y-1.5">
          {futureRecords.slice(0, 3).map((r, idx) => (
            <div key={r.date} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${idx === 0 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span className="text-slate-300 text-xs">{formatDate(r.date)}</span>
              </div>
              <span className="text-slate-500 text-xs">{daysBetween(todayStr, r.date)}d</span>
            </div>
          ))}
        </div>
      </div>

      {/* Last record footer */}
      {lastPast && (
        <div className="border-t border-slate-700/60 pt-3 flex justify-between items-center">
          <p className="text-slate-600 text-xs">Last record</p>
          <p className="text-slate-500 text-xs">{formatDateShort(lastPast.date)} · {daysSinceRecord}d ago</p>
        </div>
      )}
    </div>
  )
}

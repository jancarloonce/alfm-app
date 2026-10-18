import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, orderBy, query, doc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

/**
 * Returns the last Monday–Friday day of the given month (0-indexed).
 * Weekend-only check; PH holidays not tracked in frontend.
 */
function lastBizDayOfMonth(year, month) {
  let day = new Date(year, month + 1, 0).getDate()
  while (true) {
    const dow = new Date(year, month, day).getDay()
    if (dow !== 0 && dow !== 6) break
    day--
  }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Compute the next `count` ALFM record dates algorithmically (last biz day of month).
 * Dates are marked estimated=true until confirmed from Firestore (BPI scrape).
 */
function computeUpcomingRecordDates(todayStr, count = 4) {
  const results = []
  const now = new Date(todayStr + 'T00:00:00')
  let year = now.getFullYear()
  let month = now.getMonth()
  while (results.length < count) {
    const date = lastBizDayOfMonth(year, month)
    if (date >= todayStr) results.push({ date, divPerUnit: null, estimated: true })
    month++
    if (month > 11) { month = 0; year++ }
    if (year > now.getFullYear() + 3) break
  }
  return results
}

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
  const [showLogForm, setShowLogForm] = useState(false)
  const [logUnitDividend, setLogUnitDividend] = useState('')
  const [logNavpu, setLogNavpu] = useState('')
  const [logUnits, setLogUnits] = useState('')
  const [logRecordDate, setLogRecordDate] = useState('')
  const [logCredited, setLogCredited] = useState('')
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState(null)
  const [logSuccess, setLogSuccess] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'dividends'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setDividends(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
    return () => unsub()
  }, [])

  const pastDividends = dividends
    .map((r) => ({ ...r, date: r.date || r.id }))
    .filter((r) => r.date < todayStr && (r.divPerUnit || r.earned))
  const lastPast = pastDividends[pastDividends.length - 1]

  // Compute upcoming record dates algorithmically; overlay confirmed Firestore data where available
  const confirmedFuture = dividends
    .map((r) => ({ ...r, date: r.date || r.id }))
    .filter((r) => r.date >= todayStr)
  const avgDivPerUnitFallback = pastDividends.length > 0
    ? pastDividends.reduce((s, r) => s + (r.divPerUnit || 0), 0) / pastDividends.length
    : null
  const futureRecords = computeUpcomingRecordDates(todayStr, 4).map((algo) => {
    const confirmed = confirmedFuture.find((c) => c.date.slice(0, 7) === algo.date.slice(0, 7))
    if (confirmed) return { ...confirmed, estimated: false }
    return { ...algo, divPerUnit: avgDivPerUnitFallback }
  })
  const nextRecord = futureRecords[0] || { date: todayStr, divPerUnit: avgDivPerUnitFallback, estimated: true }

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

  const lastKnownRecord = lastPast ?? futureRecords.filter((r) => r.date < todayStr).slice(-1)[0] ?? null

  function openLogForm() {
    const defaultRecord = lastKnownRecord?.date ?? ''
    const defaultUnits = getUnitsAtDate(buys, defaultRecord || todayStr) || currentUnits
    setLogRecordDate(defaultRecord)
    setLogUnits(defaultUnits > 0 ? String(defaultUnits) : '')
    setLogCredited(defaultRecord ? addDays(defaultRecord, 21) : '')
    setLogUnitDividend('')
    setLogNavpu('')
    setLogError(null)
    setLogSuccess(false)
    setShowLogForm(true)
  }

  async function handleLogDividend() {
    const unitDividend = parseFloat(logUnitDividend)
    const navpu = parseFloat(logNavpu)
    const units = parseFloat(logUnits)
    if (!logRecordDate) { setLogError('Record date is required.'); return }
    if (!unitDividend || unitDividend <= 0) { setLogError('Enter the Unit Dividend from the BPI email.'); return }
    if (!navpu || navpu <= 0) { setLogError('Enter the NAVPU as of Record Date from the BPI email.'); return }
    if (!units || units <= 0) { setLogError('Enter the units held at the record date.'); return }
    const divPerUnit = parseFloat((unitDividend * navpu).toFixed(4))
    const earned = parseFloat((units * divPerUnit).toFixed(4))
    const rd = new Date(logRecordDate + 'T00:00:00')
    rd.setMonth(rd.getMonth() + 1)
    const month = rd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    const payload = {
      date: logRecordDate,
      month,
      units,
      unitIncome: unitDividend,
      navpuAtRecord: navpu,
      divPerUnit,
      earned,
      credited: logCredited || addDays(logRecordDate, 21),
      autoDetected: false,
      estimated: false,
      confirmed: true,
    }
    setLogSaving(true)
    setLogError(null)
    try {
      await setDoc(doc(db, 'dividends', logRecordDate), payload)
      setLogSuccess(true)
      setTimeout(() => {
        setShowLogForm(false)
        setLogSuccess(false)
      }, 1500)
    } catch (err) {
      setLogError(err.message || 'Failed to save.')
    } finally {
      setLogSaving(false)
    }
  }

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
        <div className="flex items-center gap-2">
          <button
            onClick={openLogForm}
            className="text-xs px-2 py-0.5 rounded border border-neutral-800 text-slate-400 hover:text-slate-200 hover:border-neutral-700 transition-colors"
          >
            + Log
          </button>
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
      </div>

      {/* Log Dividend inline form */}
      {showLogForm && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
          <p className="text-slate-300 text-sm font-semibold">Log Received Dividend</p>

          {logSuccess && (
            <div className="bg-emerald-900/50 border border-emerald-700 rounded-lg px-3 py-2 text-emerald-300 text-sm text-center font-semibold">
              Saved!
            </div>
          )}
          {logError && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-xs">
              {logError}
            </div>
          )}

          {!logSuccess && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Record Date</label>
                  <input
                    type="date"
                    value={logRecordDate}
                    onChange={(e) => {
                      setLogRecordDate(e.target.value)
                      if (e.target.value) setLogCredited(addDays(e.target.value, 21))
                    }}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Credited Date</label>
                  <input
                    type="date"
                    value={logCredited}
                    onChange={(e) => setLogCredited(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Unit Dividend (from email)</label>
                  <input
                    type="number"
                    value={logUnitDividend}
                    onChange={(e) => setLogUnitDividend(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500"
                    placeholder="0.0051"
                    step="0.0001"
                  />
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">NAVPU at Record Date</label>
                  <input
                    type="number"
                    value={logNavpu}
                    onChange={(e) => setLogNavpu(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500"
                    placeholder="48.0460"
                    step="0.0001"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-500 text-xs block mb-1">Units at Record Date</label>
                <input
                  type="number"
                  value={logUnits}
                  onChange={(e) => setLogUnits(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500"
                  placeholder="4684.506"
                  step="0.001"
                />
              </div>

              {parseFloat(logUnitDividend) > 0 && parseFloat(logNavpu) > 0 && parseFloat(logUnits) > 0 && (
                <div className="bg-neutral-900 rounded-lg px-3 py-2 space-y-0.5">
                  <p className="text-slate-400 text-xs">
                    ₱/unit: <span className="text-slate-200 font-semibold">₱{(parseFloat(logUnitDividend) * parseFloat(logNavpu)).toFixed(4)}</span>
                    <span className="text-slate-600 mx-1">=</span>
                    <span className="text-slate-500">{logUnitDividend} × {logNavpu}</span>
                  </p>
                  <p className="text-slate-400 text-xs">
                    Est. earned: <span className="text-emerald-400 font-semibold">₱{(parseFloat(logUnits) * parseFloat(logUnitDividend) * parseFloat(logNavpu)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowLogForm(false)}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-slate-300 text-xs font-medium py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogDividend}
                  disabled={logSaving}
                  className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                >
                  {logSaving ? 'Saving...' : 'Save Dividend'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

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
        <div className="bg-neutral-900 rounded-lg px-3 py-3 text-center">
          <p className="text-slate-400 text-xs mb-1">Est. Next Payout</p>
          <p className="text-white font-black text-xl">{fmtPeso(estNextDiv)}</p>
          <p className="text-slate-500 text-xs mt-0.5">
            {currentUnits.toLocaleString('en-PH', { maximumFractionDigits: 0 })} units x ₱{nextRecord.divPerUnit}
          </p>
        </div>
      </div>

      {/* Next record + payout */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-neutral-900 rounded-lg px-3 py-2">
          <p className="text-slate-500 text-xs mb-1">Next Record</p>
          <p className="text-white text-sm font-semibold">{formatDate(nextRecord.date)}</p>
          <p className="text-slate-400 text-xs mt-0.5">
            {daysToRecord > 0 ? `${daysToRecord}d away` : daysToRecord === 0 ? 'Today' : `${Math.abs(daysToRecord)}d ago`}
          </p>
        </div>
        <div className="bg-neutral-900 rounded-lg px-3 py-2">
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
            className="w-full text-center text-slate-500 hover:text-slate-300 text-xs py-2 border border-neutral-800 rounded transition-colors"
          >
            {showHistory ? 'Hide' : 'Show'} dividend history ({pastDividends.length} months)
          </button>

          {showHistory && (
            <div className="space-y-1">
              <div className="grid grid-cols-5 text-slate-600 text-xs px-2 pb-1">
                <span>Month</span>
                <span className="text-right">Payout Date</span>
                <span className="text-right">Units</span>
                <span className="text-right">₱/unit</span>
                <span className="text-right">Earned</span>
              </div>
              {[...pastDividends].reverse().map((r) => {
                const earned = r.earned ?? r.units * r.divPerUnit
                return (
                  <div key={r.date} className={`grid grid-cols-5 items-center rounded px-2 py-1.5 text-xs ${r.estimated ? 'bg-amber-900/20 border border-amber-800/30' : 'bg-neutral-900'}`}>
                    <span className="text-slate-300 font-medium flex items-center gap-1">
                      {r.month}
                      {r.estimated && (
                        <span className="text-amber-400 text-xs font-bold" title="Estimated - market masked the ex-dividend drop. Will auto-update when confirmed.">est.</span>
                      )}
                    </span>
                    <span className="text-slate-400 text-right">{r.paymentDate ? formatDateShort(r.paymentDate) : '—'}</span>
                    <span className="text-slate-400 text-right">
                      {(r.units ?? 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}
                    </span>
                    <span className={`text-right ${r.estimated ? 'text-amber-400' : 'text-slate-400'}`}>₱{r.divPerUnit ?? '—'}</span>
                    <span className={`font-semibold text-right ${r.estimated ? 'text-amber-400' : 'text-emerald-400'}`}>{fmtPeso(earned)}</span>
                  </div>
                )
              })}
              <div className="grid grid-cols-5 border-t border-neutral-800 pt-2 px-2 text-xs">
                <span className="text-slate-400 font-medium col-span-4">Total</span>
                <span className="text-emerald-400 font-black text-right">{fmtPeso(totalEarned)}</span>
              </div>
              <div className="grid grid-cols-5 px-2 text-xs">
                <span className="text-slate-600 col-span-4">Avg ₱/unit</span>
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
                {r.estimated && <span className="text-amber-400 text-xs">est.</span>}
              </div>
              <span className="text-slate-500 text-xs">{daysBetween(todayStr, r.date)}d</span>
            </div>
          ))}
        </div>
      </div>

      {/* Last record footer */}
      {lastPast && (
        <div className="border-t border-neutral-800/60 pt-3 flex justify-between items-center">
          <p className="text-slate-600 text-xs">Last record</p>
          <p className="text-slate-500 text-xs">{formatDateShort(lastPast.date)} · {daysSinceRecord}d ago</p>
        </div>
      )}
    </div>
  )
}

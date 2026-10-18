import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, orderBy, query, doc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'

/**
 * Returns the 7th Monday–Friday day of the given month (0-indexed).
 * Weekend-only check; PH holidays shift by 1 day in edge cases (shown as est.)
 */
function nth7thBizDay(year, month) {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month, day)
    if (d.getMonth() !== month) break
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) {
      count++
      if (count === 7) {
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      }
    }
  }
  return null
}

function mostRecentDistDate(todayStr) {
  const now = new Date(todayStr + 'T00:00:00')
  let year = now.getFullYear()
  let month = now.getMonth()
  const thisMonth = nth7thBizDay(year, month)
  if (thisMonth && thisMonth <= todayStr) return thisMonth
  month--
  if (month < 0) { month = 11; year-- }
  return nth7thBizDay(year, month)
}

function computeUpcomingDistributionDates(todayStr, count = 4) {
  const results = []
  const now = new Date(todayStr + 'T00:00:00')
  let year = now.getFullYear()
  let month = now.getMonth()
  while (results.length < count) {
    const date = nth7thBizDay(year, month)
    if (date && date >= todayStr) results.push({ date, unitIncome: null, estimated: true })
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

export default function MgpiffDividendCard({ todayStr, buys = [], currentNavpu = null }) {
  const [distributions, setDistributions] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showLogForm, setShowLogForm] = useState(false)
  const [logEarned, setLogEarned] = useState('')
  const [logUnits, setLogUnits] = useState('')
  const [logDate, setLogDate] = useState('')
  const [logPaymentDate, setLogPaymentDate] = useState('')
  const [logUnitIncome, setLogUnitIncome] = useState('')
  const [logNavpu, setLogNavpu] = useState('')
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState(null)
  const [logSuccess, setLogSuccess] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'mgpiff_dividends'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setDistributions(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
    return () => unsub()
  }, [])

  const pastDistributions = distributions
    .map((r) => ({ ...r, date: r.date || r.id }))
    .filter((r) => r.date <= todayStr && r.confirmed)

  const allDates = distributions.map((r) => r.date || r.id)

  // Compute upcoming dates; overlay confirmed Firestore entries where available
  const confirmedFuture = distributions
    .map((r) => ({ ...r, date: r.date || r.id }))
    .filter((r) => r.date >= todayStr)

  const upcomingDates = computeUpcomingDistributionDates(todayStr, 4).map((algo) => {
    const confirmed = confirmedFuture.find((c) => c.date.slice(0, 7) === algo.date.slice(0, 7))
    return confirmed ? { ...confirmed, estimated: false } : algo
  })

  const nextDist = upcomingDates[0]
  const lastPast = pastDistributions[pastDistributions.length - 1]

  const daysToNext = nextDist ? daysBetween(todayStr, nextDist.date) : null
  const daysSinceLast = lastPast ? daysBetween(lastPast.date, todayStr) : null

  const isPostDist = daysSinceLast !== null && daysSinceLast >= 1 && daysSinceLast <= 3
  const isPreDist = daysToNext !== null && daysToNext >= 0 && daysToNext <= 7

  const totalEarned = pastDistributions.reduce((sum, r) => sum + (r.earned || 0), 0)

  // Estimate next payout: units × unitIncome × current NAVPU
  function getUnitsAtDate(dateStr) {
    const sorted = [...buys]
      .filter((b) => b.date <= dateStr && b.totalUnitsAfter != null)
      .sort((a, b) => a.date.localeCompare(b.date))
    return sorted.length > 0 ? sorted[sorted.length - 1].totalUnitsAfter : null
  }

  const currentUnits = getUnitsAtDate(todayStr) || 0
  const nextUnitIncome = nextDist?.unitIncome ?? lastPast?.unitIncome ?? null
  const estNextPayout = nextUnitIncome && currentNavpu && currentUnits > 0
    ? currentUnits * nextUnitIncome * currentNavpu
    : null
  const nextPaymentDate = nextDist ? addDays(nextDist.date, 8) : null

  function openLogForm() {
    const defaultDate = mostRecentDistDate(todayStr)
    setLogDate(defaultDate ?? '')
    setLogPaymentDate(defaultDate ? addDays(defaultDate, 8) : '')
    setLogUnits(currentUnits > 0 ? String(currentUnits) : '')
    setLogEarned('')
    setLogUnitIncome(lastPast?.unitIncome ? String(lastPast.unitIncome) : '')
    setLogNavpu('')
    setLogError(null)
    setLogSuccess(false)
    setShowLogForm(true)
  }

  async function handleLogDistribution() {
    const earned = parseFloat(logEarned)
    const units = parseFloat(logUnits)
    if (!logDate) { setLogError('Distribution date is required.'); return }
    if (!earned || earned <= 0) { setLogError('Enter the amount (₱) received.'); return }
    if (!units || units <= 0) { setLogError('Enter your units held at the distribution date.'); return }

    const formUnitIncome = logUnitIncome ? parseFloat(logUnitIncome) : null
    const formNavpu = logNavpu ? parseFloat(logNavpu) : null

    const historical = distributions.find((d) => (d.date || d.id) === logDate)
    const unitIncome = formUnitIncome ?? historical?.unitIncome ?? null
    const navpuAtDist = formNavpu ?? (unitIncome && units > 0 ? parseFloat((earned / (units * unitIncome)).toFixed(4)) : null)

    const rd = new Date(logDate + 'T00:00:00')
    rd.setMonth(rd.getMonth() + 1)
    const month = rd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

    const payload = {
      date: logDate,
      paymentDate: logPaymentDate || addDays(logDate, 8),
      month,
      units: parseFloat(units.toFixed(4)),
      unitIncome,
      navpuAtDistribution: navpuAtDist,
      earned: parseFloat(earned.toFixed(4)),
      confirmed: true,
      autoDetected: false,
      loggedAt: new Date().toISOString(),
    }

    setLogSaving(true)
    setLogError(null)
    try {
      await setDoc(doc(db, 'mgpiff_dividends', logDate), payload, { merge: true })
      setLogSuccess(true)
      setTimeout(() => { setShowLogForm(false); setLogSuccess(false) }, 1500)
    } catch (err) {
      setLogError(err.message || 'Failed to save.')
    } finally {
      setLogSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="card h-full">
        <p className="label mb-2">Distribution Cycle</p>
        <p className="text-slate-500 text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <div className="card h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="label">Distribution Cycle</p>
        <div className="flex items-center gap-2">
          <button
            onClick={openLogForm}
            className="text-xs px-2 py-0.5 rounded border border-neutral-800 text-slate-400 hover:text-slate-200 hover:border-neutral-700 transition-colors"
          >
            + Log
          </button>
          {isPostDist && (
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-900/50 text-blue-400 border border-blue-700">
              POST-DIST
            </span>
          )}
          {isPreDist && !isPostDist && (
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-yellow-900/50 text-yellow-400 border border-yellow-700">
              PRE-DIST
            </span>
          )}
        </div>
      </div>

      {/* Log form */}
      {showLogForm && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
          <p className="text-slate-300 text-sm font-semibold">Log GCash Payout</p>
          {logSuccess && (
            <div className="bg-emerald-900/50 border border-emerald-700 rounded-lg px-3 py-2 text-emerald-300 text-sm text-center font-semibold">Saved!</div>
          )}
          {logError && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-xs">{logError}</div>
          )}
          {!logSuccess && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Distribution Date</label>
                  <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">GCash Credit Date</label>
                  <input type="date" value={logPaymentDate} onChange={(e) => setLogPaymentDate(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Payout Received (₱)</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₱</span>
                    <input type="number" value={logEarned} onChange={(e) => setLogEarned(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-5 pr-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
                      placeholder="0.00" step="0.01" />
                  </div>
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Units Held at Dist.</label>
                  <input type="number" value={logUnits} onChange={(e) => setLogUnits(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
                    placeholder="0.00" step="0.0001" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Unit Income (per unit held)</label>
                  <input type="number" value={logUnitIncome} onChange={(e) => setLogUnitIncome(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
                    placeholder="e.g. 0.0045" step="0.0001" />
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">NAVPU at Distribution</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₱</span>
                    <input type="number" value={logNavpu} onChange={(e) => setLogNavpu(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-5 pr-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
                      placeholder="e.g. 54.3873" step="0.0001" />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowLogForm(false)}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-slate-300 text-xs font-medium py-2 rounded-lg transition-colors">
                  Cancel
                </button>
                <button onClick={handleLogDistribution} disabled={logSaving}
                  className="flex-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-lg transition-colors">
                  {logSaving ? 'Saving...' : 'Save Payout'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {isPostDist && (
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg px-3 py-2 -mt-2">
          <p className="text-blue-300 text-xs">Day {daysSinceLast} after distribution. NAVPU dip buys may apply.</p>
        </div>
      )}
      {isPreDist && !isPostDist && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-3 py-2 -mt-2">
          <p className="text-yellow-300 text-xs">
            {daysToNext} day{daysToNext !== 1 ? 's' : ''} to distribution. Avoid buying near peak.
          </p>
        </div>
      )}

      {/* Hero metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg px-3 py-3 text-center">
          <p className="text-slate-400 text-xs mb-1">Total Payouts Received</p>
          <p className="text-blue-400 font-black text-xl">{totalEarned > 0 ? fmtPeso(totalEarned) : '—'}</p>
          <p className="text-slate-500 text-xs mt-0.5">{pastDistributions.length} months logged</p>
        </div>
        <div className="bg-neutral-900 rounded-lg px-3 py-3 text-center">
          <p className="text-slate-400 text-xs mb-1">Est. Next Payout</p>
          <p className="text-white font-black text-xl">{estNextPayout ? fmtPeso(estNextPayout) : '—'}</p>
          <p className="text-slate-500 text-xs mt-0.5">
            {nextUnitIncome ? `${currentUnits > 0 ? currentUnits.toLocaleString('en-PH', { maximumFractionDigits: 0 }) + ' units × ' : ''}${nextUnitIncome} × NAVPU` : 'Log position to estimate'}
          </p>
        </div>
      </div>

      {/* Next distribution + payment */}
      {nextDist && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-neutral-900 rounded-lg px-3 py-2">
            <p className="text-slate-500 text-xs mb-1">Next Distribution {nextDist.estimated && <span className="text-amber-400 text-xs">est.</span>}</p>
            <p className="text-white text-sm font-semibold">{formatDate(nextDist.date)}</p>
            <p className="text-slate-400 text-xs mt-0.5">
              {daysToNext > 0 ? `${daysToNext}d away` : daysToNext === 0 ? 'Today' : `${Math.abs(daysToNext)}d ago`}
            </p>
          </div>
          <div className="bg-neutral-900 rounded-lg px-3 py-2">
            <p className="text-slate-500 text-xs mb-1">Est. GCash Credit</p>
            <p className="text-white text-sm font-semibold">{nextPaymentDate ? formatDate(nextPaymentDate) : '—'}</p>
            <p className="text-slate-400 text-xs mt-0.5">~8 days after dist.</p>
          </div>
        </div>
      )}

      {/* History */}
      {pastDistributions.length > 0 && (
        <>
          <button onClick={() => setShowHistory((v) => !v)}
            className="w-full text-center text-slate-500 hover:text-slate-300 text-xs py-2 border border-neutral-800 rounded transition-colors">
            {showHistory ? 'Hide' : 'Show'} distribution history ({pastDistributions.length} logged)
          </button>
          {showHistory && (
            <div className="space-y-1">
              <div className="grid grid-cols-5 text-slate-600 text-xs px-2 pb-1">
                <span>Month</span>
                <span className="text-right">Payout Date</span>
                <span className="text-right">Units</span>
                <span className="text-right">Income/unit</span>
                <span className="text-right">Received</span>
              </div>
              {[...pastDistributions].reverse().map((r) => (
                <div key={r.date} className="grid grid-cols-5 items-center rounded px-2 py-1.5 text-xs bg-neutral-900">
                  <span className="text-slate-300 font-medium">{r.month}</span>
                  <span className="text-slate-400 text-right">{r.paymentDate ? formatDateShort(r.paymentDate) : '—'}</span>
                  <span className="text-slate-400 text-right">{r.units?.toLocaleString('en-PH', { maximumFractionDigits: 2 }) ?? '—'}</span>
                  <span className="text-slate-400 text-right">{r.unitIncome ?? '—'}</span>
                  <span className="text-blue-400 font-semibold text-right">{r.earned ? fmtPeso(r.earned) : '—'}</span>
                </div>
              ))}
              <div className="grid grid-cols-5 border-t border-neutral-800 pt-2 px-2 text-xs">
                <span className="text-slate-400 font-medium col-span-4">Total</span>
                <span className="text-blue-400 font-black text-right">{totalEarned > 0 ? fmtPeso(totalEarned) : '—'}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Upcoming dates */}
      <div>
        <p className="text-slate-500 text-xs font-medium mb-2">Upcoming Distribution Dates</p>
        <div className="space-y-1.5">
          {upcomingDates.slice(0, 3).map((r, idx) => (
            <div key={r.date} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${idx === 0 ? 'bg-blue-400' : 'bg-slate-600'}`} />
                <span className="text-slate-300 text-xs">{formatDate(r.date)}</span>
                {r.estimated && <span className="text-amber-400 text-xs">est.</span>}
              </div>
              <span className="text-slate-500 text-xs">{daysBetween(todayStr, r.date)}d</span>
            </div>
          ))}
        </div>
      </div>

      {lastPast && (
        <div className="border-t border-neutral-800/60 pt-3 flex justify-between items-center">
          <p className="text-slate-600 text-xs">Last distribution</p>
          <p className="text-slate-500 text-xs">{formatDateShort(lastPast.date)} · {daysSinceLast}d ago</p>
        </div>
      )}
    </div>
  )
}

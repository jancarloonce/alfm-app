import React, { useState, useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'

function fmtPeso(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return (
    '₱' +
    Number(n).toLocaleString('en-PH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}

function fmt(n, decimals = 4) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

const SIGNAL_LABEL = {
  NO_BUY: 'No Buy',
  WATCH: 'Watch',
  WATCH_SKIP: 'Watch / Skip',
  BUY: 'Buy',
  BUY_MORE: 'Buy More',
  AGGRESSIVE: 'Aggressive',
  PRIORITY_BUY: 'Priority Buy',
  NO_SECOND_BUY: 'No Second Buy',
  MONTHLY_CAP: 'Monthly Cap',
  OPP_LOCKED: 'Opp Locked',
  OPP_GAP_WAIT: 'Opp Gap Wait',
}

const SIGNAL_COLOR = {
  NO_BUY: 'text-slate-400',
  WATCH: 'text-yellow-400',
  WATCH_SKIP: 'text-yellow-500',
  BUY: 'text-blue-400',
  BUY_MORE: 'text-green-400',
  AGGRESSIVE: 'text-emerald-400',
  PRIORITY_BUY: 'text-emerald-300',
  NO_SECOND_BUY: 'text-orange-400',
  MONTHLY_CAP: 'text-red-400',
}

export default function MreitBuyModal({
  onClose,
  todaySignal,
  todayNavpu,
  position,
  todayStr,
  currentMonthStr,
}) {
  const recommendedAmount = todaySignal?.amount ?? 2500
  const defaultNavpu = todayNavpu ?? position?.avgPrice ?? 1.0

  const [date, setDate] = useState(todayStr || new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState(String(recommendedAmount))
  const [navpu, setNavpu] = useState(String(defaultNavpu))
  const [overrideUnits, setOverrideUnits] = useState(false)
  const [manualUnits, setManualUnits] = useState('')
  const [isPending, setIsPending] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const parsedAmount = parseFloat(amount) || 0
  const parsedNavpu = parseFloat(navpu) || 0

  const currentUnits = position?.units ?? 0
  const currentCost = position?.totalCost ?? 0

  const calcUnitsBought = overrideUnits
    ? parseFloat(manualUnits) || 0
    : parsedNavpu > 0
    ? parsedAmount / parsedNavpu
    : 0

  const newTotalUnits = currentUnits + calcUnitsBought
  const newTotalCost = currentCost + parsedAmount
  const newAvgPrice = newTotalUnits > 0 ? newTotalCost / newTotalUnits : 0
  const newMarketValue = newTotalUnits * parsedNavpu
  const newUnrealizedGain = newMarketValue - newTotalCost
  const newUnrealizedGainPct = newTotalCost > 0 ? (newUnrealizedGain / newTotalCost) * 100 : 0

  const handleSubmit = async () => {
    if (parsedAmount <= 0 || parsedNavpu <= 0) {
      setError('Amount and NAVPU must be greater than zero.')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const fns = getFunctions()
      const recordMreitBuy = httpsCallable(fns, 'recordMreitBuy')
      const payload = {
        amount: parsedAmount,
        navpu: parsedNavpu,
        isDividendBuy: todaySignal?.isDividendBuy || false,
        bucket: todaySignal?.bucket || null,
        isPending,
        date: date || null,
      }
      if (overrideUnits && parseFloat(manualUnits) > 0) {
        payload.unitsOverride = parseFloat(manualUnits)
      }
      await recordMreitBuy(payload)
      setSuccess(true)
      setTimeout(() => {
        onClose()
      }, 1800)
    } catch (err) {
      console.error('recordMreitBuy error:', err)
      setError(err.message || 'Failed to record buy. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
          <h2 className="text-lg font-bold text-white">Record a Buy — MREIT</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Today's signal context */}
          {todaySignal && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs font-medium mb-1">Today's Signal</p>
              <div className="flex items-center gap-3">
                <span
                  className={`font-bold text-base ${
                    SIGNAL_COLOR[todaySignal.signal] || 'text-slate-300'
                  }`}
                >
                  {SIGNAL_LABEL[todaySignal.signal] || todaySignal.signal}
                </span>
                {todaySignal.amount > 0 && (
                  <span className="text-white font-bold">
                    {fmtPeso(todaySignal.amount, 0)} recommended
                  </span>
                )}
              </div>
              {todaySignal.recommendation && (
                <p className="text-slate-400 text-xs mt-2">{todaySignal.recommendation}</p>
              )}
            </div>
          )}

          {/* Success state */}
          {success && (
            <div className="bg-emerald-900/60 border border-emerald-600 rounded-xl px-4 py-3 text-center">
              <p className="text-emerald-300 font-bold text-lg">Buy Recorded!</p>
              <p className="text-emerald-400 text-sm mt-1">Closing...</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {!success && (
            <>
              {/* Date input */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Buy Date
                </label>
                <input
                  type="date"
                  value={date}
                  max={todayStr || new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3 text-white font-bold focus:outline-none focus:border-amber-500 transition-colors"
                />
                {date !== (todayStr || new Date().toISOString().slice(0, 10)) && (
                  <p className="text-amber-400 text-xs mt-1">
                    Backdating to {date}
                    {' '}·{' '}
                    <button
                      onClick={() => setDate(todayStr || new Date().toISOString().slice(0, 10))}
                      className="text-amber-500 hover:text-amber-400 underline"
                    >
                      Use today
                    </button>
                  </p>
                )}
              </div>

              {/* Pending Buy toggle */}
              <div className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3">
                <div>
                  <p className="text-white text-sm font-medium">Pending Buy</p>
                  <p className="text-slate-400 text-xs mt-0.5">
                    NAVPU not yet confirmed — uses latest as estimate
                  </p>
                </div>
                <button
                  onClick={() => setIsPending((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                    isPending ? 'bg-amber-500' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      isPending ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Amount input */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Amount (₱)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-7 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder="2500"
                    min="0"
                    step="500"
                  />
                </div>
                {todaySignal?.amount > 0 && (
                  <p className="text-slate-500 text-xs mt-1">
                    Recommended: {fmtPeso(todaySignal.amount, 0)}
                    {' '}·{' '}
                    <button
                      onClick={() => setAmount(String(todaySignal.amount))}
                      className="text-amber-500 hover:text-amber-400 underline"
                    >
                      Use recommended
                    </button>
                  </p>
                )}
              </div>

              {/* NAVPU input */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  NAVPU (₱){isPending && <span className="text-amber-400 ml-1">(estimated)</span>}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                  <input
                    type="number"
                    value={navpu}
                    onChange={(e) => setNavpu(e.target.value)}
                    className={`w-full bg-neutral-950 border rounded-lg pl-7 pr-4 py-3 text-white text-lg font-bold focus:outline-none transition-colors ${
                      isPending ? 'border-amber-600 focus:border-amber-500' : 'border-neutral-800 focus:border-amber-500'
                    }`}
                    placeholder="51.0000"
                    step="0.0001"
                  />
                </div>
                {isPending ? (
                  <p className="text-amber-400 text-xs mt-1">
                    Estimated — will confirm when actual NAVPU is published
                  </p>
                ) : todayNavpu ? (
                  <p className="text-slate-500 text-xs mt-1">
                    Today's NAVPU: ₱{todayNavpu.toFixed(4)}
                    {' '}·{' '}
                    <button
                      onClick={() => setNavpu(String(todayNavpu))}
                      className="text-amber-500 hover:text-amber-400 underline"
                    >
                      Use today's
                    </button>
                  </p>
                ) : null}
              </div>

              {/* Units override */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="block text-slate-400 text-xs font-medium">
                    Units Bought
                  </label>
                  <button
                    onClick={() => setOverrideUnits((v) => !v)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      overrideUnits
                        ? 'bg-amber-900/50 border-amber-600 text-amber-300'
                        : 'bg-neutral-800/50 border-neutral-800 text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    {overrideUnits ? 'Manual' : 'Auto'}
                  </button>
                </div>
                {overrideUnits ? (
                  <input
                    type="number"
                    value={manualUnits}
                    onChange={(e) => setManualUnits(e.target.value)}
                    className="w-full bg-neutral-950 border border-amber-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder={`Calculated: ${(parsedNavpu > 0 ? parsedAmount / parsedNavpu : 0).toFixed(4)}`}
                    step="0.0001"
                  />
                ) : (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3">
                    <p className="text-white font-bold">{fmt(calcUnitsBought, 4)} units</p>
                    <p className="text-slate-500 text-xs mt-0.5">= ₱{parsedAmount} ÷ ₱{parsedNavpu}</p>
                  </div>
                )}
              </div>

              {/* Calculated summary */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
                <p className="text-slate-400 text-xs font-medium mb-3">
                  Position Preview{isPending && <span className="text-amber-400 ml-1">(estimated)</span>}
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-slate-500 text-xs">Total Units After</p>
                    <p className="text-white font-bold text-sm">{fmt(newTotalUnits, 4)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs">New Avg Price</p>
                    <p className="text-white font-bold text-sm">₱{newAvgPrice.toFixed(4)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs">Total Cost After</p>
                    <p className="text-slate-200 text-sm">{fmtPeso(newTotalCost, 2)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs">Market Value</p>
                    <p className="text-slate-200 text-sm">{fmtPeso(newMarketValue, 2)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-slate-500 text-xs">Unrealized Gain/Loss</p>
                    <p
                      className={`font-bold text-sm ${
                        newUnrealizedGain >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {newUnrealizedGain >= 0 ? '+' : ''}{fmtPeso(newUnrealizedGain, 2)}{' '}
                      <span className="font-normal text-xs">
                        ({newUnrealizedGain >= 0 ? '+' : ''}{newUnrealizedGainPct.toFixed(2)}%)
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-slate-300 font-medium py-3 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || parsedAmount <= 0 || parsedNavpu <= 0}
                  className="flex-2 bg-amber-600 hover:bg-amber-500 disabled:bg-neutral-800/50 disabled:text-slate-500 text-white font-bold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 min-w-[140px]"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Recording...
                    </>
                  ) : (
                    isPending ? 'Record Pending Buy' : 'Confirm Buy'
                  )}
                </button>
              </div>

              <p className="text-slate-600 text-xs text-center">
                Enter the NAVPU from your actual GCash confirmation.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

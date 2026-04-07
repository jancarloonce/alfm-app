import React, { useState, useEffect, useCallback } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'

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

export default function BuyModal({
  onClose,
  todaySignal,
  todayNavpu,
  position,
  todayStr,
  currentMonthStr,
}) {
  const recommendedAmount = todaySignal?.amount ?? 2500
  const defaultNavpu = todayNavpu ?? position?.avgPrice ?? 46.0

  const [amount, setAmount] = useState(String(recommendedAmount))
  const [navpu, setNavpu] = useState(String(defaultNavpu))
  const [overrideUnits, setOverrideUnits] = useState(false)
  const [manualUnits, setManualUnits] = useState('')
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
      const recordBuy = httpsCallable(functions, 'recordBuy')
      const payload = {
        amount: parsedAmount,
        navpu: parsedNavpu,
      }
      if (overrideUnits && parseFloat(manualUnits) > 0) {
        payload.unitsOverride = parseFloat(manualUnits)
        payload.newAvgPriceOverride = newAvgPrice
        payload.totalUnitsOverride = newTotalUnits
        payload.totalCostOverride = newTotalCost
      }
      const result = await recordBuy(payload)
      setSuccess(true)
      setTimeout(() => {
        onClose()
      }, 1800)
    } catch (err) {
      console.error('recordBuy error:', err)
      setError(err.message || 'Failed to record buy. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-bold text-white">Record a Buy</h2>
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
            <div className="bg-slate-700/50 border border-slate-600 rounded-xl p-4">
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
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-7 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-emerald-500 transition-colors"
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
                      className="text-emerald-500 hover:text-emerald-400 underline"
                    >
                      Use recommended
                    </button>
                  </p>
                )}
              </div>

              {/* NAVPU input */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  NAVPU (₱)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                  <input
                    type="number"
                    value={navpu}
                    onChange={(e) => setNavpu(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-7 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="46.02"
                    step="0.01"
                  />
                </div>
                {todayNavpu && (
                  <p className="text-slate-500 text-xs mt-1">
                    Today's NAVPU: ₱{todayNavpu.toFixed(2)}
                    {' '}·{' '}
                    <button
                      onClick={() => setNavpu(String(todayNavpu))}
                      className="text-emerald-500 hover:text-emerald-400 underline"
                    >
                      Use today's
                    </button>
                  </p>
                )}
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
                        : 'bg-slate-700 border-slate-600 text-slate-400 hover:text-slate-300'
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
                    className="w-full bg-slate-900 border border-amber-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder={`Calculated: ${(parsedNavpu > 0 ? parsedAmount / parsedNavpu : 0).toFixed(4)}`}
                    step="0.0001"
                  />
                ) : (
                  <div className="bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3">
                    <p className="text-white font-bold">{fmt(calcUnitsBought, 4)} units</p>
                    <p className="text-slate-500 text-xs mt-0.5">= ₱{parsedAmount} ÷ ₱{parsedNavpu}</p>
                  </div>
                )}
              </div>

              {/* Calculated summary */}
              <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 space-y-2">
                <p className="text-slate-400 text-xs font-medium mb-3">Position Preview</p>

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
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-3 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || parsedAmount <= 0 || parsedNavpu <= 0}
                  className="flex-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 min-w-[140px]"
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
                    'Confirm Buy'
                  )}
                </button>
              </div>

              <p className="text-slate-600 text-xs text-center">
                ⏰ Remember to place your order before 2:00 PM PH time
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

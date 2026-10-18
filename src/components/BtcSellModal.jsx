import React, { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'

function fmtPhp(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return '₱' + Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtUsd(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmt(n, decimals = 6) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return Number(n).toFixed(decimals)
}

export default function BtcSellModal({ onClose, btcPosition, currentPriceUsd }) {
  const currentUnits   = btcPosition?.units        ?? 0
  const currentAvgCost = btcPosition?.avgCost      ?? 0
  const currentCostPhp = btcPosition?.totalCostPhp ?? 0

  const [unitsSold,  setUnitsSold]  = useState('')
  const [sellPrice,  setSellPrice]  = useState(currentPriceUsd ? String(currentPriceUsd) : '')
  const [phpPerUsd,  setPhpPerUsd]  = useState('57.50')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [success,    setSuccess]    = useState(false)

  const parsedUnits = parseFloat(unitsSold) || 0
  const parsedPrice = parseFloat(sellPrice) || 0
  const parsedRate  = parseFloat(phpPerUsd) || 0

  const proceedsPhp     = parsedUnits * parsedPrice * parsedRate
  const costBasisPhp    = currentUnits > 0 ? (parsedUnits / currentUnits) * currentCostPhp : 0
  const realizedPnlPhp  = proceedsPhp - costBasisPhp

  const remainingUnits   = currentUnits - parsedUnits
  const remainingCostPhp = currentCostPhp - costBasisPhp

  const handleSellAll = () => setUnitsSold(String(currentUnits))

  const handleSubmit = async () => {
    if (parsedUnits <= 0)           { setError('Units must be greater than zero.'); return }
    if (parsedUnits > currentUnits) { setError(`You only hold ₿${fmt(currentUnits, 6)}.`); return }
    if (parsedPrice <= 0)           { setError('Sell price must be greater than zero.'); return }
    if (parsedRate <= 0)            { setError('PHP/USD rate must be greater than zero.'); return }

    setLoading(true)
    setError(null)

    try {
      const recordBtcSell = httpsCallable(functions, 'recordBtcSell')
      await recordBtcSell({
        unitsSold:   parsedUnits,
        sellPriceUsd: parsedPrice,
        phpPerUsd:    parsedRate,
      })
      setSuccess(true)
      setTimeout(() => onClose(), 1800)
    } catch (err) {
      console.error('recordBtcSell error:', err)
      setError(err.message || 'Failed to record sell. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
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
          <h2 className="text-lg font-bold text-white">₿ Record BTC Sell</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Current position banner */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
            <p className="text-slate-400 text-xs font-medium mb-1">Current Position</p>
            <div className="flex items-center gap-4">
              <span className="text-white font-bold">₿ {fmt(currentUnits, 6)}</span>
              <span className="text-slate-400 text-sm">Avg cost: {fmtUsd(currentAvgCost, 0)}</span>
            </div>
          </div>

          {/* Success */}
          {success && (
            <div className="bg-green-900/60 border border-green-600 rounded-xl px-4 py-3 text-center">
              <p className="text-green-300 font-bold text-lg">Sell Recorded!</p>
              <p className="text-green-400 text-sm mt-1">Closing...</p>
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
              {/* Units to sell */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  BTC Units to Sell
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₿</span>
                  <input
                    type="number"
                    value={unitsSold}
                    onChange={(e) => setUnitsSold(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-7 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-green-500 transition-colors"
                    placeholder={fmt(currentUnits, 6)}
                    step="0.000001"
                  />
                </div>
                <p className="text-slate-500 text-xs mt-1">
                  Available: ₿{fmt(currentUnits, 6)} ·{' '}
                  <button
                    onClick={handleSellAll}
                    className="text-green-500 hover:text-green-400 underline"
                  >
                    Sell all
                  </button>
                </p>
              </div>

              {/* Sell price USD */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Sell Price (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-7 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-green-500 transition-colors"
                    placeholder="95000"
                    step="100"
                  />
                </div>
                {currentPriceUsd && (
                  <p className="text-slate-500 text-xs mt-1">
                    Current: {fmtUsd(currentPriceUsd, 0)} ·{' '}
                    <button
                      onClick={() => setSellPrice(String(currentPriceUsd))}
                      className="text-green-500 hover:text-green-400 underline"
                    >
                      Use current
                    </button>
                  </p>
                )}
              </div>

              {/* PHP/USD rate */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  PHP / USD Rate
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-medium">₱/$</span>
                  <input
                    type="number"
                    value={phpPerUsd}
                    onChange={(e) => setPhpPerUsd(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-green-500 transition-colors"
                    placeholder="57.50"
                    step="0.01"
                  />
                </div>
              </div>

              {/* Sell preview */}
              {parsedUnits > 0 && parsedPrice > 0 && parsedRate > 0 && (
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
                  <p className="text-slate-400 text-xs font-medium mb-3">Sell Preview</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-slate-500 text-xs">Proceeds (PHP)</p>
                      <p className="text-white font-bold text-sm">{fmtPhp(proceedsPhp, 0)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs">Cost Basis (PHP)</p>
                      <p className="text-slate-200 text-sm">{fmtPhp(costBasisPhp, 0)}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-slate-500 text-xs">Realized P&L</p>
                      <p className={`font-bold text-sm ${realizedPnlPhp >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {realizedPnlPhp >= 0 ? '+' : ''}{fmtPhp(realizedPnlPhp, 0)}
                      </p>
                    </div>
                    {remainingUnits > 0 && (
                      <div className="col-span-2 pt-2 border-t border-neutral-800">
                        <p className="text-slate-500 text-xs">Remaining After Sell</p>
                        <p className="text-slate-300 text-sm">₿ {fmt(remainingUnits, 6)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-slate-300 font-medium py-3 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || parsedUnits <= 0 || parsedPrice <= 0 || parsedRate <= 0}
                  className="flex-2 bg-green-600 hover:bg-green-500 disabled:bg-neutral-800/50 disabled:text-slate-500 text-white font-bold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 min-w-[140px]"
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
                    'Confirm Sell'
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

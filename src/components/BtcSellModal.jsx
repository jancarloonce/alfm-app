import React, { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'

function fmtUsd(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function fmtPhp(n, d = 0) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: d, maximumFractionDigits: d })
}

const PDAX_FEE = 0.005

export default function BtcSellModal({ onClose, btcPosition, currentPriceUsd }) {
  const entryPrice  = btcPosition?.entryPriceUsd ?? 0
  const entryPhp    = btcPosition?.entryPhp ?? 0
  const sellTarget  = btcPosition?.sellTargetUsd ?? 0

  const [exitPrice, setExitPrice] = useState(currentPriceUsd ? String(currentPriceUsd) : '')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [success,   setSuccess]   = useState(null)

  const parsedExit = parseFloat(exitPrice) || 0
  const grossPct   = entryPrice > 0 ? (parsedExit - entryPrice) / entryPrice : 0
  const netPct     = grossPct - 2 * PDAX_FEE
  const profitPhp  = entryPhp * netPct
  const newBalance = entryPhp + profitPhp
  const isProfit   = profitPhp >= 0
  const metTarget  = parsedExit >= sellTarget

  const handleSubmit = async () => {
    if (parsedExit <= 0) { setError('Enter the exit price from PDAX.'); return }
    setLoading(true)
    setError(null)
    try {
      const recordBtcSell = httpsCallable(functions, 'recordBtcSell')
      const result = await recordBtcSell({ exitPriceUsd: parsedExit })
      setSuccess(result.data)
      setTimeout(() => onClose(), 2500)
    } catch (err) {
      setError(err.message || 'Failed to record sell.')
    } finally {
      setLoading(false)
    }
  }

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-bold text-white">₿ Log Sell</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Trade context */}
          <div className="bg-slate-700/50 border border-slate-600 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-slate-500 text-xs mb-0.5">Entry Price</p>
              <p className="text-white font-semibold">{fmtUsd(entryPrice, 0)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-0.5">Sell Target</p>
              <p className="text-green-400 font-semibold">{fmtUsd(sellTarget, 0)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-0.5">Deployed</p>
              <p className="text-white font-semibold">{fmtPhp(entryPhp)}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-0.5">Target Status</p>
              <p className={`font-semibold text-xs ${metTarget ? 'text-green-400' : 'text-yellow-400'}`}>
                {metTarget ? 'Target met' : parsedExit > 0 ? `${((sellTarget - parsedExit) / parsedExit * 100).toFixed(2)}% short` : '—'}
              </p>
            </div>
          </div>

          {/* Success */}
          {success && (
            <div className="bg-green-900/50 border border-green-600 rounded-xl px-4 py-4 text-center">
              <p className="text-green-300 font-bold text-lg">
                {success.profitPhp >= 0 ? `+${fmtPhp(success.profitPhp)} profit` : `${fmtPhp(success.profitPhp)} loss`}
              </p>
              <p className="text-green-500 text-sm mt-1">New balance: {fmtPhp(success.newBalancePhp)}</p>
              <p className="text-slate-500 text-xs mt-1">Closing...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {!success && (
            <>
              {/* Exit price input */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Exit Price (USD) — from your PDAX sell confirmation
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    value={exitPrice}
                    onChange={(e) => setExitPrice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-7 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-green-500 transition-colors"
                    placeholder={currentPriceUsd ? String(Math.round(currentPriceUsd)) : '95000'}
                    step="100"
                    autoFocus
                  />
                </div>
                {currentPriceUsd && (
                  <p className="text-slate-500 text-xs mt-1">
                    Current signal price: {fmtUsd(currentPriceUsd, 0)} ·{' '}
                    <button
                      onClick={() => setExitPrice(String(currentPriceUsd))}
                      className="text-green-500 hover:text-green-400 underline"
                    >
                      Use this
                    </button>
                  </p>
                )}
              </div>

              {/* P&L preview */}
              {parsedExit > 0 && (
                <div className={`rounded-xl p-4 border ${isProfit ? 'bg-green-900/20 border-green-800' : 'bg-red-900/20 border-red-800'}`}>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">Gross move</p>
                      <p className={`font-bold ${grossPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {grossPct >= 0 ? '+' : ''}{(grossPct * 100).toFixed(2)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">Net after fees</p>
                      <p className={`font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                        {netPct >= 0 ? '+' : ''}{(netPct * 100).toFixed(2)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">P&L (PHP)</p>
                      <p className={`font-bold text-lg ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}{fmtPhp(profitPhp)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-0.5">New balance</p>
                      <p className="text-white font-bold text-lg">{fmtPhp(newBalance)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-3 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || parsedExit <= 0}
                  className="flex-1 bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? 'Logging...' : 'Confirm Sell'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

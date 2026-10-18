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

const SIGNAL_COLOR = {
  NO_BUY:       'text-slate-400',
  WATCH:        'text-yellow-400',
  WATCH_SKIP:   'text-yellow-500',
  BUY:          'text-blue-400',
  BUY_MORE:     'text-green-400',
  AGGRESSIVE:   'text-emerald-400',
  PRIORITY_BUY: 'text-emerald-300',
  OPP_GAP_WAIT: 'text-orange-400',
  MONTHLY_CAP:  'text-red-400',
}

/**
 * BtcBuyModal
 *
 * Records a BTC purchase via the recordBtcBuy Cloud Function.
 *
 * Inputs:
 *   amountPhp   — PHP you're spending (e.g. ₱1,500)
 *   btcPriceUsd — BTC price in USD at time of purchase (pre-filled from signal)
 *   phpPerUsd   — exchange rate used to convert PHP → USD (e.g. 57.5)
 *
 * BTC units calculation:
 *   unitsBought = amountPhp / phpPerUsd / btcPriceUsd
 *   OR manual override (paste exact units from your exchange)
 *
 * Position preview shows:
 *   New total BTC units, new avg cost in USD, new total PHP invested
 *
 * @param {function}    onClose
 * @param {object|null} btcSignal       Latest signal doc (for context + recommended amount)
 * @param {object|null} btcPosition     Current btc_position/current doc (may be null = first buy)
 * @param {string}      currentMonthStr "YYYY-MM"
 */
export default function BtcBuyModal({ onClose, btcSignal, btcPosition, currentMonthStr }) {
  const recommendedAmount = btcSignal?.amount ?? 1500
  const signalPrice       = btcSignal?.currentPrice ?? null

  const [amountPhp,   setAmountPhp]   = useState(String(recommendedAmount))
  const [btcPrice,    setBtcPrice]    = useState(signalPrice ? String(signalPrice) : '')
  const [phpPerUsd,   setPhpPerUsd]   = useState('57.50')   // sensible default, user should update
  const [manualUnits, setManualUnits] = useState('')
  const [useManual,   setUseManual]   = useState(false)     // toggle: auto calc vs paste from exchange
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [success,     setSuccess]     = useState(false)

  const parsedAmount  = parseFloat(amountPhp)  || 0
  const parsedPrice   = parseFloat(btcPrice)   || 0
  const parsedRate    = parseFloat(phpPerUsd)  || 0

  // BTC units bought: PHP amount → USD → BTC
  const calcUnits = parsedPrice > 0 && parsedRate > 0
    ? parsedAmount / parsedRate / parsedPrice
    : 0

  const unitsBought = useManual
    ? parseFloat(manualUnits) || 0
    : calcUnits

  // Position preview
  const currentUnits    = btcPosition?.units        ?? 0
  const currentAvgCost  = btcPosition?.avgCost      ?? 0   // USD
  const currentCostPhp  = btcPosition?.totalCostPhp ?? 0   // PHP

  const newTotalUnits   = currentUnits + unitsBought
  const newTotalCostPhp = currentCostPhp + parsedAmount

  // Weighted avg cost in USD
  const newAvgCostUsd = newTotalUnits > 0
    ? (currentUnits * currentAvgCost + unitsBought * parsedPrice) / newTotalUnits
    : parsedPrice

  // Live market value preview using signal price
  const liveMarketValuePhp = signalPrice && parsedRate > 0
    ? newTotalUnits * signalPrice * parsedRate
    : null
  const unrealizedPhp = liveMarketValuePhp !== null
    ? liveMarketValuePhp - newTotalCostPhp
    : null
  const unrealizedPct = newTotalCostPhp > 0 && unrealizedPhp !== null
    ? (unrealizedPhp / newTotalCostPhp) * 100
    : null

  const handleSubmit = async () => {
    if (parsedAmount <= 0) { setError('Amount must be greater than zero.'); return }
    if (parsedPrice <= 0)  { setError('BTC price must be greater than zero.'); return }
    if (parsedRate <= 0)   { setError('PHP/USD rate must be greater than zero.'); return }
    if (unitsBought <= 0)  { setError('BTC units must be greater than zero.'); return }

    setLoading(true)
    setError(null)

    try {
      const recordBtcBuy = httpsCallable(functions, 'recordBtcBuy')
      await recordBtcBuy({
        amountPhp:    parsedAmount,
        btcPriceUsd:  parsedPrice,
        phpPerUsd:    parsedRate,
        unitsBought,
        bucket:       btcSignal?.bucket       ?? null,
        signalName:   btcSignal?.signal        ?? null,
        monthYear:    currentMonthStr,
        staggerEventTimestamp: btcSignal?.staggerWarning
          ? (btcSignal?.timestamp ?? null)
          : null,
      })
      setSuccess(true)
      setTimeout(() => onClose(), 1800)
    } catch (err) {
      console.error('recordBtcBuy error:', err)
      setError(err.message || 'Failed to record buy. Please try again.')
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
          <h2 className="text-lg font-bold text-white">₿ Record BTC Buy</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Signal context banner */}
          {btcSignal && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
              <p className="text-slate-400 text-xs font-medium mb-1">Signal at time of buy</p>
              <div className="flex items-center gap-3">
                <span className={`font-bold text-base ${SIGNAL_COLOR[btcSignal.signal] || 'text-slate-300'}`}>
                  {btcSignal.signal?.replace(/_/g, ' ')}
                </span>
                {btcSignal.amount > 0 && (
                  <span className="text-white font-bold">{fmtPhp(btcSignal.amount, 0)} recommended</span>
                )}
              </div>
              {btcSignal.recommendation && (
                <p className="text-slate-400 text-xs mt-2 line-clamp-2">{btcSignal.recommendation}</p>
              )}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="bg-orange-900/60 border border-orange-600 rounded-xl px-4 py-3 text-center">
              <p className="text-orange-300 font-bold text-lg">₿ Buy Recorded!</p>
              <p className="text-orange-400 text-sm mt-1">Closing...</p>
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
              {/* Amount in PHP */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  Amount Spent (PHP)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₱</span>
                  <input
                    type="number"
                    value={amountPhp}
                    onChange={(e) => setAmountPhp(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-7 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-orange-500 transition-colors"
                    placeholder="1500"
                    min="0"
                    step="500"
                  />
                </div>
                {btcSignal?.amount > 0 && (
                  <p className="text-slate-500 text-xs mt-1">
                    Recommended: {fmtPhp(btcSignal.amount, 0)} ·{' '}
                    <button
                      onClick={() => setAmountPhp(String(btcSignal.amount))}
                      className="text-orange-500 hover:text-orange-400 underline"
                    >
                      Use recommended
                    </button>
                  </p>
                )}
              </div>

              {/* BTC price in USD */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  BTC Price (USD) — at time of purchase
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    value={btcPrice}
                    onChange={(e) => setBtcPrice(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-7 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-orange-500 transition-colors"
                    placeholder="85000"
                    step="100"
                  />
                </div>
                {signalPrice && (
                  <p className="text-slate-500 text-xs mt-1">
                    Signal price: {fmtUsd(signalPrice, 0)} ·{' '}
                    <button
                      onClick={() => setBtcPrice(String(signalPrice))}
                      className="text-orange-500 hover:text-orange-400 underline"
                    >
                      Use signal price
                    </button>
                  </p>
                )}
              </div>

              {/* PHP/USD exchange rate */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5">
                  PHP / USD Rate — check your exchange (e.g. Binance P2P, GCash)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-medium">₱/$</span>
                  <input
                    type="number"
                    value={phpPerUsd}
                    onChange={(e) => setPhpPerUsd(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg pl-10 pr-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-orange-500 transition-colors"
                    placeholder="57.50"
                    step="0.01"
                  />
                </div>
                <p className="text-slate-600 text-xs mt-1">
                  Used to calculate BTC units: ₱{parsedAmount} ÷ {parsedRate} ÷ ${parsedPrice > 0 ? parsedPrice.toLocaleString() : '?'} = {fmt(calcUnits, 6)} BTC
                </p>
              </div>

              {/* BTC units bought */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="block text-slate-400 text-xs font-medium">BTC Units Bought</label>
                  <button
                    onClick={() => setUseManual((v) => !v)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      useManual
                        ? 'bg-amber-900/50 border-amber-600 text-amber-300'
                        : 'bg-neutral-800/50 border-neutral-800 text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    {useManual ? 'Manual (from exchange)' : 'Auto (calculated)'}
                  </button>
                </div>
                {useManual ? (
                  <>
                    <input
                      type="number"
                      value={manualUnits}
                      onChange={(e) => setManualUnits(e.target.value)}
                      className="w-full bg-neutral-950 border border-amber-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                      placeholder={`Auto: ${fmt(calcUnits, 6)}`}
                      step="0.000001"
                    />
                    <p className="text-slate-500 text-xs mt-1">
                      Paste the exact BTC amount from your exchange confirmation.
                    </p>
                  </>
                ) : (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3">
                    <p className="text-white font-bold">₿ {fmt(calcUnits, 6)}</p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      ₱{parsedAmount} ÷ {parsedRate} (rate) ÷ ${parsedPrice > 0 ? parsedPrice.toLocaleString() : '?'} (BTC)
                    </p>
                  </div>
                )}
              </div>

              {/* Position preview */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-2">
                <p className="text-slate-400 text-xs font-medium mb-3">Position Preview</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-slate-500 text-xs">BTC Units After</p>
                    <p className="text-white font-bold text-sm">₿ {fmt(newTotalUnits, 6)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs">New Avg Cost</p>
                    <p className="text-white font-bold text-sm">{fmtUsd(newAvgCostUsd, 0)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs">Total Invested (PHP)</p>
                    <p className="text-slate-200 text-sm">{fmtPhp(newTotalCostPhp, 0)}</p>
                  </div>
                  {liveMarketValuePhp !== null && (
                    <div>
                      <p className="text-slate-500 text-xs">Market Value (PHP)</p>
                      <p className="text-slate-200 text-sm">{fmtPhp(liveMarketValuePhp, 0)}</p>
                    </div>
                  )}
                  {unrealizedPhp !== null && (
                    <div className="col-span-2">
                      <p className="text-slate-500 text-xs">Unrealized Gain / Loss</p>
                      <p className={`font-bold text-sm ${unrealizedPhp >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {unrealizedPhp >= 0 ? '+' : ''}{fmtPhp(unrealizedPhp, 0)}{' '}
                        <span className="font-normal text-xs">
                          ({unrealizedPct !== null ? (unrealizedPhp >= 0 ? '+' : '') + unrealizedPct.toFixed(2) + '%' : '-'})
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              </div>

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
                  disabled={loading || parsedAmount <= 0 || parsedPrice <= 0 || unitsBought <= 0}
                  className="flex-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800/50 disabled:text-slate-500 text-white font-bold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 min-w-[140px]"
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
                    '₿ Confirm Buy'
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

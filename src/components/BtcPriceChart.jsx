import React, { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from 'recharts'

const WINDOWS = [
  { label: '24h',  candles: 24  },
  { label: '7d',   candles: 168 },
  { label: '30d',  candles: 720 },
]

function fmtUsd(n) {
  if (n == null) return '-'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtPct(n) {
  if (n == null) return ''
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 shadow-xl text-xs">
      <p className="font-bold text-white mb-1">{d.label}</p>
      <p className="text-slate-300">
        Price: <span className="font-bold text-white">{fmtUsd(d.price)}</span>
      </p>
      {d.hourlyPct != null && (
        <p className={d.hourlyPct >= 0 ? 'text-green-400' : 'text-red-400'}>
          1h: {fmtPct(d.hourlyPct)}
        </p>
      )}
      {d.isBuy && (
        <p className="text-orange-300 font-bold mt-1">
          Bought ₱{d.buyAmount?.toLocaleString()} — {d.signalName?.replace(/_/g, ' ')}
        </p>
      )}
    </div>
  )
}

const BuyDot = (props) => {
  const { cx, cy, payload } = props
  if (!payload?.isBuy) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill="#f97316" stroke="#431407" strokeWidth={2} opacity={0.9} />
      <circle cx={cx} cy={cy} r={3} fill="white" />
    </g>
  )
}

/**
 * BtcPriceChart
 *
 * Fetches Binance hourly candles in-browser and renders a BTC price chart
 * with buy event markers and dynamic threshold zone overlays.
 *
 * @param {Array}       btcBuys    Buy records from btc_buys (for buy dot overlay)
 * @param {object|null} thresholds Latest thresholds from btcSignal.thresholds
 * @param {number|null} avgCost    User's avg cost in USD (for reference line)
 */
export default function BtcPriceChart({ btcBuys = [], thresholds = null, avgCost = null }) {
  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [windowIdx, setWindowIdx] = useState(1)  // default: 7d
  const [showZones, setShowZones] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=720')
      .then((r) => {
        if (!r.ok) throw new Error(`Binance HTTP ${r.status}`)
        return r.json()
      })
      .then((raw) => {
        if (cancelled) return
        setCandles(raw.map((k) => ({
          openTime: k[0],
          open:     parseFloat(k[1]),
          close:    parseFloat(k[4]),
          volume:   parseFloat(k[5]),
        })))
        setLoading(false)
      })
      .catch((err) => {
        if (!cancelled) { setError(err.message); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [])

  const { candles: windowSize, label: windowLabel } = WINDOWS[windowIdx]
  const slice = candles.slice(-windowSize)

  // Build buy lookup keyed by the ISO hour bucket ("YYYY-MM-DDTHH")
  const buyByHour = {}
  for (const buy of btcBuys) {
    if (!buy.timestamp) continue
    const hourKey = buy.timestamp.slice(0, 13)  // "YYYY-MM-DDTHH"
    if (!buyByHour[hourKey]) buyByHour[hourKey] = []
    buyByHour[hourKey].push(buy)
  }

  const chartData = slice.map((c, i) => {
    const prev = i > 0 ? slice[i - 1].close : null
    const hourlyPct = prev != null ? ((c.close - prev) / prev) * 100 : null
    const dt = new Date(c.openTime)

    // Format label based on window
    let label
    if (windowSize <= 24) {
      label = dt.toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false })
    } else if (windowSize <= 168) {
      label = dt.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', hour12: false })
    } else {
      label = dt.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
    }

    // Match buy events to this candle's hour bucket
    const utcHour = dt.toISOString().slice(0, 13)
    const buysThisHour = buyByHour[utcHour] || []
    const isBuy = buysThisHour.length > 0
    const buyAmount = isBuy ? buysThisHour.reduce((s, b) => s + (b.amountPhp || 0), 0) : null
    const signalName = isBuy ? buysThisHour[0].signalName : null

    return { openTime: c.openTime, price: c.close, hourlyPct, label, isBuy, buyAmount, signalName }
  })

  // Y-axis domain
  const prices = chartData.map((d) => d.price).filter(Boolean)
  const minP = prices.length ? Math.min(...prices) : 0
  const maxP = prices.length ? Math.max(...prices) : 1
  const pad  = (maxP - minP) * 0.04
  const domainMin = parseFloat((minP - pad).toFixed(0))
  const domainMax = parseFloat((maxP + pad).toFixed(0))

  // Reference lines from thresholds
  const zones = thresholds ? [
    { value: thresholds.noBuyThreshold,  label: 'No-Buy',  color: '#64748b' },
    { value: thresholds.watchThreshold,  label: 'Watch',   color: '#eab308' },
    { value: thresholds.buyThreshold,    label: 'Buy',     color: '#3b82f6' },
    { value: thresholds.buyMoreThreshold,label: 'Buy More',color: '#22c55e' },
  ].filter((z) => z.value > domainMin && z.value < domainMax) : []

  // X-axis interval
  const xInterval = Math.max(1, Math.floor(chartData.length / (windowSize <= 24 ? 6 : 10)))

  const currentPrice = chartData.length ? chartData[chartData.length - 1].price : null
  const firstPrice   = chartData.length ? chartData[0].price : null
  const windowChange = currentPrice && firstPrice ? ((currentPrice - firstPrice) / firstPrice) * 100 : null

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <p className="label">BTC Price Chart</p>
          <p className="text-slate-500 text-xs mt-0.5">
            Hourly candles · Buy events marked in orange
            {windowChange != null && (
              <span className={`ml-2 font-medium ${windowChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {windowLabel}: {fmtPct(windowChange)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Window selector */}
          <div className="flex bg-slate-700/60 rounded-lg p-0.5 gap-0.5">
            {WINDOWS.map((w, idx) => (
              <button
                key={w.label}
                onClick={() => setWindowIdx(idx)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  windowIdx === idx
                    ? 'bg-slate-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowZones((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              showZones
                ? 'bg-slate-700 border-slate-500 text-slate-300'
                : 'bg-transparent border-slate-700 text-slate-500'
            }`}
          >
            {showZones ? 'Zones ON' : 'Zones OFF'}
          </button>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 hidden sm:flex">
            <div className="w-3 h-3 rounded-full bg-orange-500" />
            Buy
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64">
          <p className="text-slate-500 text-sm animate-pulse">Fetching Binance data...</p>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center h-64">
          <p className="text-red-400 text-sm">Failed to load chart: {error}</p>
        </div>
      )}

      {!loading && !error && (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="label"
              tick={{ fill: '#64748b', fontSize: 10 }}
              interval={xInterval}
            />
            <YAxis
              domain={[domainMin, domainMax]}
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickFormatter={(v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
              width={75}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Threshold zone bands */}
            {showZones && thresholds && (() => {
              const { noBuyThreshold: nb, watchThreshold: w, buyThreshold: b, buyMoreThreshold: bm } = thresholds
              return (
                <>
                  {bm > domainMin && <ReferenceArea y1={domainMin} y2={Math.min(bm, domainMax)} fill="#064e3b" fillOpacity={0.18} />}
                  {b  > domainMin && bm < domainMax && <ReferenceArea y1={Math.max(bm, domainMin)} y2={Math.min(b, domainMax)}  fill="#14532d" fillOpacity={0.12} />}
                  {w  > domainMin && b  < domainMax && <ReferenceArea y1={Math.max(b, domainMin)}  y2={Math.min(w, domainMax)}  fill="#1e3a5f" fillOpacity={0.12} />}
                  {nb > domainMin && w  < domainMax && <ReferenceArea y1={Math.max(w, domainMin)}  y2={Math.min(nb, domainMax)} fill="#713f12" fillOpacity={0.10} />}
                  {nb < domainMax && <ReferenceArea y1={Math.max(nb, domainMin)} y2={domainMax} fill="#1e293b" fillOpacity={0.08} />}
                </>
              )
            })()}

            {/* Threshold reference lines */}
            {showZones && zones.map((z) => (
              <ReferenceLine
                key={z.label}
                y={z.value}
                stroke={z.color}
                strokeDasharray="4 2"
                strokeWidth={1}
                label={{
                  value: `${z.label} ${fmtUsd(z.value)}`,
                  fill: z.color,
                  fontSize: 9,
                  position: 'insideTopRight',
                }}
              />
            ))}

            {/* Avg cost reference line */}
            {avgCost && avgCost > domainMin && avgCost < domainMax && (
              <ReferenceLine
                y={avgCost}
                stroke="#34d399"
                strokeDasharray="6 2"
                strokeWidth={1.5}
                label={{
                  value: `Avg ${fmtUsd(avgCost)}`,
                  fill: '#34d399',
                  fontSize: 9,
                  position: 'insideTopRight',
                }}
              />
            )}

            {/* BTC price line */}
            <Line
              type="monotone"
              dataKey="price"
              stroke="#f97316"
              strokeWidth={2}
              dot={<BuyDot />}
              activeDot={{ r: 4, fill: '#fdba74' }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="mt-3 pt-3 border-t border-slate-700 flex flex-wrap gap-4 text-xs text-slate-500">
        {currentPrice && <span>Current: <span className="text-slate-300 font-medium">{fmtUsd(currentPrice)}</span></span>}
        {thresholds?.periodHigh && <span>30d High: <span className="text-slate-400">{fmtUsd(thresholds.periodHigh)}</span></span>}
        {thresholds?.periodLow  && <span>30d Low: <span className="text-slate-400">{fmtUsd(thresholds.periodLow)}</span></span>}
        {thresholds?.mean       && <span>30d Mean: <span className="text-slate-400">{fmtUsd(thresholds.mean)}</span></span>}
        {thresholds?.usingBaseline && <span className="text-amber-500">⚠ Using baseline thresholds</span>}
      </div>
    </div>
  )
}

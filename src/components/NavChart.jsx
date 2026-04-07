import React, { useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Scatter,
  ComposedChart,
  ReferenceArea,
} from 'recharts'

function fmt(n, d = 2) {
  if (n === null || n === undefined) return '-'
  return Number(n).toFixed(d)
}

const REFERENCE_LINES = [
  { y: 46.5, label: 'No Buy', color: '#64748b', dash: '4 2' },
  { y: 46.2, label: 'Watch', color: '#eab308', dash: '4 2' },
  { y: 46.0, label: 'Buy', color: '#3b82f6', dash: '4 2' },
  { y: 45.8, label: 'Buy More', color: '#22c55e', dash: '4 2' },
  { y: 45.48, label: 'Avg/Priority', color: '#34d399', dash: '6 2' },
]

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null
  const d = payload[0]?.payload
  if (!d) return null

  const change = d.dailyChange
  const isUp = change > 0
  const isDown = change < 0

  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 shadow-xl text-sm">
      <p className="font-bold text-white mb-1">{d.date}</p>
      <p className="text-slate-300">
        NAVPU: <span className="font-bold text-white">₱{fmt(d.navpu, 2)}</span>
      </p>
      {change !== undefined && (
        <p
          className={`${
            isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-slate-400'
          }`}
        >
          Change: {isUp ? '+' : ''}{fmt(change, 4)}
        </p>
      )}
      {d.isBuyEvent && (
        <p className="text-emerald-400 font-bold mt-1">
          Bought ₱{d.buyAmount?.toLocaleString()}
        </p>
      )}
    </div>
  )
}

const BuyDot = (props) => {
  const { cx, cy, payload } = props
  if (!payload?.isBuyEvent) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill="#10b981" stroke="#064e3b" strokeWidth={2} opacity={0.9} />
      <circle cx={cx} cy={cy} r={3} fill="white" />
    </g>
  )
}

export default function NavChart({ navHistory, buys }) {
  const [showZones, setShowZones] = useState(true)

  // Build buy lookup by date
  const buyByDate = {}
  buys.forEach((b) => {
    if (!buyByDate[b.date]) buyByDate[b.date] = []
    buyByDate[b.date].push(b)
  })

  // Build chart data
  const sorted = [...navHistory].sort((a, b) => a.date.localeCompare(b.date))
  const chartData = sorted.map((entry, i) => {
    const prev = i > 0 ? sorted[i - 1].navpu : null
    const dailyChange = prev !== null ? parseFloat((entry.navpu - prev).toFixed(4)) : 0
    const buyEvents = buyByDate[entry.date] || []
    const isBuyEvent = buyEvents.length > 0
    const buyAmount = isBuyEvent ? buyEvents.reduce((sum, b) => sum + b.amount, 0) : undefined

    return {
      date: entry.date,
      navpu: entry.navpu,
      dailyChange,
      isBuyEvent,
      buyAmount,
    }
  })

  // Axis domain
  const allNavpus = chartData.map((d) => d.navpu).filter(Boolean)
  const minY = allNavpus.length ? Math.min(...allNavpus, 45.3) : 45.0
  const maxY = allNavpus.length ? Math.max(...allNavpus, 47.2) : 47.5
  const paddedMin = parseFloat((minY - 0.1).toFixed(2))
  const paddedMax = parseFloat((maxY + 0.1).toFixed(2))

  // Format x axis: show every ~10th label
  const xInterval = Math.max(1, Math.floor(chartData.length / 10))

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="label">NAVPU History</p>
          <p className="text-slate-500 text-xs mt-0.5">Last 90 days · Buy events marked in green</p>
        </div>
        <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            Buy event
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#64748b', fontSize: 10 }}
            interval={xInterval}
            tickFormatter={(v) => v.slice(5)} // Show MM-DD
          />
          <YAxis
            domain={[paddedMin, paddedMax]}
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickFormatter={(v) => `₱${v.toFixed(2)}`}
            width={65}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Color zone bands */}
          {showZones && (
            <>
              <ReferenceArea y1={paddedMin} y2={45.48} fill="#064e3b" fillOpacity={0.15} />
              <ReferenceArea y1={45.48} y2={45.79} fill="#065f46" fillOpacity={0.12} />
              <ReferenceArea y1={45.79} y2={45.99} fill="#14532d" fillOpacity={0.10} />
              <ReferenceArea y1={45.99} y2={46.19} fill="#1e3a5f" fillOpacity={0.10} />
              <ReferenceArea y1={46.19} y2={46.49} fill="#713f12" fillOpacity={0.10} />
              <ReferenceArea y1={46.49} y2={paddedMax} fill="#1e293b" fillOpacity={0.08} />
            </>
          )}

          {/* Reference lines */}
          {REFERENCE_LINES.map((rl) => (
            <ReferenceLine
              key={rl.y}
              y={rl.y}
              stroke={rl.color}
              strokeDasharray={rl.dash}
              strokeWidth={1}
              label={{
                value: `${rl.label} (${rl.y})`,
                fill: rl.color,
                fontSize: 9,
                position: 'insideTopRight',
              }}
            />
          ))}

          {/* Main NAVPU line */}
          <Line
            type="monotone"
            dataKey="navpu"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={<BuyDot />}
            activeDot={{ r: 4, fill: '#93c5fd' }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

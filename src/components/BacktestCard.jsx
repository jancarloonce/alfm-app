import React, { useState, useEffect } from 'react'
import { doc, onSnapshot, collection, query, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return '-'
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function pctColor(val) {
  if (val === null || val === undefined) return 'text-slate-400'
  return val >= 60 ? 'text-emerald-400' : val >= 40 ? 'text-yellow-400' : 'text-red-400'
}

function returnColor(val) {
  if (val === null || val === undefined) return 'text-slate-400'
  return val > 0 ? 'text-emerald-400' : val < 0 ? 'text-red-400' : 'text-slate-400'
}

const SIGNAL_COLORS = {
  BUY: 'bg-blue-900 text-blue-300',
  BUY_MORE: 'bg-green-900 text-green-300',
  AGGRESSIVE: 'bg-emerald-900 text-emerald-300',
  PRIORITY_BUY: 'bg-emerald-800 text-emerald-200',
  WATCH: 'bg-yellow-900 text-yellow-300',
  NO_BUY: 'bg-slate-700 text-slate-400',
  WATCH_SKIP: 'bg-slate-700 text-slate-400',
  NO_SECOND_BUY: 'bg-slate-700 text-slate-400',
  MONTHLY_CAP: 'bg-red-900 text-red-300',
}

export default function BacktestCard() {
  const [summary, setSummary] = useState(null)
  const [results, setResults] = useState([])
  const [showTable, setShowTable] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'backtest_summary'), (snap) => {
      if (snap.exists()) setSummary(snap.data())
      setLoading(false)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!showTable) return
    const q = query(collection(db, 'backtest_results'), orderBy('date', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setResults(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [showTable])

  if (loading) {
    return (
      <div className="card">
        <p className="label mb-2">Backtest</p>
        <p className="text-slate-500 text-sm">Loading...</p>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="card">
        <p className="label mb-2">Backtest</p>
        <p className="text-slate-500 text-sm mb-3">No backtest data yet.</p>
        <p className="text-slate-600 text-xs">
          Deploy and call the <code className="text-slate-400">runBacktest</code> HTTP function once to generate results.
        </p>
      </div>
    )
  }

  const actionableSignals = Object.entries(summary.signalBreakdown || {})
    .filter(([s]) => ['BUY', 'BUY_MORE', 'AGGRESSIVE', 'PRIORITY_BUY', 'WATCH'].includes(s))
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="label">Strategy Backtest</p>
          <p className="text-slate-500 text-xs mt-0.5">
            {summary.backtestPeriod?.from} → {summary.backtestPeriod?.to}
            {' · '}{summary.totalDays} business days
          </p>
        </div>
        <span className="text-slate-600 text-xs">
          {summary.computedAt ? new Date(summary.computedAt).toLocaleDateString('en-PH') : ''}
        </span>
      </div>

      {/* Overall score */}
      <div className="bg-slate-700/50 rounded-lg p-4 mb-4 text-center">
        <p className="text-slate-400 text-xs mb-1">Overall Signal Accuracy (both conditions)</p>
        <p className={`text-4xl font-black ${pctColor(summary.pctCorrectBoth)}`}>
          {summary.pctCorrectBoth != null ? `${summary.pctCorrectBoth}%` : '-'}
        </p>
        <p className="text-slate-500 text-xs mt-1">
          of {summary.totalActionable} actionable signals were correct
        </p>
      </div>

      {/* Two metrics */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-700/40 rounded-lg p-3 text-center">
          <p className="text-slate-500 text-xs mb-1">↑ Price after 3 days</p>
          <p className={`text-2xl font-bold ${pctColor(summary.pctPositiveReturn3d)}`}>
            {summary.pctPositiveReturn3d != null ? `${summary.pctPositiveReturn3d}%` : '-'}
          </p>
          <p className="text-slate-600 text-xs">3d return &gt; 0</p>
        </div>
        <div className="bg-slate-700/40 rounded-lg p-3 text-center">
          <p className="text-slate-500 text-xs mb-1">Entry below 5d avg</p>
          <p className={`text-2xl font-bold ${pctColor(summary.pctBelowAvg5d)}`}>
            {summary.pctBelowAvg5d != null ? `${summary.pctBelowAvg5d}%` : '-'}
          </p>
          <p className="text-slate-600 text-xs">good entry quality</p>
        </div>
      </div>

      {/* Average returns */}
      <div className="border-t border-slate-700 pt-3 mb-4">
        <p className="label text-xs mb-2">Avg Return After Buy Signal</p>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '+1 day', val: summary.avgReturn1d },
            { label: '+3 days', val: summary.avgReturn3d },
            { label: '+5 days', val: summary.avgReturn5d },
          ].map(({ label, val }) => (
            <div key={label} className="text-center">
              <p className={`text-lg font-bold ${returnColor(val)}`}>
                {val != null ? `${val > 0 ? '+' : ''}${fmt(val, 3)}%` : '-'}
              </p>
              <p className="text-slate-500 text-xs">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* NO_BUY effectiveness */}
      <div className="border-t border-slate-700 pt-3 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-slate-400 text-sm font-medium">NO_BUY Effectiveness</p>
            <p className="text-slate-600 text-xs">
              NAVPU dropped within 5 days after hold signal ({summary.noBuyTotal} days)
            </p>
          </div>
          <p className={`text-xl font-bold ${pctColor(summary.noBuyEffectiveness)}`}>
            {summary.noBuyEffectiveness != null ? `${summary.noBuyEffectiveness}%` : '-'}
          </p>
        </div>
      </div>

      {/* Best / Worst */}
      {(summary.bestSignal || summary.worstSignal) && (
        <div className="border-t border-slate-700 pt-3 mb-4 grid grid-cols-2 gap-3">
          {summary.bestSignal && (
            <div>
              <p className="text-slate-500 text-xs mb-1">Best Signal</p>
              <p className="text-white text-sm font-medium">{summary.bestSignal.date}</p>
              <p className="text-emerald-400 text-sm">{summary.bestSignal.signal.replace('_', ' ')}</p>
              <p className="text-emerald-400 text-xs">+{fmt(summary.bestSignal.return3d, 3)}% (3d)</p>
            </div>
          )}
          {summary.worstSignal && (
            <div>
              <p className="text-slate-500 text-xs mb-1">Worst Signal</p>
              <p className="text-white text-sm font-medium">{summary.worstSignal.date}</p>
              <p className="text-red-400 text-sm">{summary.worstSignal.signal.replace('_', ' ')}</p>
              <p className="text-red-400 text-xs">{fmt(summary.worstSignal.return3d, 3)}% (3d)</p>
            </div>
          )}
        </div>
      )}

      {/* Signal breakdown */}
      <div className="border-t border-slate-700 pt-3 mb-4">
        <p className="label text-xs mb-2">Signal Distribution ({summary.totalDays} days)</p>
        <div className="space-y-1">
          {Object.entries(summary.signalBreakdown || {})
            .sort((a, b) => b[1] - a[1])
            .map(([signal, count]) => (
              <div key={signal} className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${SIGNAL_COLORS[signal] || 'bg-slate-700 text-slate-300'}`}>
                  {signal.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                  <div
                    className="bg-slate-400 h-1.5 rounded-full"
                    style={{ width: `${(count / summary.totalDays) * 100}%` }}
                  />
                </div>
                <span className="text-slate-400 text-xs w-6 text-right">{count}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Buy timing distribution */}
      {summary.buyDayDistribution && (
        <div className="border-t border-slate-700 pt-3 mb-4">
          <p className="label text-xs mb-1">Buy Timing Distribution</p>
          <p className="text-slate-600 text-xs mb-2">Which week of the month do actionable signals fire?</p>
          <div className="space-y-1.5">
            {Object.entries(summary.buyDayDistribution).map(([week, count]) => {
              const total = Object.values(summary.buyDayDistribution).reduce((a, b) => a + b, 0)
              const pct = total > 0 ? (count / total) * 100 : 0
              const isHeavy = pct > 35
              return (
                <div key={week} className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs w-28 shrink-0">{week}</span>
                  <div className="flex-1 bg-slate-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${isHeavy ? 'bg-amber-400' : 'bg-slate-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-xs w-10 text-right ${isHeavy ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
                    {count} ({pct.toFixed(0)}%)
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Detailed results toggle */}
      <button
        onClick={() => setShowTable((v) => !v)}
        className="w-full text-center text-slate-500 hover:text-slate-300 text-xs py-2 border border-slate-700 rounded transition-colors"
      >
        {showTable ? 'Hide' : 'Show'} day-by-day results
      </button>

      {showTable && results.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700">
                <th className="text-left py-1 pr-2">Date</th>
                <th className="text-left py-1 pr-2">NAVPU</th>
                <th className="text-left py-1 pr-2">Signal</th>
                <th className="text-right py-1 pr-2">3d %</th>
                <th className="text-right py-1 pr-2">vs 5d avg</th>
                <th className="text-center py-1">✓</th>
              </tr>
            </thead>
            <tbody>
              {results.filter((r) => r.isActionable || r.signal === 'NO_BUY').map((r) => (
                <tr key={r.date} className="border-b border-slate-800 hover:bg-slate-800/40">
                  <td className="py-1 pr-2 text-slate-400">{r.date}</td>
                  <td className="py-1 pr-2 text-slate-300">₱{fmt(r.navpu)}</td>
                  <td className="py-1 pr-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${SIGNAL_COLORS[r.signal] || ''}`}>
                      {r.signal.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={`py-1 pr-2 text-right font-medium ${returnColor(r.return3d)}`}>
                    {r.return3d != null ? `${r.return3d > 0 ? '+' : ''}${fmt(r.return3d, 3)}%` : '-'}
                  </td>
                  <td className={`py-1 pr-2 text-right ${r.belowAvg5d ? 'text-emerald-400' : r.belowAvg5d === false ? 'text-red-400' : 'text-slate-500'}`}>
                    {r.belowAvg5d != null ? (r.belowAvg5d ? '↓ below' : '↑ above') : '-'}
                  </td>
                  <td className="py-1 text-center">
                    {r.isActionable
                      ? r.correctBoth != null
                        ? r.correctBoth ? '✅' : '❌'
                        : '-'
                      : r.noBuyCorrect != null
                      ? r.noBuyCorrect ? '✅' : '❌'
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

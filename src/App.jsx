import React, { useState, useEffect, useCallback } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  limit,
} from 'firebase/firestore'
import { db } from './lib/firebase'
import SignalCard from './components/SignalCard'
import PositionCard from './components/PositionCard'
import NavpuCard from './components/NavpuCard'
import DividendCard from './components/DividendCard'
import NavChart from './components/NavChart'
import BuyLog from './components/BuyLog'
import BuyModal from './components/BuyModal'
import BacktestCard from './components/BacktestCard'

function getTodayPH() {
  const now = new Date()
  const ph = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
  const y = ph.getFullYear()
  const m = String(ph.getMonth() + 1).padStart(2, '0')
  const d = String(ph.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getCurrentMonthPH() {
  const now = new Date()
  const ph = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
  const y = ph.getFullYear()
  const m = String(ph.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export default function App() {
  const [todaySignal, setTodaySignal] = useState(null)
  const [position, setPosition] = useState(null)
  const [navHistory, setNavHistory] = useState([])
  const [buys, setBuys] = useState([])
  const [monthlyBuyCount, setMonthlyBuyCount] = useState(0)
  const [thresholds, setThresholds] = useState(null)
  const [showBuyModal, setShowBuyModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const todayStr = getTodayPH()
  const currentMonthStr = getCurrentMonthPH()

  // Load today's signal
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'signals', todayStr), (snap) => {
      if (snap.exists()) {
        setTodaySignal({ id: snap.id, ...snap.data() })
      } else {
        setTodaySignal(null)
      }
    }, (err) => {
      console.error('Signal listener error:', err)
    })
    return () => unsub()
  }, [todayStr])

  // Load position
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'position', 'current'), (snap) => {
      if (snap.exists()) {
        setPosition(snap.data())
      }
      setLoading(false)
    }, (err) => {
      console.error('Position listener error:', err)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  // Load NAVPU history
  useEffect(() => {
    const q = query(collection(db, 'navpu_history'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setNavHistory(data)
    }, (err) => {
      console.error('NavHistory listener error:', err)
    })
    return () => unsub()
  }, [])

  // Load dynamic thresholds
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'thresholds'), (snap) => {
      if (snap.exists()) setThresholds(snap.data())
    })
    return () => unsub()
  }, [])

  // Load buys
  useEffect(() => {
    const q = query(collection(db, 'buys'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setBuys(data)
      // Count opportunity buys this month (stagger-aware, excludes dividend and extreme_override)
      const thisMonth = data.filter((b) => b.monthYear === currentMonthStr)
      const oppBuys = thisMonth.filter((b) => !b.isDividendBuy && b.bucket !== 'extreme_override')
      const staggerSeen = new Set()
      let oppCount = 0
      for (const buy of oppBuys) {
        if (buy.staggerEventDate) {
          if (!staggerSeen.has(buy.staggerEventDate)) {
            staggerSeen.add(buy.staggerEventDate)
            oppCount++
          }
        } else {
          oppCount++
        }
      }
      setMonthlyBuyCount(oppCount)
    }, (err) => {
      console.error('Buys listener error:', err)
    })
    return () => unsub()
  }, [currentMonthStr])

  // Use most recent available NAVPU (published with 1-day lag, stored under effective date)
  const sortedHistory = [...navHistory].sort((a, b) => a.date.localeCompare(b.date))
  const latestNavEntry = sortedHistory.length > 0 ? sortedHistory[sortedHistory.length - 1] : null
  const prevNavEntry = sortedHistory.length > 1 ? sortedHistory[sortedHistory.length - 2] : null
  const todayNavpu = latestNavEntry ? latestNavEntry.navpu : null
  const yesterdayNavpu = prevNavEntry ? prevNavEntry.navpu : null
  const dailyChange =
    todayNavpu !== null && yesterdayNavpu !== null
      ? parseFloat((todayNavpu - yesterdayNavpu).toFixed(4))
      : null

  // 90-day stats
  const last90 = sortedHistory.slice(-90)
  const navValues = last90.map((n) => n.navpu).filter(Boolean)
  const navHigh = navValues.length ? Math.max(...navValues) : null
  const navLow = navValues.length ? Math.min(...navValues) : null
  const navMean = navValues.length
    ? parseFloat((navValues.reduce((a, b) => a + b, 0) / navValues.length).toFixed(4))
    : null

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 text-lg animate-pulse">Loading ALFM Tracker...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              ALFM Fund Tracker
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              ALFM Global Multi-Asset Income Fund (PHP)
            </p>
          </div>
          <div className="text-right">
            <p className="text-slate-300 font-medium">{todayStr}</p>
            <p className="text-slate-500 text-xs">Asia/Manila</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Row 1: Signal Card */}
        <SignalCard
          signal={todaySignal}
          todayNavpu={todayNavpu}
          dailyChange={dailyChange}
        />

        {/* Row 2: 3 columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PositionCard
            position={position}
            todayNavpu={todayNavpu}
            monthlyBuyCount={monthlyBuyCount}
          />
          <NavpuCard
            todayNavpu={todayNavpu}
            dailyChange={dailyChange}
            navHigh={navHigh}
            navLow={navLow}
            navMean={navMean}
            thresholds={thresholds}
          />
          <DividendCard todayStr={todayStr} buys={buys} />
        </div>

        {/* Row 3: Chart */}
        <NavChart navHistory={last90} buys={buys} />

        {/* Row 4: Buy Log + Backtest */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BuyLog buys={buys} />
          <BacktestCard />
        </div>
      </main>

      {/* Floating Buy Button */}
      <button
        onClick={() => setShowBuyModal(true)}
        className="fixed bottom-8 right-8 bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-6 py-4 rounded-full shadow-2xl shadow-emerald-900/50 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2 z-40"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
            clipRule="evenodd"
          />
        </svg>
        I Bought
      </button>

      {/* Buy Modal */}
      {showBuyModal && (
        <BuyModal
          onClose={() => setShowBuyModal(false)}
          todaySignal={todaySignal}
          todayNavpu={todayNavpu}
          position={position}
          todayStr={todayStr}
          currentMonthStr={currentMonthStr}
        />
      )}
    </div>
  )
}

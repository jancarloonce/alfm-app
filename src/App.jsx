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
import BtcSignalCard from './components/BtcSignalCard'
import BtcPositionCard from './components/BtcPositionCard'
import BtcBuyModal from './components/BtcBuyModal'
import BtcBacktestCard from './components/BtcBacktestCard'
import BtcSellModal from './components/BtcSellModal'
import BtcBuyLog from './components/BtcBuyLog'
import BtcSellLog from './components/BtcSellLog'
import BtcPriceChart from './components/BtcPriceChart'
import MgpiffDividendCard from './components/MgpiffDividendCard'
import MgpiffBuyModal from './components/MgpiffBuyModal'
import BpibondDividendCard from './components/BpibondDividendCard'
import BpibondBuyModal from './components/BpibondBuyModal'
import MreitBuyModal from './components/MreitBuyModal'
import MreitDividendCard from './components/MreitDividendCard'
import PortfolioDashboard from './components/PortfolioDashboard'

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
  // ── Tab state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview')  // 'overview' | 'alfm' | 'btc' | 'mgpiff' | 'bpibond' | 'mreit' | 'tools'

  // ── ALFM state ───────────────────────────────────────────────────────────────
  const [todaySignal, setTodaySignal] = useState(null)
  const [position, setPosition] = useState(null)
  const [navHistory, setNavHistory] = useState([])
  const [buys, setBuys] = useState([])
  const [monthlyBuyCount, setMonthlyBuyCount] = useState(0)
  const [dividendBuyDone, setDividendBuyDone] = useState(false)
  const [thresholds, setThresholds] = useState(null)
  const [showBuyModal, setShowBuyModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ── Dividend totals ───────────────────────────────────────────────────────────
  const [alfmDividends, setAlfmDividends] = useState([])
  const [mgpiffDividends, setMgpiffDividends] = useState([])

  // ── MGPIFF state ─────────────────────────────────────────────────────────────
  const [mgpiffSignal, setMgpiffSignal] = useState(null)
  const [mgpiffPosition, setMgpiffPosition] = useState(null)
  const [mgpiffNavHistory, setMgpiffNavHistory] = useState([])
  const [mgpiffBuys, setMgpiffBuys] = useState([])
  const [mgpiffThresholds, setMgpiffThresholds] = useState(null)
  const [mgpiffMonthlyBuyCount, setMgpiffMonthlyBuyCount] = useState(0)
  const [mgpiffDividendBuyDone, setMgpiffDividendBuyDone] = useState(false)
  const [showMgpiffBuyModal, setShowMgpiffBuyModal] = useState(false)
  const [mgpiffLoading, setMgpiffLoading] = useState(true)

  // ── BPI Bond state ────────────────────────────────────────────────────────────
  const [bpibondSignal, setBpibondSignal] = useState(null)
  const [bpibondPosition, setBpibondPosition] = useState(null)
  const [bpibondNavHistory, setBpibondNavHistory] = useState([])
  const [bpibondBuys, setBpibondBuys] = useState([])
  const [bpibondThresholds, setBpibondThresholds] = useState(null)
  const [bpibondMonthlyBuyCount, setBpibondMonthlyBuyCount] = useState(0)
  const [bpibondDividendBuyDone, setBpibondDividendBuyDone] = useState(false)
  const [bpibondRspBuyDone, setBpibondRspBuyDone] = useState(false)
  const [showBpibondBuyModal, setShowBpibondBuyModal] = useState(false)
  const [bpibondLoading, setBpibondLoading] = useState(true)
  const [bpibondDividends, setBpibondDividends] = useState([])

  // ── MREIT state ──────────────────────────────────────────────────────────────
  const [mreitSignal, setMreitSignal] = useState(null)
  const [mreitPosition, setMreitPosition] = useState(null)
  const [mreitNavHistory, setMreitNavHistory] = useState([])
  const [mreitBuys, setMreitBuys] = useState([])
  const [mreitThresholds, setMreitThresholds] = useState(null)
  const [mreitMonthlyBuyCount, setMreitMonthlyBuyCount] = useState(0)
  const [mreitDividendBuyDone, setMreitDividendBuyDone] = useState(false)
  const [showMreitBuyModal, setShowMreitBuyModal] = useState(false)
  const [mreitLoading, setMreitLoading] = useState(true)
  const [mreitDividends, setMreitDividends] = useState([])

  // ── BTC state ────────────────────────────────────────────────────────────────
  const [btcSignal, setBtcSignal] = useState(null)
  const [btcPosition, setBtcPosition] = useState(null)
  const [btcMonthlySpentPhp, setBtcMonthlySpentPhp] = useState(0)
  const [btcBuys, setBtcBuys] = useState([])
  const [btcSells, setBtcSells] = useState([])
  const [btcLoading, setBtcLoading] = useState(true)
  const [showBtcBuyModal, setShowBtcBuyModal] = useState(false)
  const [showBtcSellModal, setShowBtcSellModal] = useState(false)

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
      setDividendBuyDone(thisMonth.some((b) => b.isDividendBuy === true))
    }, (err) => {
      console.error('Buys listener error:', err)
    })
    return () => unsub()
  }, [currentMonthStr])

  // ── BTC listeners ─────────────────────────────────────────────────────────────

  // Latest BTC signal: query btc_signals ordered by timestamp desc, take 1
  useEffect(() => {
    const q = query(collection(db, 'btc_signals'), orderBy('timestamp', 'desc'), limit(1))
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setBtcSignal({ id: snap.docs[0].id, ...snap.docs[0].data() })
      } else {
        setBtcSignal(null)
      }
      setBtcLoading(false)
    }, (err) => {
      console.error('BTC signal listener error:', err)
      setBtcLoading(false)
    })
    return () => unsub()
  }, [])

  // BTC position
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'btc_position', 'current'), (snap) => {
      if (snap.exists()) setBtcPosition(snap.data())
      else setBtcPosition(null)
    }, (err) => {
      console.error('BTC position listener error:', err)
    })
    return () => unsub()
  }, [])

  // BTC buys: buy log + monthly spend
  useEffect(() => {
    const q = query(collection(db, 'btc_buys'), orderBy('timestamp', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setBtcBuys(docs)
      const thisMonth = docs.filter((b) => b.monthYear === currentMonthStr)
      const spent = thisMonth.reduce((sum, b) => sum + (b.amountPhp || 0), 0)
      setBtcMonthlySpentPhp(spent)
    }, (err) => {
      console.error('BTC buys listener error:', err)
    })
    return () => unsub()
  }, [currentMonthStr])

  // BTC sells
  useEffect(() => {
    const q = query(collection(db, 'btc_sells'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setBtcSells(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    }, (err) => {
      console.error('BTC sells listener error:', err)
    })
    return () => unsub()
  }, [])

  // ── MGPIFF listeners ──────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'mgpiff_signals', todayStr), (snap) => {
      setMgpiffSignal(snap.exists() ? { id: snap.id, ...snap.data() } : null)
      setMgpiffLoading(false)
    }, () => setMgpiffLoading(false))
    return () => unsub()
  }, [todayStr])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'mgpiff_position', 'current'), (snap) => {
      setMgpiffPosition(snap.exists() ? snap.data() : null)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'mgpiff_navpu_history'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setMgpiffNavHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'mgpiff_buys'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setMgpiffBuys(data)
      const thisMonth = data.filter((b) => b.monthYear === currentMonthStr)
      const oppBuys = thisMonth.filter((b) => !b.isDividendBuy && b.bucket !== 'extreme_override')
      const staggerSeen = new Set()
      let oppCount = 0
      for (const buy of oppBuys) {
        if (buy.staggerEventDate) {
          if (!staggerSeen.has(buy.staggerEventDate)) { staggerSeen.add(buy.staggerEventDate); oppCount++ }
        } else { oppCount++ }
      }
      setMgpiffMonthlyBuyCount(oppCount)
      setMgpiffDividendBuyDone(thisMonth.some((b) => b.isDividendBuy === true))
    })
    return () => unsub()
  }, [currentMonthStr])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'mgpiff_config', 'thresholds'), (snap) => {
      if (snap.exists()) setMgpiffThresholds(snap.data())
    })
    return () => unsub()
  }, [])

  // ── Dividend listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'dividends'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setAlfmDividends(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'mgpiff_dividends'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setMgpiffDividends(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  // ── BPI Bond listeners ────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bpibond_signals', todayStr), (snap) => {
      setBpibondSignal(snap.exists() ? { id: snap.id, ...snap.data() } : null)
      setBpibondLoading(false)
    }, () => setBpibondLoading(false))
    return () => unsub()
  }, [todayStr])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bpibond_position', 'current'), (snap) => {
      setBpibondPosition(snap.exists() ? snap.data() : null)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'bpibond_navpu_history'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setBpibondNavHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'bpibond_buys'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setBpibondBuys(data)
      const thisMonth = data.filter((b) => b.monthYear === currentMonthStr)
      const oppBuys = thisMonth.filter((b) => !b.isDividendBuy && !b.isRspBuy && b.bucket !== 'extreme_override')
      const staggerSeen = new Set()
      let oppCount = 0
      for (const buy of oppBuys) {
        if (buy.staggerEventDate) {
          if (!staggerSeen.has(buy.staggerEventDate)) { staggerSeen.add(buy.staggerEventDate); oppCount++ }
        } else { oppCount++ }
      }
      setBpibondMonthlyBuyCount(oppCount)
      setBpibondDividendBuyDone(thisMonth.some((b) => b.isDividendBuy === true))
      setBpibondRspBuyDone(thisMonth.some((b) => b.isRspBuy === true))
    })
    return () => unsub()
  }, [currentMonthStr])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bpibond_config', 'thresholds'), (snap) => {
      if (snap.exists()) setBpibondThresholds(snap.data())
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'bpibond_dividends'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setBpibondDividends(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  // ── MREIT listeners ──────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'mreit_signals', todayStr), (snap) => {
      setMreitSignal(snap.exists() ? { id: snap.id, ...snap.data() } : null)
      setMreitLoading(false)
    }, () => setMreitLoading(false))
    return () => unsub()
  }, [todayStr])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'mreit_position', 'current'), (snap) => {
      setMreitPosition(snap.exists() ? snap.data() : null)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'mreit_navpu_history'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setMreitNavHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'mreit_buys'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setMreitBuys(data)
      const thisMonth = data.filter((b) => b.monthYear === currentMonthStr)
      const oppBuys = thisMonth.filter((b) => !b.isDividendBuy && b.bucket !== 'extreme_override')
      const staggerSeen = new Set()
      let oppCount = 0
      for (const buy of oppBuys) {
        if (buy.staggerEventDate) {
          if (!staggerSeen.has(buy.staggerEventDate)) { staggerSeen.add(buy.staggerEventDate); oppCount++ }
        } else { oppCount++ }
      }
      setMreitMonthlyBuyCount(oppCount)
      setMreitDividendBuyDone(thisMonth.some((b) => b.isDividendBuy === true))
    })
    return () => unsub()
  }, [currentMonthStr])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'mreit_config', 'thresholds'), (snap) => {
      if (snap.exists()) setMreitThresholds(snap.data())
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'mreit_dividends'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setMreitDividends(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

  // Use most recent available NAVPU (published with 1-day lag, stored under effective date)
  // Filter out null-navpu docs written by failed scrape runs so they don't poison the latest value
  const sortedHistory = [...navHistory].filter((n) => n.navpu != null).sort((a, b) => a.date.localeCompare(b.date))
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-neutral-500 text-sm animate-pulse">Loading...</div>
      </div>
    )
  }

  // Current BTC price from the latest signal (used in BtcPositionCard live calc)
  const btcCurrentPrice = btcSignal?.currentPrice ?? null

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#0a0a0a] border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <h1 className="text-sm font-semibold text-neutral-100 tracking-tight">
              Investment Tracker
            </h1>
            <div className="text-right hidden sm:block">
              <p className="text-neutral-400 text-xs font-mono">{todayStr}</p>
            </div>
          </div>
          {/* Tab navigation */}
          <nav className="flex gap-1 -mb-px overflow-x-auto scrollbar-hide">
            {[
              { key: 'overview', label: 'Overview', color: 'neutral', fullName: null },
              { key: 'alfm', label: 'ALFMGMP', color: 'emerald', signal: todaySignal?.isActionable, fullName: 'ALFM Global Multi-Asset Income Fund' },
              { key: 'mgpiff', label: 'MGPIFF', color: 'blue', signal: mgpiffSignal?.isActionable, fullName: 'Manulife Global Preferred Income Fund Feeder Fund' },
              { key: 'bpibond', label: 'BPIGBIF', color: 'violet', signal: bpibondSignal?.isActionable, fullName: 'BPI Global Bond Income Fund Class P (PHP Class)' },
              { key: 'mreit', label: 'MREIT', color: 'amber', signal: mreitSignal?.isActionable, fullName: 'Manulife Global REIT Feeder Fund PhP-Unhedged' },
              { key: 'btc', label: 'BTC', color: 'orange', signal: btcSignal?.isActionable, fullName: 'Bitcoin' },
            ].map(({ key, label, color, signal, fullName }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`relative px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === key
                    ? 'text-neutral-100 border-b-2 border-neutral-100'
                    : 'text-neutral-500 hover:text-neutral-300 border-b-2 border-transparent'
                }`}
                title={fullName || label}
              >
                {label}
                {signal && activeTab !== key && (
                  <span className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-${color}-400 animate-pulse`} />
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Fund name subtitle */}
      {activeTab !== 'overview' && (() => {
        const FUND_NAMES = {
          alfm: 'ALFM Global Multi-Asset Income Fund',
          mgpiff: 'Manulife Global Preferred Income Fund Feeder Fund',
          bpibond: 'BPI Global Bond Income Fund Class P (PHP Class)',
          mreit: 'Manulife Global REIT Feeder Fund PhP-Unhedged',
          btc: 'Bitcoin',
        }
        return FUND_NAMES[activeTab] ? (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-0">
            <p className="text-slate-500 text-xs">{FUND_NAMES[activeTab]}</p>
          </div>
        ) : null
      })()}

      {/* ── Overview Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <PortfolioDashboard
            alfmPosition={position}
            alfmNavpu={todayNavpu}
            mgpiffPosition={mgpiffPosition}
            mgpiffNavpu={mgpiffNavHistory.length > 0 ? mgpiffNavHistory.filter(n => n.navpu != null).at(-1)?.navpu : null}
            bpibondPosition={bpibondPosition}
            bpibondNavpu={bpibondNavHistory.length > 0 ? bpibondNavHistory.filter(n => n.navpu != null).at(-1)?.navpu : null}
            mreitPosition={mreitPosition}
            mreitNavpu={mreitNavHistory.length > 0 ? mreitNavHistory.filter(n => n.navpu != null).at(-1)?.navpu : null}
            btcPosition={btcPosition}
            btcCurrentPrice={btcCurrentPrice}
            btcSignal={btcSignal}
            btcPhpPerUsd={btcSignal?.phpPerUsd ?? 57.5}
            todaySignal={todaySignal}
            mgpiffSignal={mgpiffSignal}
            bpibondSignal={bpibondSignal}
            mreitSignal={mreitSignal}
            alfmDividends={alfmDividends}
            mgpiffDividends={mgpiffDividends}
            bpibondDividends={bpibondDividends}
            mreitDividends={mreitDividends}
            onNavigate={setActiveTab}
          />
        </main>
      )}

      {/* ── ALFM Tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'alfm' && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          <SignalCard
            signal={todaySignal}
            todayNavpu={todayNavpu}
            dailyChange={dailyChange}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <PositionCard
              position={position}
              todayNavpu={todayNavpu}
              monthlyBuyCount={monthlyBuyCount}
              dividendBuyDone={dividendBuyDone}
            />
            <NavpuCard
              todayNavpu={todayNavpu}
              navDate={latestNavEntry?.date}
              dailyChange={dailyChange}
              navHigh={navHigh}
              navLow={navLow}
              navMean={navMean}
              thresholds={thresholds}
            />
            <DividendCard todayStr={todayStr} buys={buys} />
          </div>
          <NavChart navHistory={last90} buys={buys} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BuyLog buys={buys} fund="alfm" />
            <BacktestCard />
          </div>
        </main>
      )}

      {/* ── BTC Tab ───────────────────────────────────────────────────────────── */}
      {activeTab === 'btc' && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {btcLoading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-slate-400 animate-pulse">Loading BTC signals...</p>
            </div>
          ) : (
            <>
              {/* Row 1: Signal card (full width) */}
              <BtcSignalCard signal={btcSignal} />

              {/* Row 2: Position card */}
              <BtcPositionCard
                position={btcPosition}
                currentPriceUsd={btcCurrentPrice}
                monthlySpentPhp={btcMonthlySpentPhp}
                phpPerUsd={btcSignal?.phpPerUsd ?? 57.5}
                totalRealizedPnlPhp={btcSells.reduce((sum, s) => sum + (s.realizedPnlPhp || 0), 0)}
              />

              {/* Row 3: Price chart */}
              <BtcPriceChart
                btcBuys={btcBuys}
                thresholds={btcSignal?.thresholds ?? null}
                avgCost={btcPosition?.avgCost ?? null}
                phpPerUsd={btcSignal?.phpPerUsd ?? null}
              />

              {/* Row 4: Buy log + Sell log */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BtcBuyLog buys={btcBuys} phpPerUsd={btcSignal?.phpPerUsd ?? null} />
                <BtcSellLog sells={btcSells} phpPerUsd={btcSignal?.phpPerUsd ?? null} />
              </div>

              {/* Row 5: Backtest */}
              <BtcBacktestCard />
            </>
          )}
        </main>
      )}

      {/* ── MGPIFF Tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'mgpiff' && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {mgpiffLoading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-slate-400 animate-pulse">Loading MGPIFF signals...</p>
            </div>
          ) : (
            <>
              <SignalCard
                signal={mgpiffSignal}
                todayNavpu={mgpiffNavHistory.length > 0 ? mgpiffNavHistory[mgpiffNavHistory.length - 1]?.navpu : null}
                dailyChange={mgpiffSignal?.dailyChange ?? null}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PositionCard
                  position={mgpiffPosition}
                  todayNavpu={mgpiffNavHistory.length > 0 ? mgpiffNavHistory[mgpiffNavHistory.length - 1]?.navpu : null}
                  monthlyBuyCount={mgpiffMonthlyBuyCount}
                  dividendBuyDone={mgpiffDividendBuyDone}
                />
                <NavpuCard
                  todayNavpu={mgpiffNavHistory.length > 0 ? mgpiffNavHistory[mgpiffNavHistory.length - 1]?.navpu : null}
                  navDate={mgpiffNavHistory.length > 0 ? mgpiffNavHistory[mgpiffNavHistory.length - 1]?.date : null}
                  dailyChange={mgpiffSignal?.dailyChange ?? null}
                  navHigh={mgpiffNavHistory.length > 0 ? Math.max(...mgpiffNavHistory.slice(-90).map(n => n.navpu).filter(Boolean)) : null}
                  navLow={mgpiffNavHistory.length > 0 ? Math.min(...mgpiffNavHistory.slice(-90).map(n => n.navpu).filter(Boolean)) : null}
                  navMean={mgpiffNavHistory.length > 0 ? parseFloat((mgpiffNavHistory.slice(-90).map(n => n.navpu).filter(Boolean).reduce((a, b) => a + b, 0) / mgpiffNavHistory.slice(-90).filter(n => n.navpu).length).toFixed(4)) : null}
                  thresholds={mgpiffThresholds}
                />
                <MgpiffDividendCard
                  todayStr={todayStr}
                  buys={mgpiffBuys}
                  currentNavpu={mgpiffNavHistory.length > 0 ? mgpiffNavHistory[mgpiffNavHistory.length - 1]?.navpu : null}
                />
              </div>
              <NavChart navHistory={mgpiffNavHistory.slice(-90)} buys={mgpiffBuys} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BuyLog buys={mgpiffBuys} fund="mgpiff" />
                <BacktestCard
                  summaryCollection="mgpiff_config"
                  summaryDoc="backtest_summary"
                  resultsCollection="mgpiff_backtest_results"
                />
              </div>
            </>
          )}
        </main>
      )}

      {/* ── BPI Bond Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'bpibond' && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {bpibondLoading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-slate-400 animate-pulse">Loading BPI Bond signals...</p>
            </div>
          ) : (
            <>
              <SignalCard
                signal={bpibondSignal}
                todayNavpu={bpibondNavHistory.length > 0 ? bpibondNavHistory[bpibondNavHistory.length - 1]?.navpu : null}
                dailyChange={bpibondSignal?.dailyChange ?? null}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PositionCard
                  position={bpibondPosition}
                  todayNavpu={bpibondNavHistory.length > 0 ? bpibondNavHistory[bpibondNavHistory.length - 1]?.navpu : null}
                  monthlyBuyCount={bpibondMonthlyBuyCount}
                  dividendBuyDone={bpibondDividendBuyDone}
                  rspBuyDone={bpibondRspBuyDone}
                />
                <NavpuCard
                  todayNavpu={bpibondNavHistory.length > 0 ? bpibondNavHistory[bpibondNavHistory.length - 1]?.navpu : null}
                  navDate={bpibondNavHistory.length > 0 ? bpibondNavHistory[bpibondNavHistory.length - 1]?.date : null}
                  dailyChange={bpibondSignal?.dailyChange ?? null}
                  navHigh={bpibondNavHistory.length > 0 ? Math.max(...bpibondNavHistory.slice(-90).map(n => n.navpu).filter(Boolean)) : null}
                  navLow={bpibondNavHistory.length > 0 ? Math.min(...bpibondNavHistory.slice(-90).map(n => n.navpu).filter(Boolean)) : null}
                  navMean={bpibondNavHistory.length > 0 ? parseFloat((bpibondNavHistory.slice(-90).map(n => n.navpu).filter(Boolean).reduce((a, b) => a + b, 0) / bpibondNavHistory.slice(-90).filter(n => n.navpu).length).toFixed(4)) : null}
                  thresholds={bpibondThresholds}
                />
                <BpibondDividendCard
                  todayStr={todayStr}
                  buys={bpibondBuys}
                />
              </div>
              <NavChart navHistory={bpibondNavHistory.slice(-90)} buys={bpibondBuys} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BuyLog buys={bpibondBuys} fund="bpibond" />
                <BacktestCard
                  summaryCollection="bpibond_config"
                  summaryDoc="backtest_summary"
                  resultsCollection="bpibond_backtest_results"
                />
              </div>
            </>
          )}
        </main>
      )}

      {/* ── MREIT Tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'mreit' && (
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {mreitLoading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-slate-400 animate-pulse">Loading MREIT signals...</p>
            </div>
          ) : (
            <>
              <SignalCard
                signal={mreitSignal}
                todayNavpu={mreitNavHistory.length > 0 ? mreitNavHistory[mreitNavHistory.length - 1]?.navpu : null}
                dailyChange={mreitSignal?.dailyChange ?? null}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <PositionCard
                  position={mreitPosition}
                  todayNavpu={mreitNavHistory.length > 0 ? mreitNavHistory[mreitNavHistory.length - 1]?.navpu : null}
                  monthlyBuyCount={mreitMonthlyBuyCount}
                  dividendBuyDone={mreitDividendBuyDone}
                />
                <NavpuCard
                  todayNavpu={mreitNavHistory.length > 0 ? mreitNavHistory[mreitNavHistory.length - 1]?.navpu : null}
                  navDate={mreitNavHistory.length > 0 ? mreitNavHistory[mreitNavHistory.length - 1]?.date : null}
                  dailyChange={mreitSignal?.dailyChange ?? null}
                  navHigh={mreitNavHistory.length > 0 ? Math.max(...mreitNavHistory.slice(-90).map(n => n.navpu).filter(Boolean)) : null}
                  navLow={mreitNavHistory.length > 0 ? Math.min(...mreitNavHistory.slice(-90).map(n => n.navpu).filter(Boolean)) : null}
                  navMean={mreitNavHistory.length > 0 ? parseFloat((mreitNavHistory.slice(-90).map(n => n.navpu).filter(Boolean).reduce((a, b) => a + b, 0) / mreitNavHistory.slice(-90).filter(n => n.navpu).length).toFixed(4)) : null}
                  thresholds={mreitThresholds}
                />
                <MreitDividendCard
                  todayStr={todayStr}
                  buys={mreitBuys}
                  currentNavpu={mreitNavHistory.length > 0 ? mreitNavHistory[mreitNavHistory.length - 1]?.navpu : null}
                />
              </div>
              <NavChart navHistory={mreitNavHistory.slice(-90)} buys={mreitBuys} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BuyLog buys={mreitBuys} fund="mreit" />
                <BacktestCard
                  summaryCollection="mreit_config"
                  summaryDoc="backtest_summary"
                  resultsCollection="mreit_backtest_results"
                />
              </div>
            </>
          )}
        </main>
      )}

      {/* Floating Buy Button — ALFM tab */}
      {activeTab === 'alfm' && (
        <button
          onClick={() => setShowBuyModal(true)}
          className="fixed bottom-6 right-6 bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-5 py-3 rounded-lg transition-colors flex items-center gap-2 z-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          I Bought
        </button>
      )}

      {/* Floating Buttons — BTC tab */}
      {activeTab === 'btc' && (
        <div className="fixed bottom-6 right-6 flex gap-2 z-40">
          <button
            onClick={() => setShowBtcSellModal(true)}
            className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium px-4 py-3 rounded-lg border border-neutral-700 transition-colors flex items-center gap-2"
          >
            <span className="text-lg leading-none">₿</span>
            I Sold
          </button>
          <button
            onClick={() => setShowBtcBuyModal(true)}
            className="bg-orange-600 hover:bg-orange-500 text-white font-medium px-4 py-3 rounded-lg transition-colors flex items-center gap-2"
          >
            <span className="text-lg leading-none">₿</span>
            I Bought
          </button>
        </div>
      )}

      {/* Floating Buy Button — MGPIFF tab */}
      {activeTab === 'mgpiff' && (
        <button
          onClick={() => setShowMgpiffBuyModal(true)}
          className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-3 rounded-lg transition-colors flex items-center gap-2 z-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          I Bought
        </button>
      )}

      {/* Floating Buy Button — BPI Bond tab */}
      {activeTab === 'bpibond' && (
        <button
          onClick={() => setShowBpibondBuyModal(true)}
          className="fixed bottom-6 right-6 bg-violet-600 hover:bg-violet-500 text-white font-medium px-5 py-3 rounded-lg transition-colors flex items-center gap-2 z-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          I Bought
        </button>
      )}

      {/* Floating Buy Button — MREIT tab */}
      {activeTab === 'mreit' && (
        <button
          onClick={() => setShowMreitBuyModal(true)}
          className="fixed bottom-6 right-6 bg-amber-600 hover:bg-amber-500 text-white font-medium px-5 py-3 rounded-lg transition-colors flex items-center gap-2 z-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          I Bought
        </button>
      )}

      {/* ALFM Buy Modal */}
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

      {/* BTC Buy Modal */}
      {showBtcBuyModal && (
        <BtcBuyModal
          onClose={() => setShowBtcBuyModal(false)}
          btcSignal={btcSignal}
          btcPosition={btcPosition}
          currentMonthStr={currentMonthStr}
        />
      )}

      {/* BTC Sell Modal */}
      {showBtcSellModal && (
        <BtcSellModal
          onClose={() => setShowBtcSellModal(false)}
          btcPosition={btcPosition}
          currentPriceUsd={btcCurrentPrice}
        />
      )}

      {/* MGPIFF Buy Modal */}
      {showMgpiffBuyModal && (
        <MgpiffBuyModal
          onClose={() => setShowMgpiffBuyModal(false)}
          todaySignal={mgpiffSignal}
          todayNavpu={mgpiffNavHistory.length > 0 ? mgpiffNavHistory[mgpiffNavHistory.length - 1]?.navpu : null}
          position={mgpiffPosition}
          todayStr={todayStr}
          currentMonthStr={currentMonthStr}
        />
      )}

      {/* BPI Bond Buy Modal */}
      {showBpibondBuyModal && (
        <BpibondBuyModal
          onClose={() => setShowBpibondBuyModal(false)}
          todaySignal={bpibondSignal}
          todayNavpu={bpibondNavHistory.length > 0 ? bpibondNavHistory[bpibondNavHistory.length - 1]?.navpu : null}
          position={bpibondPosition}
          todayStr={todayStr}
          currentMonthStr={currentMonthStr}
        />
      )}

      {/* MREIT Buy Modal */}
      {showMreitBuyModal && (
        <MreitBuyModal
          onClose={() => setShowMreitBuyModal(false)}
          todaySignal={mreitSignal}
          todayNavpu={mreitNavHistory.length > 0 ? mreitNavHistory[mreitNavHistory.length - 1]?.navpu : null}
          position={mreitPosition}
          todayStr={todayStr}
          currentMonthStr={currentMonthStr}
        />
      )}

    </div>
  )
}

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
import BtcSellModal from './components/BtcSellModal'
import BtcBacktestCard from './components/BtcBacktestCard'
import BtcBuyLog from './components/BtcBuyLog'
import BtcPriceChart from './components/BtcPriceChart'
import MgpiffDividendCard from './components/MgpiffDividendCard'
import MgpiffBuyModal from './components/MgpiffBuyModal'

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
  const [activeTab, setActiveTab] = useState('alfm')  // 'alfm' | 'btc' | 'mgpiff'

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

  // ── BTC state ────────────────────────────────────────────────────────────────
  const [btcSignal, setBtcSignal] = useState(null)
  const [btcPosition, setBtcPosition] = useState(null)
  const [btcMonthlySpentPhp, setBtcMonthlySpentPhp] = useState(0)
  const [btcBuys, setBtcBuys] = useState([])
  const [btcTrades, setBtcTrades] = useState([])
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

  // BTC completed trades
  useEffect(() => {
    const q = query(collection(db, 'btc_trades'), orderBy('exitTimestamp', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setBtcTrades(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 text-lg animate-pulse">Loading Investment Tracker...</div>
      </div>
    )
  }

  // Current BTC price from the latest signal (used in BtcPositionCard live calc)
  const btcCurrentPrice = btcSignal?.currentPrice ?? null

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Investment Tracker
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {activeTab === 'alfm'
                ? 'ALFM Global Multi-Asset Income Fund (PHP)'
                : activeTab === 'mgpiff'
                ? 'Manulife Global Preferred Income Feeder Fund'
                : 'Bitcoin — Hourly DCA Signal Engine'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Tab switcher */}
            <div className="flex bg-slate-700/60 rounded-lg p-1 gap-1">
              <button
                onClick={() => setActiveTab('alfm')}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${
                  activeTab === 'alfm'
                    ? 'bg-slate-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ALFMGMP
              </button>
              <button
                onClick={() => setActiveTab('mgpiff')}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'mgpiff'
                    ? 'bg-blue-700 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                MGPIFF
                {mgpiffSignal?.isActionable && activeTab !== 'mgpiff' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                )}
              </button>
              <button
                onClick={() => setActiveTab('btc')}
                className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'btc'
                    ? 'bg-orange-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ₿ BTC
                {btcSignal?.isActionable && activeTab !== 'btc' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                )}
              </button>
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-slate-300 font-medium">{todayStr}</p>
              <p className="text-slate-500 text-xs">Asia/Manila</p>
            </div>
          </div>
        </div>
      </header>

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
            <BuyLog buys={buys} />
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

              {/* Row 2: Position card + entry scanner */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <BtcPositionCard
                  position={btcPosition}
                  currentPriceUsd={btcCurrentPrice}
                  monthlySpentPhp={btcMonthlySpentPhp}
                  btcTrades={btcTrades}
                />

                {/* Entry Scanner */}
                <div className="card md:col-span-2">
                  <p className="label mb-4">Entry Scanner — Swing Trade</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {(() => {
                      const s = btcSignal
                      const change24h = s?.change24hPct ?? null
                      const rsi       = s?.rsi ?? null
                      const vol       = s?.volumeRatio ?? null
                      const macro     = s?.macroMode ?? 'NORMAL'
                      const change7d  = s?.change7dPct ?? null

                      const drop24hOk = change24h != null && change24h <= -3 && change24h >= -8
                      const rsiOk     = rsi != null && rsi < 35
                      const volOk     = vol != null && vol >= 1.2
                      const macroOk   = macro === 'NORMAL' || macro === 'REDUCED'

                      const conditions = [
                        {
                          label: '24h Drop',
                          value: change24h != null ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%` : '—',
                          ok: drop24hOk,
                          hint: drop24hOk ? 'In entry window' : change24h != null && change24h > -3 ? 'Need ≤ -3%' : 'Too extreme (>-8%)',
                        },
                        {
                          label: 'RSI (1h)',
                          value: rsi != null ? rsi.toFixed(1) : '—',
                          ok: rsiOk,
                          hint: rsiOk ? 'Oversold ✓' : `Need < 35`,
                        },
                        {
                          label: 'Volume',
                          value: vol != null ? `${vol.toFixed(2)}×` : '—',
                          ok: volOk,
                          hint: volOk ? 'Confirmed ✓' : 'Need ≥ 1.2×',
                        },
                        {
                          label: '7d Change',
                          value: change7d != null ? `${change7d >= 0 ? '+' : ''}${change7d.toFixed(1)}%` : '—',
                          ok: change7d == null || change7d > -10,
                          hint: change7d != null && change7d <= -10 ? 'Kill switch active' : 'No flush',
                        },
                        {
                          label: 'Macro',
                          value: macro,
                          ok: macroOk,
                          hint: macro === 'PAUSED' ? 'Entries paused' : macro === 'REDUCED' ? '50% size' : 'Full size',
                        },
                        {
                          label: 'BTC Price',
                          value: s?.currentPrice ? `$${Number(s.currentPrice).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—',
                          ok: null,
                          hint: 'Current',
                        },
                      ]

                      return conditions.map(({ label, value, ok, hint }) => (
                        <div key={label} className={`rounded-lg p-3 border ${ok === true ? 'bg-emerald-900/20 border-emerald-800' : ok === false ? 'bg-slate-700/40 border-slate-600' : 'bg-slate-700/40 border-slate-600'}`}>
                          <p className="label text-xs mb-1">{label}</p>
                          <p className={`font-bold text-sm ${ok === true ? 'text-emerald-400' : ok === false ? 'text-slate-300' : 'text-white'}`}>
                            {value}
                          </p>
                          <p className={`text-xs mt-0.5 ${ok === true ? 'text-emerald-600' : 'text-slate-600'}`}>{hint}</p>
                        </div>
                      ))
                    })()}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <p className="text-slate-600 text-xs">
                      Entry fires when: 24h drop -3% to -8% <span className="text-slate-700">·</span> RSI &lt; 35 <span className="text-slate-700">·</span> green/small candle <span className="text-slate-700">·</span> volume ≥ 1.2× <span className="text-slate-700">·</span> ≤ 2% off 24h low
                    </p>
                  </div>
                </div>
              </div>

              {/* Row 3: Price chart */}
              <BtcPriceChart
                btcBuys={btcBuys}
                thresholds={btcSignal?.thresholds ?? null}
                avgCost={btcPosition?.avgCost ?? null}
              />

              {/* Row 4: Buy log + backtest */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BtcBuyLog buys={btcBuys} />
                <BtcBacktestCard />
              </div>
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
                <BuyLog buys={mgpiffBuys} />
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

      {/* Floating Buy Button — ALFM tab */}
      {activeTab === 'alfm' && (
        <button
          onClick={() => setShowBuyModal(true)}
          className="fixed bottom-8 right-8 bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-6 py-4 rounded-full shadow-2xl shadow-emerald-900/50 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2 z-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          I Bought
        </button>
      )}

      {/* Floating buttons — BTC tab */}
      {activeTab === 'btc' && (
        <div className="fixed bottom-8 right-8 flex flex-col gap-3 z-40">
          {(btcPosition?.state === 'BUILDING' || btcPosition?.state === 'FULL') ? (
            <button
              onClick={() => setShowBtcSellModal(true)}
              className="bg-green-600 hover:bg-green-500 text-white font-bold px-6 py-4 rounded-full shadow-2xl shadow-green-900/50 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <span className="text-lg leading-none">₿</span>
              I Sold
            </button>
          ) : (
            <button
              onClick={() => setShowBtcBuyModal(true)}
              className="bg-orange-500 hover:bg-orange-400 text-white font-bold px-6 py-4 rounded-full shadow-2xl shadow-orange-900/50 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <span className="text-lg leading-none">₿</span>
              I Bought
            </button>
          )}
        </div>
      )}

      {/* Floating Buy Button — MGPIFF tab */}
      {activeTab === 'mgpiff' && (
        <button
          onClick={() => setShowMgpiffBuyModal(true)}
          className="fixed bottom-8 right-8 bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-4 rounded-full shadow-2xl shadow-blue-900/50 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-2 z-40"
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

      {/* BTC Sell Modal */}
      {showBtcSellModal && (
        <BtcSellModal
          onClose={() => setShowBtcSellModal(false)}
          btcPosition={btcPosition}
          currentPriceUsd={btcCurrentPrice}
        />
      )}
    </div>
  )
}

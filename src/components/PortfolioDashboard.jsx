import React from 'react'

function fmtPeso(n, decimals = 2) {
  if (n === null || n === undefined) return '—'
  return '₱' + Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtPct(n) {
  if (n === null || n === undefined) return '—'
  return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'
}

const SIGNAL_COLORS = {
  BUY:           { text: 'text-blue-300',    bg: 'bg-blue-900/50',    border: 'border-blue-700' },
  BUY_MORE:      { text: 'text-green-300',   bg: 'bg-green-900/50',   border: 'border-green-700' },
  AGGRESSIVE:    { text: 'text-emerald-300', bg: 'bg-emerald-900/50', border: 'border-emerald-600' },
  PRIORITY_BUY:  { text: 'text-emerald-200', bg: 'bg-emerald-900/70', border: 'border-emerald-400' },
  WATCH:         { text: 'text-yellow-300',  bg: 'bg-yellow-900/40',  border: 'border-yellow-700' },
  WATCH_SKIP:    { text: 'text-yellow-400',  bg: 'bg-yellow-900/30',  border: 'border-yellow-800' },
  NO_BUY:        { text: 'text-slate-300',   bg: 'bg-neutral-800/50', border: 'border-neutral-800' },
  NO_SECOND_BUY: { text: 'text-orange-300',  bg: 'bg-orange-900/40',  border: 'border-orange-700' },
  MONTHLY_CAP:   { text: 'text-red-300',     bg: 'bg-red-900/40',     border: 'border-red-700' },
  OPP_LOCKED:    { text: 'text-slate-400',   bg: 'bg-neutral-800/50', border: 'border-neutral-800' },
  OPP_GAP_WAIT:  { text: 'text-slate-400',   bg: 'bg-neutral-800/50', border: 'border-neutral-800' },
}

const SIGNAL_LABEL = {
  BUY: 'BUY', BUY_MORE: 'BUY MORE', AGGRESSIVE: 'AGGRESSIVE',
  PRIORITY_BUY: 'PRIORITY BUY', WATCH: 'WATCH', WATCH_SKIP: 'WATCH / SKIP',
  NO_BUY: 'NO BUY', NO_SECOND_BUY: 'NO 2ND BUY', MONTHLY_CAP: 'MONTHLY CAP',
  OPP_LOCKED: 'LOCKED', OPP_GAP_WAIT: 'GAP WAIT',
}

const FUND_COLORS = {
  ALFMGMP:  '#10b981',
  MGPIFF:   '#3b82f6',
  BPIBGIF:  '#8b5cf6',
  MREIT:    '#f59e0b',
  ATRAM:    '#06b6d4',
  BTC:      '#f97316',
}

function SignalBadge({ signal, isBtc }) {
  if (!signal) return <span className="text-xs text-slate-600 px-2 py-0.5 rounded border border-neutral-800 bg-neutral-900">—</span>
  if (isBtc) {
    const isActionable = signal.isActionable
    const label = signal.action || (isActionable ? 'ENTRY' : 'SCANNING')
    return (
      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${
        isActionable ? 'bg-orange-900/50 text-orange-300 border-orange-700' : 'bg-neutral-800/50 text-slate-400 border-neutral-800'
      }`}>{label}</span>
    )
  }
  const key = signal.signal || 'NO_BUY'
  const c = SIGNAL_COLORS[key] || SIGNAL_COLORS.NO_BUY
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${c.bg} ${c.text} ${c.border}`}>
      {SIGNAL_LABEL[key] || key.replace(/_/g, ' ')}
    </span>
  )
}

function lastBizDayOfMonth(year, month) {
  let day = new Date(year, month + 1, 0).getDate()
  while (true) {
    const dow = new Date(year, month, day).getDay()
    if (dow !== 0 && dow !== 6) break
    day--
  }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function nthTradingDayOfMonth(year, month, n) {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month, day)
    if (d.getMonth() !== month) break
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      count++
      if (count === n) return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  return null
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
}

function processDividends(rawDivs, todayStr) {
  const divs = rawDivs.map((r) => ({ ...r, date: r.date || r.id }))
  const past = divs.filter((r) => r.date <= todayStr && (r.divPerUnit || r.earned))
  const totalEarned = past.reduce((sum, r) => sum + (r.earned || (r.units || 0) * (r.divPerUnit || 0)), 0)
  const lastDiv = past.length > 0 ? past[past.length - 1] : null
  const recent = past.slice(-3)
  const estMonthly = recent.length > 0
    ? recent.reduce((sum, r) => sum + (r.earned || (r.units || 0) * (r.divPerUnit || 0)), 0) / recent.length
    : 0
  return { totalEarned, months: past.length, lastDiv, estMonthly }
}

export default function PortfolioDashboard({
  alfmPosition, alfmNavpu,
  mgpiffPosition, mgpiffNavpu,
  bpibondPosition, bpibondNavpu,
  mreitPosition, mreitNavpu,
  atramPosition, atramNavpu,
  btcPosition, btcCurrentPrice, btcSignal, btcPhpPerUsd = 57.5,
  todaySignal, mgpiffSignal, bpibondSignal, mreitSignal, atramSignal,
  alfmDividends = [],
  mgpiffDividends = [],
  bpibondDividends = [],
  mreitDividends = [],
  atramDividends = [],
  onNavigate,
}) {
  const alfmCost  = alfmPosition?.totalCost ?? 0
  const alfmUnits = alfmPosition?.units ?? 0
  const alfmNav   = alfmNavpu ?? alfmPosition?.avgPrice ?? 0
  const alfmValue = alfmUnits > 0 ? alfmUnits * alfmNav : 0
  const alfmGain  = alfmValue - alfmCost
  const alfmGainPct = alfmCost > 0 ? (alfmGain / alfmCost) * 100 : null

  const mgpiffCost  = mgpiffPosition?.totalCost ?? 0
  const mgpiffUnits = mgpiffPosition?.units ?? 0
  const mgpiffNav   = mgpiffNavpu ?? mgpiffPosition?.avgPrice ?? 0
  const mgpiffValue = mgpiffUnits > 0 ? mgpiffUnits * mgpiffNav : 0
  const mgpiffGain  = mgpiffValue - mgpiffCost
  const mgpiffGainPct = mgpiffCost > 0 ? (mgpiffGain / mgpiffCost) * 100 : null

  const bpibondCost  = bpibondPosition?.totalCost ?? 0
  const bpibondUnits = bpibondPosition?.units ?? 0
  const bpibondNav   = bpibondNavpu ?? bpibondPosition?.avgPrice ?? 0
  const bpibondValue = bpibondUnits > 0 ? bpibondUnits * bpibondNav : 0
  const bpibondGain  = bpibondValue - bpibondCost
  const bpibondGainPct = bpibondCost > 0 ? (bpibondGain / bpibondCost) * 100 : null

  const mreitCost  = mreitPosition?.totalCost ?? 0
  const mreitUnits = mreitPosition?.units ?? 0
  const mreitNav   = mreitNavpu ?? mreitPosition?.avgPrice ?? 0
  const mreitValue = mreitUnits > 0 ? mreitUnits * mreitNav : 0
  const mreitGain  = mreitValue - mreitCost
  const mreitGainPct = mreitCost > 0 ? (mreitGain / mreitCost) * 100 : null

  const atramCost  = atramPosition?.totalCost ?? 0
  const atramUnits = atramPosition?.units ?? 0
  const atramNav   = atramNavpu ?? atramPosition?.avgPrice ?? 0
  const atramValue = atramUnits > 0 ? atramUnits * atramNav : 0
  const atramGain  = atramValue - atramCost
  const atramGainPct = atramCost > 0 ? (atramGain / atramCost) * 100 : null

  const btcUnits    = btcPosition?.units ?? 0
  const btcAvgCost  = btcPosition?.avgCost ?? 0
  const btcCostPhp  = btcPosition?.totalCostPhp ?? 0
  const btcPrice    = btcCurrentPrice ?? 0
  const btcValuePhp = btcUnits > 0 && btcPrice > 0 ? btcUnits * btcPrice * btcPhpPerUsd : 0
  const btcGainPhp  = btcValuePhp - btcCostPhp
  const btcGainPct  = btcCostPhp > 0 ? (btcGainPhp / btcCostPhp) * 100 : null

  const totalCost    = alfmCost + mgpiffCost + bpibondCost + mreitCost + atramCost + btcCostPhp
  const totalValue   = alfmValue + mgpiffValue + bpibondValue + mreitValue + atramValue + btcValuePhp
  const totalGain    = totalValue - totalCost
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : null
  const isTotalGain  = totalGain >= 0

  const todayStr = (() => {
    const now = new Date()
    const ph = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
    return ph.getFullYear() + '-' + String(ph.getMonth() + 1).padStart(2, '0') + '-' + String(ph.getDate()).padStart(2, '0')
  })()

  const alfmDivData    = processDividends(alfmDividends, todayStr)
  const mgpiffDivData  = processDividends(mgpiffDividends, todayStr)
  const bpibondDivData = processDividends(bpibondDividends, todayStr)
  const mreitDivData   = processDividends(mreitDividends, todayStr)
  const atramDivData   = processDividends(atramDividends, todayStr)
  const totalDividends = alfmDivData.totalEarned + mgpiffDivData.totalEarned + bpibondDivData.totalEarned + mreitDivData.totalEarned + atramDivData.totalEarned
  const totalEstMonthly = alfmDivData.estMonthly + mgpiffDivData.estMonthly + bpibondDivData.estMonthly + mreitDivData.estMonthly + atramDivData.estMonthly

  const now2 = new Date(todayStr + 'T00:00:00')
  const nextAlfmRecord   = lastBizDayOfMonth(now2.getFullYear(), now2.getMonth() + (todayStr > lastBizDayOfMonth(now2.getFullYear(), now2.getMonth()) ? 1 : 0))
  const nextMgpiffRecord = (() => {
    let y = now2.getFullYear(), m = now2.getMonth()
    for (let i = 0; i < 3; i++) {
      const d = nthTradingDayOfMonth(y, m + i, 7)
      if (d && d >= todayStr) return d
    }
    return null
  })()
  const nextBpibondRecord = lastBizDayOfMonth(now2.getFullYear(), now2.getMonth() + (todayStr > lastBizDayOfMonth(now2.getFullYear(), now2.getMonth()) ? 1 : 0))
  const nextMreitRecord = (() => {
    let y = now2.getFullYear(), m = now2.getMonth()
    for (let i = 0; i < 3; i++) {
      const d = nthTradingDayOfMonth(y, m + i, 7)
      if (d && d >= todayStr) return d
    }
    return null
  })()
  const nextAtramRecord = (() => {
    let y = now2.getFullYear(), m = now2.getMonth()
    for (let i = 0; i < 3; i++) {
      const d = nthTradingDayOfMonth(y, m + i, 7)
      if (d && d >= todayStr) return d
    }
    return null
  })()

  const allocationData = [
    { name: 'ALFMGMP', value: alfmValue,    color: FUND_COLORS.ALFMGMP },
    { name: 'MGPIFF',  value: mgpiffValue,  color: FUND_COLORS.MGPIFF },
    { name: 'BPIBGIF', value: bpibondValue, color: FUND_COLORS.BPIBGIF },
    { name: 'MREIT',   value: mreitValue,   color: FUND_COLORS.MREIT },
    { name: 'ATRAM',   value: atramValue,   color: FUND_COLORS.ATRAM },
    { name: 'BTC',     value: btcValuePhp,  color: FUND_COLORS.BTC },
  ].filter((d) => d.value > 0)

  const actionableSignals = [
    todaySignal?.isActionable && todaySignal,
    mgpiffSignal?.isActionable && mgpiffSignal,
    bpibondSignal?.isActionable && bpibondSignal,
    mreitSignal?.isActionable && mreitSignal,
    atramSignal?.isActionable && atramSignal,
    btcSignal?.isActionable && btcSignal,
  ].filter(Boolean)

  const totalRecommendedToday = [todaySignal, mgpiffSignal, bpibondSignal, mreitSignal, atramSignal, btcSignal].reduce((sum, s) => sum + (s?.amount || 0), 0)

  const funds = [
    { key: 'alfm',    code: 'ALFMGMP', color: FUND_COLORS.ALFMGMP, signal: todaySignal,   navpu: alfmNav,    cost: alfmCost,    value: alfmValue,    gain: alfmGain,    gainPct: alfmGainPct,    units: alfmUnits,    avgPrice: alfmPosition?.avgPrice,    divs: alfmDivData.totalEarned,    hasPosition: alfmUnits > 0 },
    { key: 'mgpiff',  code: 'MGPIFF',  color: FUND_COLORS.MGPIFF,  signal: mgpiffSignal,  navpu: mgpiffNav,  cost: mgpiffCost,  value: mgpiffValue,  gain: mgpiffGain,  gainPct: mgpiffGainPct,  units: mgpiffUnits,  avgPrice: mgpiffPosition?.avgPrice,  divs: mgpiffDivData.totalEarned,  hasPosition: mgpiffUnits > 0 },
    { key: 'bpibond', code: 'BPIBGIF', color: FUND_COLORS.BPIBGIF, signal: bpibondSignal, navpu: bpibondNav, cost: bpibondCost, value: bpibondValue, gain: bpibondGain, gainPct: bpibondGainPct, units: bpibondUnits, avgPrice: bpibondPosition?.avgPrice, divs: bpibondDivData.totalEarned, hasPosition: bpibondUnits > 0 },
    { key: 'mreit',   code: 'MREIT',   color: FUND_COLORS.MREIT,   signal: mreitSignal,   navpu: mreitNav,   cost: mreitCost,   value: mreitValue,   gain: mreitGain,   gainPct: mreitGainPct,   units: mreitUnits,   avgPrice: mreitPosition?.avgPrice,   divs: mreitDivData.totalEarned,   hasPosition: mreitUnits > 0 },
    { key: 'atram',   code: 'ATRAM',   color: FUND_COLORS.ATRAM,   signal: atramSignal,   navpu: atramNav,   cost: atramCost,   value: atramValue,   gain: atramGain,   gainPct: atramGainPct,   units: atramUnits,   avgPrice: atramPosition?.avgPrice,   divs: atramDivData.totalEarned,   hasPosition: atramUnits > 0 },
    { key: 'btc',     code: 'BTC',     color: FUND_COLORS.BTC,     signal: btcSignal,     navpu: null,       cost: btcCostPhp,  value: btcValuePhp,  gain: btcGainPhp,  gainPct: btcGainPct,     units: btcUnits,     avgPrice: null,                      divs: 0,                          hasPosition: btcUnits > 0,   isBtc: true },
  ]

  const divFunds = [
    { code: 'ALFMGMP', color: FUND_COLORS.ALFMGMP, data: alfmDivData, nextRecord: nextAlfmRecord, recordType: 'Last biz day', nav: 'alfm' },
    { code: 'MGPIFF',  color: FUND_COLORS.MGPIFF,  data: mgpiffDivData,  nextRecord: nextMgpiffRecord,  recordType: '7th trading day', nav: 'mgpiff' },
    { code: 'BPIBGIF', color: FUND_COLORS.BPIBGIF, data: bpibondDivData, nextRecord: nextBpibondRecord, recordType: 'Last biz day', nav: 'bpibond' },
    { code: 'MREIT',   color: FUND_COLORS.MREIT,   data: mreitDivData,   nextRecord: nextMreitRecord,   recordType: '7th trading day', nav: 'mreit' },
    { code: 'ATRAM',   color: FUND_COLORS.ATRAM,   data: atramDivData,   nextRecord: nextAtramRecord,   recordType: '7th trading day', nav: 'atram' },
  ]

  return (
    <div className="space-y-5">

      {/* ── Hero: Portfolio Value + Allocation ────────────────────────────── */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-5">
          <div>
            <p className="text-slate-500 text-xs font-medium mb-1">Portfolio Value</p>
            <p className="text-white text-4xl font-black tracking-tight">{fmtPeso(totalValue, 0)}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <span className={`text-sm font-semibold ${isTotalGain ? 'text-emerald-400' : 'text-red-400'}`}>
                {(isTotalGain ? '+' : '') + fmtPeso(totalGain, 0)}
              </span>
              {totalGainPct != null && (
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${isTotalGain ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
                  {fmtPct(totalGainPct)}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-right">
              <p className="text-slate-500 text-xs mb-0.5">Total Invested</p>
              <p className="text-slate-200 text-lg font-bold">{fmtPeso(totalCost, 0)}</p>
            </div>
            <div className="text-right">
              <p className="text-slate-500 text-xs mb-0.5">Dividends Earned</p>
              <p className={`text-lg font-bold ${totalDividends > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                {totalDividends > 0 ? fmtPeso(totalDividends, 2) : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-slate-500 text-xs mb-0.5">Est. Monthly</p>
              <p className={`text-lg font-bold ${totalEstMonthly > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                {totalEstMonthly > 0 ? fmtPeso(totalEstMonthly, 2) : '—'}
              </p>
              {totalEstMonthly > 0 && totalValue > 0 && (
                <p className="text-emerald-600 text-xs">{((totalEstMonthly * 12 / totalValue) * 100).toFixed(2)}% yield</p>
              )}
            </div>
          </div>
        </div>

        {/* Allocation bar */}
        {allocationData.length > 0 && (
          <div>
            <div className="flex rounded-full h-2.5 overflow-hidden bg-neutral-800">
              {allocationData.map(({ name, value, color }) => (
                <div
                  key={name}
                  className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${(value / totalValue * 100)}%`, backgroundColor: color }}
                  title={`${name}: ${fmtPeso(value, 0)} (${(value / totalValue * 100).toFixed(1)}%)`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
              {allocationData.map(({ name, value, color }) => (
                <div key={name} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-slate-400 text-xs">{name}</span>
                  <span className="text-slate-300 text-xs font-medium">{fmtPeso(value, 0)}</span>
                  <span className="text-slate-600 text-xs">{(value / totalValue * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Today's Signals ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Today's Signals</p>
          {actionableSignals.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-400">{actionableSignals.length} actionable</span>
              {totalRecommendedToday > 0 && (
                <span className="text-xs text-slate-500">{fmtPeso(totalRecommendedToday, 0)} total</span>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {funds.map((f) => (
            <button
              key={f.key}
              onClick={() => onNavigate(f.key)}
              className="bg-neutral-900 hover:bg-neutral-800/80 border border-neutral-800 rounded-lg p-3.5 text-left transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: f.color }} />
                  <span className="text-slate-300 text-xs font-bold">{f.code}</span>
                </div>
                <SignalBadge signal={f.signal} isBtc={f.isBtc} />
              </div>
              <div className="space-y-1">
                {f.isBtc ? (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-slate-500 text-xs">Price</span>
                      <span className="text-white text-sm font-semibold">
                        {btcPrice > 0 ? `$${btcPrice.toLocaleString()}` : '—'}
                        {btcPrice > 0 && <span className="text-slate-500 text-xs font-normal ml-1">({fmtPeso(btcPrice * btcPhpPerUsd, 0)})</span>}
                      </span>
                    </div>
                    {f.signal?.drawdownPct != null && (
                      <div className="flex items-baseline justify-between">
                        <span className="text-slate-500 text-xs">Drawdown</span>
                        <span className={`text-xs font-medium ${f.signal.drawdownPct >= 5 ? 'text-red-400' : f.signal.drawdownPct >= 3 ? 'text-orange-400' : 'text-slate-400'}`}>
                          -{f.signal.drawdownPct.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between">
                      <span className="text-slate-500 text-xs">NAVPU</span>
                      <span className="text-white text-sm font-semibold">₱{f.navpu > 0 ? f.navpu.toFixed(2) : '—'}</span>
                    </div>
                    {f.signal?.dailyChange != null && (
                      <div className="flex items-baseline justify-between">
                        <span className="text-slate-500 text-xs">Change</span>
                        <span className={`text-xs font-medium ${f.signal.dailyChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {f.signal.dailyChange >= 0 ? '+' : ''}{f.signal.dailyChange.toFixed(4)}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {f.signal?.amount > 0 && (
                  <div className="flex items-baseline justify-between">
                    <span className="text-slate-500 text-xs">Buy</span>
                    <span className="text-emerald-400 text-xs font-bold">{fmtPeso(f.signal.amount, 0)}</span>
                  </div>
                )}
              </div>
              {f.signal?.recommendation && (
                <p className="text-slate-600 text-xs leading-tight mt-2 line-clamp-2">{f.signal.recommendation}</p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Positions ─────────────────────────────────────────────────────── */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg">
        <div className="px-5 pt-5 pb-3">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Positions</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs">
                <th className="text-left pl-5 pb-2 font-medium">Fund</th>
                <th className="text-right pb-2 font-medium">Price</th>
                <th className="text-right pb-2 font-medium hidden sm:table-cell">Units</th>
                <th className="text-right pb-2 font-medium hidden sm:table-cell">Avg Price</th>
                <th className="text-right pb-2 font-medium">Cost</th>
                <th className="text-right pb-2 font-medium">Value</th>
                <th className="text-right pb-2 font-medium">P&L</th>
                <th className="text-right pr-5 pb-2 font-medium hidden md:table-cell">Dividends</th>
              </tr>
            </thead>
            <tbody>
              {funds.map((f) => {
                const isGain = f.gain >= 0
                return (
                  <tr
                    key={f.key}
                    className="border-t border-neutral-800/60 hover:bg-neutral-800/30 cursor-pointer transition-colors"
                    onClick={() => onNavigate(f.key)}
                  >
                    <td className="py-3 pl-5">
                      <div className="flex items-center gap-2">
                        <span className="w-1 h-6 rounded-full flex-shrink-0" style={{ backgroundColor: f.color }} />
                        <span className="text-white font-semibold text-sm">{f.code}</span>
                      </div>
                    </td>
                    <td className="py-3 text-right text-slate-200 font-medium">
                      {f.isBtc
                        ? (btcPrice > 0 ? <>{`$${btcPrice.toLocaleString()}`}<span className="text-slate-500 text-xs font-normal ml-1">({fmtPeso(btcPrice * btcPhpPerUsd, 0)})</span></> : '—')
                        : `₱${f.navpu > 0 ? f.navpu.toFixed(2) : '—'}`}
                    </td>
                    <td className="py-3 text-right text-slate-300 hidden sm:table-cell">
                      {f.hasPosition
                        ? (f.isBtc ? `₿${f.units.toFixed(6)}` : f.units.toLocaleString('en-PH', { maximumFractionDigits: 2 }))
                        : '—'}
                    </td>
                    <td className="py-3 text-right text-slate-400 hidden sm:table-cell">
                      {f.isBtc
                        ? (btcAvgCost > 0 ? <>{`$${btcAvgCost.toLocaleString()}`}<span className="text-slate-500 text-xs ml-1">({fmtPeso(btcAvgCost * btcPhpPerUsd, 0)})</span></> : '—')
                        : (f.avgPrice ? `₱${f.avgPrice.toFixed(2)}` : '—')}
                    </td>
                    <td className="py-3 text-right text-slate-300">{f.cost > 0 ? fmtPeso(f.cost, 0) : '—'}</td>
                    <td className="py-3 text-right text-slate-200 font-medium">{f.value > 0 ? fmtPeso(f.value, 0) : '—'}</td>
                    <td className="py-3 text-right">
                      {f.hasPosition ? (
                        <div>
                          <span className={`font-semibold ${isGain ? 'text-emerald-400' : 'text-red-400'}`}>
                            {(isGain ? '+' : '') + fmtPeso(f.gain, 0)}
                          </span>
                          {f.gainPct != null && (
                            <p className={`text-xs ${isGain ? 'text-emerald-600' : 'text-red-600'}`}>
                              {fmtPct(f.gainPct)}
                            </p>
                          )}
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-3 text-right pr-5 hidden md:table-cell">
                      <span className={f.divs > 0 ? 'text-emerald-400 font-medium' : 'text-slate-600'}>
                        {f.divs > 0 ? fmtPeso(f.divs, 2) : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-neutral-700 font-bold">
                <td className="pt-3 pb-4 pl-5 text-slate-400 text-xs uppercase">Total</td>
                <td className="pt-3 pb-4" />
                <td className="pt-3 pb-4 hidden sm:table-cell" />
                <td className="pt-3 pb-4 hidden sm:table-cell" />
                <td className="pt-3 pb-4 text-right text-slate-200">{totalCost > 0 ? fmtPeso(totalCost, 0) : '—'}</td>
                <td className="pt-3 pb-4 text-right text-white">{totalValue > 0 ? fmtPeso(totalValue, 0) : '—'}</td>
                <td className="pt-3 pb-4 text-right">
                  <span className={isTotalGain ? 'text-emerald-400' : 'text-red-400'}>
                    {(isTotalGain ? '+' : '') + fmtPeso(totalGain, 0)}
                  </span>
                  {totalGainPct != null && (
                    <p className={`text-xs ${isTotalGain ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmtPct(totalGainPct)}
                    </p>
                  )}
                </td>
                <td className="pt-3 pb-4 text-right pr-5 hidden md:table-cell text-emerald-400">
                  {totalDividends > 0 ? fmtPeso(totalDividends, 2) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Dividends ─────────────────────────────────────────────────────── */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Dividends</p>
          {totalDividends > 0 && (
            <p className="text-emerald-400 text-xs font-bold">{fmtPeso(totalDividends, 2)} total</p>
          )}
        </div>
        <div className="divide-y divide-neutral-800/60">
          {divFunds.map((f) => {
            const daysTo = f.nextRecord ? daysBetween(todayStr, f.nextRecord) : null
            const recordDate = f.nextRecord ? new Date(f.nextRecord + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '—'
            const lastAmt = f.data.lastDiv ? (f.data.lastDiv.earned || (f.data.lastDiv.units || 0) * (f.data.lastDiv.divPerUnit || 0)) : 0
            return (
              <button
                key={f.code}
                onClick={() => onNavigate(f.nav)}
                className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-neutral-800/30 transition-colors text-left group"
              >
                <span className="w-1 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: f.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-semibold">{f.code}</span>
                    <span className="text-slate-600 text-xs">{f.recordType}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-slate-500 text-xs">
                      {f.data.months > 0 ? `${f.data.months} months` : 'No payouts'}
                    </span>
                    {lastAmt > 0 && (
                      <span className="text-slate-500 text-xs">Last: {fmtPeso(lastAmt, 2)}</span>
                    )}
                    {f.data.estMonthly > 0 && (
                      <span className="text-slate-500 text-xs">Est./mo: <span className="text-emerald-500">{fmtPeso(f.data.estMonthly, 2)}</span></span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${f.data.totalEarned > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {f.data.totalEarned > 0 ? fmtPeso(f.data.totalEarned, 2) : '—'}
                  </p>
                  {daysTo != null && daysTo >= 0 && (
                    <p className="text-slate-500 text-xs mt-0.5">
                      {recordDate} · <span className={daysTo <= 3 ? 'text-yellow-400 font-medium' : ''}>{daysTo === 0 ? 'Today' : `${daysTo}d`}</span>
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {totalDividends === 0 && (
          <p className="text-slate-600 text-xs text-center pb-4">Log your first payout from each fund's tab.</p>
        )}
      </div>
    </div>
  )
}

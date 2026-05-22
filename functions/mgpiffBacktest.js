'use strict'

const { analyzeSignal, computeMgpiffThresholds } = require('./mgpiffSignalEngine')

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.getDay() === 0 || d.getDay() === 6
}

const PH_HOLIDAYS = new Set([
  '2025-01-01','2025-04-09','2025-04-17','2025-04-18','2025-05-01',
  '2025-06-12','2025-08-25','2025-11-01','2025-11-02','2025-11-30',
  '2025-12-08','2025-12-25','2025-12-30',
  '2026-01-01','2026-04-02','2026-04-03','2026-04-09','2026-05-01',
  '2026-06-12','2026-08-31','2026-11-30','2026-12-25','2026-12-30',
  '2026-04-04','2026-08-21','2026-11-01','2026-11-02','2026-12-08',
  '2026-12-24','2026-12-31',
])

function isNonTradingDay(dateStr) {
  return isWeekend(dateStr) || PH_HOLIDAYS.has(dateStr)
}

/**
 * Compute the Nth trading day of a given month.
 * month is 0-indexed.
 */
function nthTradingDayOfMonth(year, month, n) {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month, day)
    if (d.getMonth() !== month) break
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (!isNonTradingDay(dateStr)) {
      count++
      if (count === n) return dateStr
    }
  }
  return null
}

/**
 * Generate MGPIFF distribution dates (7th trading day of each month)
 * spanning from firstDate to lastDate.
 */
function buildDistributionDates(firstDate, lastDate) {
  const dates = []
  const start = new Date(firstDate + 'T00:00:00')
  const end   = new Date(lastDate  + 'T00:00:00')

  let year  = start.getFullYear()
  let month = start.getMonth()

  while (new Date(year, month, 1) <= end) {
    const date = nthTradingDayOfMonth(year, month, 7)
    if (date) dates.push(date)
    month++
    if (month > 11) { month = 0; year++ }
  }
  return dates
}

// ── Metric helpers (identical to backtest.js) ─────────────────────────────────

function computeSharpe(returns3d) {
  const clean = returns3d.filter((r) => r != null)
  if (clean.length < 5) return null
  const mean = clean.reduce((s, v) => s + v, 0) / clean.length
  const std  = Math.sqrt(clean.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / clean.length)
  if (std === 0) return null
  const RISK_FREE_3D = (0.05 / 365) * 3
  const raw          = (mean - RISK_FREE_3D) / std
  const annualized   = parseFloat((raw * Math.sqrt(122)).toFixed(3))
  const interpretation =
    annualized < 0    ? 'NEGATIVE'   :
    annualized < 0.75 ? 'WEAK'       :
    annualized < 1    ? 'ACCEPTABLE' :
    annualized < 2    ? 'GOOD'       :
    annualized < 3    ? 'EXCELLENT'  : 'SUSPICIOUS'
  return { annualized, raw: parseFloat(raw.toFixed(3)), meanReturn3d: parseFloat(mean.toFixed(4)), stdReturn3d: parseFloat(std.toFixed(4)), sampleCount: clean.length, interpretation }
}

function computeConsecutiveLosses(actionable) {
  let maxStreak = 0, curStreak = 0
  const streaks = []
  for (const r of actionable) {
    if (r.return3d != null && r.return3d < 0) {
      curStreak++
      if (curStreak > maxStreak) maxStreak = curStreak
    } else {
      if (curStreak > 0) streaks.push(curStreak)
      curStreak = 0
    }
  }
  if (curStreak > 0) streaks.push(curStreak)
  const avgStreak = streaks.length ? parseFloat((streaks.reduce((s, v) => s + v, 0) / streaks.length).toFixed(1)) : 0
  return { maxConsecutiveLosses: maxStreak, avgConsecutiveLosses: avgStreak, streakCount: streaks.length }
}

function computeDrawdown(navpuSeries) {
  if (!navpuSeries || navpuSeries.length < 2) return null
  let peak = navpuSeries[0], maxDD = 0, ddSum = 0, ddCount = 0, inDD = false, ddStartIdx = 0, maxDDDays = 0
  for (let i = 1; i < navpuSeries.length; i++) {
    const v = navpuSeries[i]
    if (v > peak) { peak = v; inDD = false }
    const dd = (peak - v) / peak * 100
    if (dd > 0) {
      if (!inDD) { inDD = true; ddStartIdx = i; ddCount++ }
      if (dd > maxDD) { maxDD = dd; maxDDDays = i - ddStartIdx }
      ddSum += dd
    } else { inDD = false }
  }
  return {
    maxDrawdownPct: parseFloat(maxDD.toFixed(2)),
    avgDrawdownPct: ddCount > 0 ? parseFloat((ddSum / navpuSeries.length).toFixed(2)) : 0,
    maxDrawdownDays: maxDDDays,
    drawdownCount: ddCount,
  }
}

/**
 * Run backtest against mgpiff_navpu_history.
 * Uses MGPIFF distribution dates (7th trading day of each month) as record dates.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @returns {{ results: object[], summary: object }}
 */
async function runMgpiffBacktest(db) {
  const snap = await db.collection('mgpiff_navpu_history').orderBy('date', 'asc').get()
  const allDocs = snap.docs
    .map((d) => ({ date: d.data().date, navpu: d.data().navpu }))
    .filter((d) => d.navpu != null && !isNaN(d.navpu) && !isWeekend(d.date))

  if (allDocs.length < 3) return { results: [], summary: { totalDays: 0, error: 'Insufficient NAVPU history' } }

  const recordDates = buildDistributionDates(allDocs[0].date, allDocs[allDocs.length - 1].date)

  const results = []
  let simTotalInvested = 0
  let simTotalUnits   = 0
  let simAvgPrice     = null

  for (let i = 2; i < allDocs.length; i++) {
    const today      = allDocs[i]
    const yesterday  = allDocs[i - 1]
    const twoDaysAgo = allDocs[i - 2]
    const last7      = allDocs.slice(Math.max(0, i - 6), i + 1).map((d) => d.navpu)

    const historicalValues = allDocs.slice(0, i + 1).map((d) => d.navpu)
    const thresholds = computeMgpiffThresholds(historicalValues)

    const monthYear   = today.date.slice(0, 7)
    const monthResults = results.filter((r) => r.date.slice(0, 7) === monthYear && r.isActionable)

    const dividendBuyDoneThisMonth = monthResults.some((r) => r.isDividendBuy)
    const oppResults = monthResults.filter((r) => !r.isDividendBuy && r.bucket !== 'extreme_override')
    const staggerSeen = new Set()
    let opportunityBuyCountThisMonth = 0
    for (const r of oppResults) {
      if (r.staggerEventDate) {
        if (!staggerSeen.has(r.staggerEventDate)) { staggerSeen.add(r.staggerEventDate); opportunityBuyCountThisMonth++ }
      } else { opportunityBuyCountThisMonth++ }
    }
    const oppDates = oppResults.map((r) => r.date).sort()
    const lastOpportunityBuyDate = oppDates.length > 0 ? oppDates[oppDates.length - 1] : null

    const signal = analyzeSignal({
      todayNavpu:              today.navpu,
      yesterdayNavpu:          yesterday.navpu,
      twoDaysAgoNavpu:         twoDaysAgo.navpu,
      last7Navpus:             last7,
      avgPrice:                simAvgPrice,
      dividendBuyDoneThisMonth,
      opportunityBuyCountThisMonth,
      lastOpportunityBuyDate,
      todayStr:                today.date,
      recordDates,
      thresholds,
    })

    if (signal.isActionable && signal.amount > 0 && today.navpu > 0) {
      const unitsBought = signal.amount / today.navpu
      simTotalInvested += signal.amount
      simTotalUnits    += unitsBought
      simAvgPrice = parseFloat((simTotalInvested / simTotalUnits).toFixed(4))
    }

    const forward1  = i + 1  < allDocs.length ? allDocs[i + 1].navpu  : null
    const forward3  = i + 3  < allDocs.length ? allDocs[i + 3].navpu  : null
    const forward5  = i + 5  < allDocs.length ? allDocs[i + 5].navpu  : null
    const forward15 = i + 15 < allDocs.length ? allDocs[i + 15].navpu : null
    const forward30 = i + 30 < allDocs.length ? allDocs[i + 30].navpu : null
    const next5     = allDocs.slice(i + 1, i + 6).map((d) => d.navpu)
    const avg5      = next5.length > 0 ? parseFloat((next5.reduce((a, b) => a + b, 0) / next5.length).toFixed(4)) : null

    const ret = (fwd) => fwd != null ? parseFloat(((fwd - today.navpu) / today.navpu * 100).toFixed(4)) : null
    const return1d  = ret(forward1)
    const return3d  = ret(forward3)
    const return5d  = ret(forward5)
    const return15d = ret(forward15)
    const return30d = ret(forward30)

    const positiveReturn3d = return3d != null ? return3d > 0 : null
    const belowAvg5d       = avg5 != null ? today.navpu < avg5 : null
    const correctBoth      = positiveReturn3d != null && belowAvg5d != null ? positiveReturn3d && belowAvg5d : null
    const lowestNext5      = next5.length > 0 ? Math.min(...next5) : null
    const noBuyCorrect     = (signal.signal === 'NO_BUY' || signal.signal === 'WATCH_SKIP') && lowestNext5 != null
      ? lowestNext5 < today.navpu : null

    results.push({
      date: today.date, navpu: today.navpu,
      signal: signal.signal, amount: signal.amount,
      isActionable: signal.isActionable, isDividendBuy: signal.isDividendBuy, bucket: signal.bucket,
      dipSignals: signal.dipSignals,
      return1d, return3d, return5d, return15d, return30d,
      avg5dNavpu: avg5, positiveReturn3d, belowAvg5d, correctBoth, noBuyCorrect,
      staggerEventDate: signal.staggerEventDate || null,
    })
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  function avg(arr) {
    if (!arr.length) return null
    return parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(4))
  }
  function pct(arr, fn) {
    if (!arr.length) return null
    return parseFloat((arr.filter(fn).length / arr.length * 100).toFixed(1))
  }

  const actionable   = results.filter((r) => r.isActionable && r.return3d  != null)
  const actionable15 = results.filter((r) => r.isActionable && r.return15d != null)
  const actionable30 = results.filter((r) => r.isActionable && r.return30d != null)
  const noBuys       = results.filter((r) => (r.signal === 'NO_BUY' || r.signal === 'WATCH_SKIP') && r.noBuyCorrect != null)

  const signalBreakdown = {}
  for (const r of results) signalBreakdown[r.signal] = (signalBreakdown[r.signal] || 0) + 1

  const actionableSorted = [...actionable].sort((a, b) => b.return3d - a.return3d)

  const summary = {
    totalDays: results.length,
    totalActionable: actionable.length,
    pctPositiveReturn3d:  pct(actionable,   (r) => r.positiveReturn3d),
    pctBelowAvg5d:        pct(actionable,   (r) => r.belowAvg5d),
    pctCorrectBoth:       pct(actionable,   (r) => r.correctBoth),
    avgReturn1d:          avg(actionable.filter((r) => r.return1d  != null).map((r) => r.return1d)),
    avgReturn3d:          avg(actionable.map((r) => r.return3d)),
    avgReturn5d:          avg(actionable.filter((r) => r.return5d  != null).map((r) => r.return5d)),
    avgReturn15d:         avg(actionable15.map((r) => r.return15d)),
    avgReturn30d:         avg(actionable30.map((r) => r.return30d)),
    pctPositiveReturn15d: pct(actionable15, (r) => r.return15d > 0),
    pctPositiveReturn30d: pct(actionable30, (r) => r.return30d > 0),
    bucketWinRates: (() => {
      const out = {}
      for (const b of ['dividend', 'opportunity', 'extreme_override']) {
        const group = actionable15.filter((r) => r.bucket === b)
        out[b] = { count: group.length, pct15d: pct(group, (r) => r.return15d > 0), avg15d: avg(group.map((r) => r.return15d)) }
      }
      return out
    })(),
    week1BucketBreakdown: (() => {
      const week1 = results.filter((r) => r.isActionable && parseInt(r.date.slice(8, 10)) <= 7)
      const out = {}
      for (const b of ['dividend', 'opportunity', 'extreme_override']) out[b] = week1.filter((r) => r.bucket === b).length
      out.total = week1.length
      return out
    })(),
    noBuyEffectiveness: pct(noBuys, (r) => r.noBuyCorrect),
    noBuyTotal: noBuys.length,
    signalBreakdown,
    buyDayDistribution: (() => {
      const buckets = { 'Week 1 (1-7)': 0, 'Week 2 (8-14)': 0, 'Week 3 (15-21)': 0, 'Week 4 (22+)': 0 }
      for (const r of results.filter((r) => r.isActionable)) {
        const day = parseInt(r.date.slice(8, 10))
        if (day <= 7) buckets['Week 1 (1-7)']++
        else if (day <= 14) buckets['Week 2 (8-14)']++
        else if (day <= 21) buckets['Week 3 (15-21)']++
        else buckets['Week 4 (22+)']++
      }
      return buckets
    })(),
    bestSignal:  actionableSorted[0]                               ? { date: actionableSorted[0].date,                               signal: actionableSorted[0].signal,                               return3d: actionableSorted[0].return3d }                               : null,
    worstSignal: actionableSorted[actionableSorted.length - 1]     ? { date: actionableSorted[actionableSorted.length - 1].date,     signal: actionableSorted[actionableSorted.length - 1].signal,     return3d: actionableSorted[actionableSorted.length - 1].return3d }     : null,
    backtestPeriod: { from: results[0]?.date || null, to: results[results.length - 1]?.date || null },
    sharpeRatio:       computeSharpe(actionable.map((r) => r.return3d)),
    consecutiveLosses: computeConsecutiveLosses(actionable),
    drawdown:          computeDrawdown(allDocs.map((d) => d.navpu)),
    computedAt: new Date().toISOString(),
  }

  return { results, summary }
}

module.exports = { runMgpiffBacktest }

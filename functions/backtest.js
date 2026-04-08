'use strict'

const { analyzeSignal, computeThresholds } = require('./signalEngine')

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.getDay() === 0 || d.getDay() === 6
}

/**
 * Run backtest against all historical NAVPU data in Firestore.
 * Uses strict no-lookahead: each day only uses data available up to that day.
 *
 * avgPrice is simulated dynamically: starts null (no position), then updates
 * after each actionable signal as if the buy was executed at that day's NAVPU.
 *
 * Correctness metrics (both must be true for a signal to count as "correct"):
 *   1. NAVPU is higher 3 business days later (positive 3d return)
 *   2. Entry price is below the average NAVPU of the next 5 business days (good entry quality)
 *
 * @param {FirebaseFirestore.Firestore} db
 * @returns {{ results: object[], summary: object }}
 */
async function runBacktest(db) {
  // Load all NAVPU history sorted by date, strip weekends
  const snap = await db.collection('navpu_history').orderBy('date', 'asc').get()
  const allDocs = snap.docs
    .map((d) => ({ date: d.data().date, navpu: d.data().navpu }))
    .filter((d) => d.navpu != null && !isNaN(d.navpu) && !isWeekend(d.date))

  // Load all dividend record dates from Firestore (seeded via seedDividends)
  const divSnap = await db.collection('dividends').get()
  const recordDates = divSnap.docs.map((d) => d.data().date).filter(Boolean).sort()

  const results = []

  // Simulated position state: starts with no position
  let simTotalInvested = 0
  let simTotalUnits = 0
  let simAvgPrice = null

  for (let i = 2; i < allDocs.length; i++) {
    const today = allDocs[i]
    const yesterday = allDocs[i - 1]
    const twoDaysAgo = allDocs[i - 2]

    // last7: up to 7 most recent values including today
    const startIdx = Math.max(0, i - 6)
    const last7 = allDocs.slice(startIdx, i + 1).map((d) => d.navpu)

    // Thresholds: only use data available up to today (no lookahead)
    const historicalValues = allDocs.slice(0, i + 1).map((d) => d.navpu)
    const thresholds = computeThresholds(historicalValues)

    // Compute bucket state from already-processed results (same month)
    const monthYear = today.date.slice(0, 7)
    const monthResults = results.filter((r) => r.date.slice(0, 7) === monthYear && r.isActionable)

    // Dividend bucket: at most 1 per month
    const dividendBuyDoneThisMonth = monthResults.some((r) => r.isDividendBuy)

    // Opportunity bucket: stagger-aware count (excludes dividend and extreme_override)
    const oppResults = monthResults.filter((r) => !r.isDividendBuy && r.bucket !== 'extreme_override')
    const staggerGroupsSeen = new Set()
    let opportunityBuyCountThisMonth = 0
    for (const r of oppResults) {
      if (r.staggerEventDate) {
        if (!staggerGroupsSeen.has(r.staggerEventDate)) {
          staggerGroupsSeen.add(r.staggerEventDate)
          opportunityBuyCountThisMonth++
        }
      } else {
        opportunityBuyCountThisMonth++
      }
    }
    const oppDates = oppResults.map((r) => r.date).sort()
    const lastOpportunityBuyDate = oppDates.length > 0 ? oppDates[oppDates.length - 1] : null

    const signal = analyzeSignal({
      todayNavpu: today.navpu,
      yesterdayNavpu: yesterday.navpu,
      twoDaysAgoNavpu: twoDaysAgo.navpu,
      last7Navpus: last7,
      avgPrice: simAvgPrice,
      dividendBuyDoneThisMonth,
      opportunityBuyCountThisMonth,
      lastOpportunityBuyDate,
      todayStr: today.date,
      recordDates,
      thresholds,
    })

    // Update simulated position after an actionable signal
    if (signal.isActionable && signal.amount > 0 && today.navpu > 0) {
      const unitsBought = signal.amount / today.navpu
      simTotalInvested += signal.amount
      simTotalUnits += unitsBought
      simAvgPrice = parseFloat((simTotalInvested / simTotalUnits).toFixed(4))
    }

    // Forward NAVPU values (business days only)
    const forward1  = i + 1  < allDocs.length ? allDocs[i + 1].navpu  : null
    const forward3  = i + 3  < allDocs.length ? allDocs[i + 3].navpu  : null
    const forward5  = i + 5  < allDocs.length ? allDocs[i + 5].navpu  : null
    const forward15 = i + 15 < allDocs.length ? allDocs[i + 15].navpu : null
    const forward30 = i + 30 < allDocs.length ? allDocs[i + 30].navpu : null
    const next5 = allDocs.slice(i + 1, i + 6).map((d) => d.navpu)
    const avg5 = next5.length > 0
      ? parseFloat((next5.reduce((a, b) => a + b, 0) / next5.length).toFixed(4))
      : null

    const return1d  = forward1  != null ? parseFloat(((forward1  - today.navpu) / today.navpu * 100).toFixed(4)) : null
    const return3d  = forward3  != null ? parseFloat(((forward3  - today.navpu) / today.navpu * 100).toFixed(4)) : null
    const return5d  = forward5  != null ? parseFloat(((forward5  - today.navpu) / today.navpu * 100).toFixed(4)) : null
    const return15d = forward15 != null ? parseFloat(((forward15 - today.navpu) / today.navpu * 100).toFixed(4)) : null
    const return30d = forward30 != null ? parseFloat(((forward30 - today.navpu) / today.navpu * 100).toFixed(4)) : null

    // Metric 1: 3d positive return
    const positiveReturn3d = return3d != null ? return3d > 0 : null

    // Metric 2: Entry below 5-day forward average (good entry quality)
    const belowAvg5d = avg5 != null ? today.navpu < avg5 : null

    // Combined correctness: both conditions
    const correctBoth = positiveReturn3d != null && belowAvg5d != null
      ? positiveReturn3d && belowAvg5d
      : null

    // NO_BUY effectiveness: was NAVPU lower at any point in next 5 days?
    const lowestNext5 = next5.length > 0 ? Math.min(...next5) : null
    const noBuyCorrect = (signal.signal === 'NO_BUY' || signal.signal === 'WATCH_SKIP') && lowestNext5 != null
      ? lowestNext5 < today.navpu
      : null

    results.push({
      date: today.date,
      navpu: today.navpu,
      signal: signal.signal,
      amount: signal.amount,
      isActionable: signal.isActionable,
      isDividendBuy: signal.isDividendBuy,
      bucket: signal.bucket,
      dipSignals: signal.dipSignals,
      return1d,
      return3d,
      return5d,
      return15d,
      return30d,
      avg5dNavpu: avg5,
      positiveReturn3d,
      belowAvg5d,
      correctBoth,
      noBuyCorrect,
      staggerEventDate: signal.staggerEventDate || null,
    })
  }

  // ── Summary stats ─────────────────────────────────────────────────────────
  const actionable = results.filter((r) => r.isActionable && r.return3d != null)
  const actionable15 = results.filter((r) => r.isActionable && r.return15d != null)
  const actionable30 = results.filter((r) => r.isActionable && r.return30d != null)
  const noBuys = results.filter(
    (r) => (r.signal === 'NO_BUY' || r.signal === 'WATCH_SKIP') && r.noBuyCorrect != null
  )

  function avg(arr) {
    if (!arr.length) return null
    return parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(4))
  }

  function pct(arr, fn) {
    if (!arr.length) return null
    return parseFloat((arr.filter(fn).length / arr.length * 100).toFixed(1))
  }

  const signalBreakdown = {}
  for (const r of results) {
    signalBreakdown[r.signal] = (signalBreakdown[r.signal] || 0) + 1
  }

  // Best and worst actionable signals by 3d return
  const actionableSorted = [...actionable].sort((a, b) => b.return3d - a.return3d)
  const bestSignal = actionableSorted[0] || null
  const worstSignal = actionableSorted[actionableSorted.length - 1] || null

  const summary = {
    totalDays: results.length,
    totalActionable: actionable.length,
    // Metric 1: price appreciation
    pctPositiveReturn3d: pct(actionable, (r) => r.positiveReturn3d),
    // Metric 2: entry quality
    pctBelowAvg5d: pct(actionable, (r) => r.belowAvg5d),
    // Combined correctness
    pctCorrectBoth: pct(actionable, (r) => r.correctBoth),
    // Average returns
    avgReturn1d:  avg(actionable.filter((r) => r.return1d  != null).map((r) => r.return1d)),
    avgReturn3d:  avg(actionable.map((r) => r.return3d)),
    avgReturn5d:  avg(actionable.filter((r) => r.return5d  != null).map((r) => r.return5d)),
    avgReturn15d: avg(actionable15.map((r) => r.return15d)),
    avgReturn30d: avg(actionable30.map((r) => r.return30d)),
    // Medium-term win rates
    pctPositiveReturn15d: pct(actionable15, (r) => r.return15d > 0),
    pctPositiveReturn30d: pct(actionable30, (r) => r.return30d > 0),
    // Win rate by bucket (15d)
    bucketWinRates: (() => {
      const buckets = ['dividend', 'opportunity', 'extreme_override']
      const out = {}
      for (const b of buckets) {
        const group = actionable15.filter((r) => r.bucket === b)
        out[b] = {
          count: group.length,
          pct15d: pct(group, (r) => r.return15d > 0),
          avg15d: avg(group.map((r) => r.return15d)),
        }
      }
      return out
    })(),
    // Week 1 breakdown by bucket
    week1BucketBreakdown: (() => {
      const week1 = results.filter((r) => r.isActionable && parseInt(r.date.slice(8, 10)) <= 7)
      const out = {}
      for (const b of ['dividend', 'opportunity', 'extreme_override']) {
        out[b] = week1.filter((r) => r.bucket === b).length
      }
      out.total = week1.length
      return out
    })(),
    // NO_BUY / WATCH_SKIP effectiveness
    noBuyEffectiveness: pct(noBuys, (r) => r.noBuyCorrect),
    noBuyTotal: noBuys.length,
    // Signal distribution
    signalBreakdown,
    // Day-of-month distribution of actionable signals (4 weekly buckets)
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
    bestSignal: bestSignal ? { date: bestSignal.date, signal: bestSignal.signal, return3d: bestSignal.return3d } : null,
    worstSignal: worstSignal ? { date: worstSignal.date, signal: worstSignal.signal, return3d: worstSignal.return3d } : null,
    backtestPeriod: {
      from: results[0]?.date || null,
      to: results[results.length - 1]?.date || null,
    },
    computedAt: new Date().toISOString(),
  }

  return { results, summary }
}

module.exports = { runBacktest }

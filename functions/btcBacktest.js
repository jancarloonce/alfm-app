'use strict'

const { analyzeSignal, computeDrawdown } = require('./btcSignalEngine')

const PHP_PER_USD     = 57.5
const EXCHANGE_FEE    = 0.001
const RISK_FREE_DAILY = 0.05 / 365

async function runBtcBacktest(db, lookbackDays = 365) {
  // Fetch extra 30 days (720 candles) for forward return tracking
  const totalCandles = (lookbackDays + 30) * 24
  const candles      = await fetchHistoricalCandles(totalCandles)

  if (candles.length < 10) {
    throw new Error(`Insufficient candle data: only ${candles.length} candles returned`)
  }
  console.log(`[btcBacktest] Loaded ${candles.length} hourly candles (${lookbackDays}d + 30d buffer)`)

  const analysisEnd = candles.length - 720
  const results     = []
  const equityCurve = []

  let simUnits        = 0
  let simTotalCostPhp = 0
  let simAvgCostUsd   = 0
  let firstBuyTimestamp = null

  const monthlySpend   = {}
  let lastBuyTimestamp = null

  for (let i = 2; i < candles.length; i++) {
    const candle     = candles[i]
    const prevCandle = candles[i - 1]

    const nowIso   = new Date(candle.openTime).toISOString()
    const monthKey = nowIso.slice(0, 7)

    const windowStart  = Math.max(0, i - 719)
    const windowCloses = candles.slice(windowStart, i + 1).map((c) => c.close)

    const totalSpentThisMonth = monthlySpend[monthKey] || 0

    const rsiStart  = Math.max(0, i - 29)
    const rsiCloses = candles.slice(rsiStart, i + 1).map((c) => c.close)
    const rsi       = calculateRSI(rsiCloses, 14)

    const volWindow  = candles.slice(windowStart, i + 1).map((c) => c.volume)
    const avgVol720  = volWindow.reduce((a, b) => a + b, 0) / volWindow.length
    const volumeRatio = avgVol720 > 0
      ? parseFloat((candle.volume / avgVol720).toFixed(3))
      : null

    const high90d = i >= 2160
      ? Math.max(...candles.slice(i - 2160, i + 1).map((c) => c.close))
      : Math.max(...candles.slice(0, i + 1).map((c) => c.close))

    const signal = analyzeSignal({
      currentPrice:                candle.close,
      prevHourPrice:               prevCandle.close,
      avgCost:                     simAvgCostUsd || null,
      totalSpentThisMonth,
      lastOpportunityBuyTimestamp: lastBuyTimestamp,
      nowIso,
      closes:                      windowCloses,
      rsi,
      fearGreedIndex:              null,
      volumeRatio,
      high90d,
      extremeOverrideCount24h:     0,
    })

    if (signal.isActionable && signal.amount > 0 && candle.close > 0) {
      const grossUnits  = signal.amount / PHP_PER_USD / candle.close
      const unitsBought = grossUnits * (1 - EXCHANGE_FEE)

      simUnits        += unitsBought
      simTotalCostPhp += signal.amount
      simAvgCostUsd    = simUnits > 0
        ? (simAvgCostUsd * (simUnits - unitsBought) + unitsBought * candle.close) / simUnits
        : candle.close

      monthlySpend[monthKey]  = (monthlySpend[monthKey] || 0) + signal.amount
      lastBuyTimestamp        = nowIso

      if (firstBuyTimestamp === null) {
        firstBuyTimestamp = nowIso
      }
    }

    const portfolioPhp = simUnits * candle.close * PHP_PER_USD
    equityCurve.push({
      timestamp:    nowIso,
      portfolioPhp: parseFloat(portfolioPhp.toFixed(2)),
      btcPrice:     candle.close,
    })

    // Forward returns
    const f1h  = i + 1  < candles.length ? candles[i + 1].close  : null
    const f3h  = i + 3  < candles.length ? candles[i + 3].close  : null
    const f6h  = i + 6  < candles.length ? candles[i + 6].close  : null
    const f12h = i + 12 < candles.length ? candles[i + 12].close : null
    const f24h = i + 24 < candles.length ? candles[i + 24].close : null
    const f72h = i + 72 < candles.length ? candles[i + 72].close : null

    // 30-day (720-candle) forward return and max forward price
    const f30d = i + 720 < candles.length ? candles[i + 720].close : null
    const next720Closes = candles.slice(i + 1, i + 721).map((c) => c.close)
    const maxForward30d = next720Closes.length > 0 ? Math.max(...next720Closes) : null
    const maxReturn30d = maxForward30d != null
      ? parseFloat(((maxForward30d - candle.close) / candle.close * 100).toFixed(3))
      : null
    const recovered8pct = maxReturn30d != null ? maxReturn30d >= 8 : null

    function ret(fwd) {
      if (fwd == null) return null
      return parseFloat(((fwd - candle.close) / candle.close * 100).toFixed(3))
    }

    const return1h  = ret(f1h)
    const return3h  = ret(f3h)
    const return6h  = ret(f6h)
    const return12h = ret(f12h)
    const return24h = ret(f24h)
    const return72h = ret(f72h)
    const return30d = ret(f30d)

    const positive24h = return24h != null ? return24h > 0 : null

    // Drawdown at this candle (30d lookback)
    const { drawdownPct: drawdown30d } = computeDrawdown(windowCloses, 720)

    // Only include in main analysis window (exclude the 30d buffer at the end)
    if (i < analysisEnd || analysisEnd <= 2) {
      results.push({
        timestamp:    nowIso,
        hour:         nowIso.slice(0, 13),
        price:        candle.close,
        signal:       signal.signal,
        amount:       signal.amount,
        isActionable: signal.isActionable,
        bucket:       signal.bucket,
        drawdownPct:  signal.drawdownPct,
        rsi,
        volumeRatio,
        return1h,
        return3h,
        return6h,
        return12h,
        return24h,
        return72h,
        return30d,
        maxReturn30d,
        recovered8pct,
        drawdown30d,
        positive24h,
      })
    }
  }

  // ── Post-loop analytics ──────────────────────────────────────────────────

  const actionable    = results.filter((r) => r.isActionable && r.return24h != null)
  const actionable72  = results.filter((r) => r.isActionable && r.return72h != null)
  const actionable30d = results.filter((r) => r.isActionable && r.return30d != null)
  const withRecovery  = results.filter((r) => r.isActionable && r.recovered8pct != null)

  function avg(arr) {
    if (!arr.length) return null
    return parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3))
  }
  function winRate(arr, fn) {
    if (!arr.length) return null
    return parseFloat((arr.filter(fn).length / arr.length * 100).toFixed(1))
  }

  const signalBreakdown = {}
  for (const r of results) {
    signalBreakdown[r.signal] = (signalBreakdown[r.signal] || 0) + 1
  }

  const actionableSorted = [...actionable].sort((a, b) => b.return24h - a.return24h)
  const bestSignal  = actionableSorted[0] || null
  const worstSignal = actionableSorted[actionableSorted.length - 1] || null

  const finalPrice    = candles[candles.length - 1].close
  const portfolioPhp  = simUnits * finalPrice * PHP_PER_USD
  const unrealizedPhp = portfolioPhp - simTotalCostPhp
  const unrealizedPct = simTotalCostPhp > 0
    ? parseFloat(((unrealizedPhp / simTotalCostPhp) * 100).toFixed(2))
    : null

  const drawdown            = computeDrawdowns(equityCurve)
  const sharpeRatio         = computeSharpe(actionable.map((r) => r.return24h))
  const consecutiveLosses   = computeConsecutiveLosses(actionable)
  const cagrElapsedDays = firstBuyTimestamp
    ? (new Date(candles[candles.length - 1].openTime) - new Date(firstBuyTimestamp)) / 86400000
    : lookbackDays
  const cagr            = computeCAGR(simTotalCostPhp, portfolioPhp, cagrElapsedDays)
  const totalFeesPaidPhp    = parseFloat((simTotalCostPhp * EXCHANGE_FEE).toFixed(2))
  const equityCurveSampled  = sampleEquityCurve(equityCurve, 365)

  // ── Drawdown analysis: group by drawdown bucket ──────────────────────────
  const drawdownBuckets = [
    { label: '0-3%',   min: 0,  max: 3  },
    { label: '3-5%',   min: 3,  max: 5  },
    { label: '5-10%',  min: 5,  max: 10 },
    { label: '10-15%', min: 10, max: 15 },
    { label: '15-20%', min: 15, max: 20 },
    { label: '20%+',   min: 20, max: Infinity },
  ]

  const drawdownAnalysis = drawdownBuckets.map((bucket) => {
    const inBucket = results.filter((r) =>
      r.drawdown30d >= bucket.min && r.drawdown30d < bucket.max &&
      r.recovered8pct != null
    )
    const actionableInBucket = inBucket.filter((r) => r.isActionable)
    const recoveredCount = inBucket.filter((r) => r.recovered8pct === true).length
    const recoveryRate = inBucket.length > 0
      ? parseFloat((recoveredCount / inBucket.length * 100).toFixed(1))
      : null
    const avgMaxReturn = inBucket.length > 0
      ? avg(inBucket.filter((r) => r.maxReturn30d != null).map((r) => r.maxReturn30d))
      : null
    const avgReturn30d = inBucket.length > 0
      ? avg(inBucket.filter((r) => r.return30d != null).map((r) => r.return30d))
      : null

    return {
      bucket: bucket.label,
      totalCandles: inBucket.length,
      actionableCandles: actionableInBucket.length,
      recoveredCount,
      recoveryRate,
      avgMaxReturn,
      avgReturn30d,
    }
  })

  const pctRecovered8pctIn30d = winRate(withRecovery, (r) => r.recovered8pct === true)

  const summary = {
    backtestPeriod: {
      from: results[0]?.timestamp  || null,
      to:   results[results.length - 1]?.timestamp || null,
    },
    totalHours:      results.length,
    totalActionable: actionable.length,
    lookbackDays,

    pctPositiveReturn24h: winRate(actionable, (r) => r.positive24h),
    pctPositiveReturn1h:  winRate(actionable.filter((r) => r.return1h  != null), (r) => r.return1h  > 0),
    pctPositiveReturn3h:  winRate(actionable.filter((r) => r.return3h  != null), (r) => r.return3h  > 0),
    pctPositiveReturn6h:  winRate(actionable.filter((r) => r.return6h  != null), (r) => r.return6h  > 0),
    pctPositiveReturn12h: winRate(actionable.filter((r) => r.return12h != null), (r) => r.return12h > 0),
    pctPositiveReturn72h: winRate(actionable72, (r) => r.return72h > 0),
    pctPositiveReturn30d: winRate(actionable30d, (r) => r.return30d > 0),

    avgReturn1h:  avg(actionable.filter((r) => r.return1h  != null).map((r) => r.return1h)),
    avgReturn3h:  avg(actionable.filter((r) => r.return3h  != null).map((r) => r.return3h)),
    avgReturn6h:  avg(actionable.filter((r) => r.return6h  != null).map((r) => r.return6h)),
    avgReturn12h: avg(actionable.filter((r) => r.return12h != null).map((r) => r.return12h)),
    avgReturn24h: avg(actionable.map((r) => r.return24h)),
    avgReturn72h: avg(actionable72.map((r) => r.return72h)),
    avgReturn30d: avg(actionable30d.map((r) => r.return30d)),

    // 30-day recovery headline metrics
    pctRecovered8pctIn30d,
    avgMaxReturn30d: avg(withRecovery.map((r) => r.maxReturn30d)),

    // Drawdown analysis by bucket
    drawdownAnalysis,

    bucketWinRates: (() => {
      const out = {}
      for (const b of ['opportunity', 'extreme_override']) {
        const group = actionable.filter((r) => r.bucket === b)
        out[b] = { count: group.length, pct24h: winRate(group, (r) => r.positive24h), avg24h: avg(group.map((r) => r.return24h)) }
      }
      return out
    })(),

    signalBreakdown,

    drawdown,
    sharpeRatio,
    consecutiveLosses,
    cagr,
    equityCurveSampled,

    simulation: {
      totalBuys:        actionable.length,
      totalInvestedPhp: parseFloat(simTotalCostPhp.toFixed(2)),
      totalFeesPaidPhp,
      btcAccumulated:   parseFloat(simUnits.toFixed(8)),
      avgCostUsd:       parseFloat(simAvgCostUsd.toFixed(2)),
      finalPriceUsd:    finalPrice,
      portfolioPhp:     parseFloat(portfolioPhp.toFixed(2)),
      unrealizedPhp:    parseFloat(unrealizedPhp.toFixed(2)),
      unrealizedPct,
      phpPerUsd:        PHP_PER_USD,
      feeRate:          EXCHANGE_FEE,
    },

    bestSignal:  bestSignal  ? { timestamp: bestSignal.timestamp,  signal: bestSignal.signal,  return24h: bestSignal.return24h  } : null,
    worstSignal: worstSignal ? { timestamp: worstSignal.timestamp, signal: worstSignal.signal, return24h: worstSignal.return24h } : null,
    computedAt:  new Date().toISOString(),
  }

  return { results, summary }
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics helpers
// ─────────────────────────────────────────────────────────────────────────────

function computeDrawdowns(equityCurve) {
  if (!equityCurve.length) return null

  let peak           = 0
  let maxDrawdownPct = 0
  let inDrawdown     = false
  let drawdownHours  = 0

  const durations = []

  for (const pt of equityCurve) {
    if (pt.portfolioPhp <= 0) continue

    if (pt.portfolioPhp >= peak) {
      if (inDrawdown && drawdownHours > 0) {
        durations.push(drawdownHours)
        drawdownHours = 0
        inDrawdown    = false
      }
      peak = pt.portfolioPhp
    } else {
      const dd = (peak - pt.portfolioPhp) / peak * 100
      if (dd > maxDrawdownPct) maxDrawdownPct = dd
      if (!inDrawdown) inDrawdown = true
      drawdownHours++
    }
  }
  if (inDrawdown && drawdownHours > 0) durations.push(drawdownHours)

  const avgHours = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0
  const maxHours = durations.length > 0 ? Math.max(...durations) : 0

  return {
    maxDrawdownPct:  parseFloat(maxDrawdownPct.toFixed(2)),
    avgDrawdownDays: parseFloat((avgHours / 24).toFixed(1)),
    maxDrawdownDays: parseFloat((maxHours / 24).toFixed(1)),
    drawdownCount:   durations.length,
  }
}

function computeSharpe(returns24h) {
  if (returns24h.length < 2) return null

  const n      = returns24h.length
  const mean   = returns24h.reduce((a, b) => a + b, 0) / n
  const variance = returns24h.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)
  const stdDev = Math.sqrt(variance)

  if (stdDev === 0) return null

  const rfDaily  = RISK_FREE_DAILY * 100
  const sharpeRaw = (mean - rfDaily) / stdDev
  const sharpeAnn = parseFloat((sharpeRaw * Math.sqrt(365)).toFixed(3))

  return {
    annualized:    sharpeAnn,
    raw:           parseFloat(sharpeRaw.toFixed(3)),
    meanReturn24h: parseFloat(mean.toFixed(3)),
    stdReturn24h:  parseFloat(stdDev.toFixed(3)),
    sampleCount:   n,
    interpretation: sharpeAnn < 0    ? 'NEGATIVE'
                  : sharpeAnn < 0.75 ? 'WEAK'
                  : sharpeAnn < 1    ? 'ACCEPTABLE'
                  : sharpeAnn < 2    ? 'GOOD'
                  : sharpeAnn < 3    ? 'EXCELLENT'
                  :                    'SUSPICIOUS',
  }
}

function computeConsecutiveLosses(actionableWithReturn) {
  if (!actionableWithReturn.length) return null

  let maxStreak     = 0
  let currentStreak = 0
  const streaks     = []

  for (const r of actionableWithReturn) {
    if (r.return24h <= 0) {
      currentStreak++
      if (currentStreak > maxStreak) maxStreak = currentStreak
    } else {
      if (currentStreak > 0) { streaks.push(currentStreak); currentStreak = 0 }
    }
  }
  if (currentStreak > 0) streaks.push(currentStreak)

  const avgStreak = streaks.length > 0
    ? parseFloat((streaks.reduce((a, b) => a + b, 0) / streaks.length).toFixed(1))
    : 0

  return {
    maxConsecutiveLosses: maxStreak,
    avgConsecutiveLosses: avgStreak,
    streakCount:          streaks.length,
  }
}

function computeCAGR(startValue, endValue, days) {
  if (!startValue || !endValue || startValue <= 0 || days <= 0) return null
  const years = days / 365
  return parseFloat(((Math.pow(endValue / startValue, 1 / years) - 1) * 100).toFixed(2))
}

function sampleEquityCurve(equityCurve, maxPoints) {
  if (equityCurve.length <= maxPoints) return equityCurve
  const step    = Math.ceil(equityCurve.length / maxPoints)
  const sampled = []
  for (let i = 0; i < equityCurve.length; i += step) sampled.push(equityCurve[i])
  const last = equityCurve[equityCurve.length - 1]
  if (sampled[sampled.length - 1] !== last) sampled.push(last)
  return sampled
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────────────────────────────────────

async function fetchHistoricalCandles(totalCandles) {
  const MAX_PER_REQUEST = 1000
  const allCandles      = []
  let endTime           = Date.now()

  while (allCandles.length < totalCandles) {
    const limit = Math.min(MAX_PER_REQUEST, totalCandles - allCandles.length)
    const url   = `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&endTime=${endTime}&limit=${limit}`

    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`)

    const raw = await res.json()
    if (!raw.length) break

    const parsed = raw.map((k) => ({
      openTime: k[0],
      open:     parseFloat(k[1]),
      high:     parseFloat(k[2]),
      low:      parseFloat(k[3]),
      close:    parseFloat(k[4]),
      volume:   parseFloat(k[5]),
    }))

    allCandles.unshift(...parsed)
    endTime = raw[0][0] - 1
  }

  const seen = new Set()
  return allCandles
    .sort((a, b) => a.openTime - b.openTime)
    .filter((c) => { if (seen.has(c.openTime)) return false; seen.add(c.openTime); return true })
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null
  const changes = closes.slice(1).map((c, i) => c - closes[i])
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else                avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period; i < changes.length; i++) {
    const g = changes[i] > 0 ? changes[i]           : 0
    const l = changes[i] < 0 ? Math.abs(changes[i]) : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
  }
  if (avgLoss === 0) return 100
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2))
}

module.exports = { runBtcBacktest }

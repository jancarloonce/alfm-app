'use strict'

/**
 * ALFM Buy Signal Engine
 * Pure function:no Firebase dependencies.
 * All inputs are passed as parameters; returns a signal object.
 */

const AVG_PRICE = 45.48

// Tier definitions
const TIERS = {
  NO_BUY: { signal: 'NO_BUY', amount: 0 },
  WATCH: { signal: 'WATCH', amount: 1000 },
  BUY: { signal: 'BUY', amount: 2500 },
  BUY_MORE: { signal: 'BUY_MORE', amount: 3500 },
  AGGRESSIVE: { signal: 'AGGRESSIVE', amount: 5000 },
  PRIORITY_BUY: { signal: 'PRIORITY_BUY', amount: 5000 },
}

const TIER_ORDER = ['NO_BUY', 'WATCH', 'BUY', 'BUY_MORE', 'AGGRESSIVE']

// Fixed baseline thresholds:used as fallback when dynamic thresholds drift too far
const BASELINE_THRESHOLDS = {
  noBuyThreshold: 46.50,
  watchThreshold: 46.20,
  buyThreshold: 46.00,
  buyMoreThreshold: 45.80,
}

/**
 * Compute dynamic buy tier thresholds from historical NAVPU values.
 * Uses rolling 90-day window with a stability guard: if any threshold
 * falls more than ₱0.30 below the 90-day mean (drift during downtrend),
 * reverts to fixed baseline thresholds.
 *
 * Fix 2: Rolling 90-day window + threshold stability guard.
 *
 * @param {number[]} navpuValuesChronological - NAVPU values sorted oldest→newest
 * @returns {object} thresholds
 */
function computeThresholds(navpuValuesChronological) {
  const clean = navpuValuesChronological.filter((v) => v != null && !isNaN(v))

  // Use only last 90 data points (rolling window)
  const window90 = clean.slice(-90)
  const sorted = [...window90].sort((a, b) => a - b)
  const n = sorted.length

  if (n < 5) return null // not enough data

  function percentile(p) {
    const idx = (p / 100) * (n - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return parseFloat((sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])).toFixed(4))
  }

  const mean90 = parseFloat((sorted.reduce((a, b) => a + b, 0) / n).toFixed(4))
  const MAX_DRIFT = 0.30

  const computed = {
    noBuyThreshold: parseFloat(percentile(75).toFixed(2)),
    watchThreshold: parseFloat(percentile(60).toFixed(2)),
    buyThreshold: parseFloat(percentile(45).toFixed(2)),
    buyMoreThreshold: parseFloat(percentile(30).toFixed(2)),
  }

  // Stability guard: if any threshold drifts more than ₱0.30 below mean, use baseline
  const drifted = Object.keys(computed).some(
    (k) => computed[k] < mean90 - MAX_DRIFT
  )

  const finalThresholds = drifted ? BASELINE_THRESHOLDS : computed

  return {
    ...finalThresholds,
    usingBaseline: drifted,
    periodHigh: parseFloat(Math.max(...sorted).toFixed(2)),
    periodLow: parseFloat(Math.min(...sorted).toFixed(2)),
    mean: mean90,
    dataPoints: n,
    computedAt: new Date().toISOString(),
  }
}

/**
 * Upgrade tier by one level (PRIORITY_BUY cannot be upgraded).
 */
function upgradeTier(tier) {
  if (tier === 'PRIORITY_BUY') return 'PRIORITY_BUY'
  const idx = TIER_ORDER.indexOf(tier)
  if (idx === -1 || idx === TIER_ORDER.length - 1) return tier
  return TIER_ORDER[idx + 1]
}

/**
 * Get base tier from NAVPU using dynamic thresholds.
 * Falls back to hardcoded values if thresholds not provided.
 */
function getBaseTier(navpu, avgPrice, thresholds) {
  const ap = avgPrice || AVG_PRICE
  if (navpu < ap) return 'PRIORITY_BUY'

  if (thresholds) {
    if (navpu >= thresholds.noBuyThreshold) return 'NO_BUY'
    if (navpu >= thresholds.watchThreshold) return 'WATCH'
    if (navpu >= thresholds.buyThreshold) return 'BUY'
    if (navpu >= thresholds.buyMoreThreshold) return 'BUY_MORE'
    return 'AGGRESSIVE'
  }

  // Hardcoded fallback (used until enough data accumulates)
  if (navpu >= 46.50) return 'NO_BUY'
  if (navpu >= 46.20) return 'WATCH'
  if (navpu >= 46.00) return 'BUY'
  if (navpu >= 45.80) return 'BUY_MORE'
  return 'AGGRESSIVE'
}

/**
 * Parse a date string YYYY-MM-DD into a Date at midnight.
 */
function parseDate(str) {
  return new Date(str + 'T00:00:00')
}

/**
 * Compute days difference (b - a) in calendar days.
 */
function daysDiff(aStr, bStr) {
  const a = parseDate(aStr)
  const b = parseDate(bStr)
  return Math.round((b - a) / (1000 * 60 * 60 * 24))
}

/**
 * Main signal analysis function.
 *
 * @param {object} params
 * @param {number} params.todayNavpu
 * @param {number} params.yesterdayNavpu
 * @param {number} params.twoDaysAgoNavpu - may be null
 * @param {number[]} params.last7Navpus - array of up to 7 most recent navpus (oldest first, today last)
 * @param {number} params.avgPrice - current avg price from position
 * @param {number} params.monthlyBuyCount - how many buys recorded this month
 * @param {string} params.todayStr - 'YYYY-MM-DD'
 * @param {string[]} params.recordDates - array of record date strings 'YYYY-MM-DD'
 * @param {object|null} params.thresholds - dynamic thresholds from computeThresholds(), or null for hardcoded fallback
 * @returns {object} signal result
 */
function analyzeSignal({
  todayNavpu,
  yesterdayNavpu,
  twoDaysAgoNavpu,
  last7Navpus,
  avgPrice,
  monthlyBuyCount,
  todayStr,
  recordDates,
  thresholds = null,
}) {
  const effectiveAvgPrice = avgPrice || AVG_PRICE

  // Daily change
  const dailyChange =
    yesterdayNavpu != null
      ? parseFloat((todayNavpu - yesterdayNavpu).toFixed(4))
      : 0

  const dailyChangePct =
    yesterdayNavpu != null
      ? parseFloat(((dailyChange / yesterdayNavpu) * 100).toFixed(2))
      : 0

  // vs avg
  const vsAvg =
    todayNavpu < effectiveAvgPrice
      ? 'BELOW_AVG'
      : todayNavpu > effectiveAvgPrice
      ? 'ABOVE_AVG'
      : 'AT_AVG'

  // ── Dividend cycle detection ──────────────────────────────────────────────
  let divCycle = 'N/A'
  const sortedRecords = [...recordDates].sort()

  // Post-record: 1-3 days after any record date
  for (const rd of sortedRecords) {
    const diff = daysDiff(rd, todayStr)
    if (diff >= 1 && diff <= 3) {
      divCycle = 'POST_RECORD'
      break
    }
  }

  // Pre-record: within 7 days BEFORE a record date
  if (divCycle === 'N/A') {
    for (const rd of sortedRecords) {
      const diff = daysDiff(todayStr, rd)
      if (diff >= 1 && diff <= 7) {
        divCycle = 'PRE_RECORD_CAUTION'
        break
      }
    }
  }

  // ── Dip signal detection ──────────────────────────────────────────────────
  const dipSignals = []
  let staggerWarning = false

  // Fix 6: Noise filter:movements < ₱0.08 are noise, skip all dip detection
  const NOISE_THRESHOLD = 0.08
  const isNoise = Math.abs(dailyChange) < NOISE_THRESHOLD

  if (!isNoise) {
    // 1. STRONG_DROP
    if (dailyChange <= -0.30) {
      dipSignals.push('STRONG_DROP')
    }

    // 2. CONFIRMED_WEAKNESS: 2 consecutive red days, total 2-day drop >= -0.20
    if (
      twoDaysAgoNavpu != null &&
      yesterdayNavpu != null &&
      yesterdayNavpu < twoDaysAgoNavpu &&
      todayNavpu < yesterdayNavpu
    ) {
      const twoDayDrop = todayNavpu - twoDaysAgoNavpu
      if (twoDayDrop <= -0.20) {
        dipSignals.push('CONFIRMED_WEAKNESS')
      }
    }

    // 3. DROP_STABILIZATION: previous day drop >= -0.30, today's change within ±0.10
    if (yesterdayNavpu != null && twoDaysAgoNavpu != null) {
      const prevDayChange = yesterdayNavpu - twoDaysAgoNavpu
      if (prevDayChange <= -0.30 && Math.abs(dailyChange) <= 0.10) {
        dipSignals.push('DROP_STABILIZATION')
      }
    }

    // 4. EXTREME_DROP: dailyChange <= -0.50 → stagger warning
    if (dailyChange <= -0.50) {
      staggerWarning = true
    }
  }

  // ── Trend detection ───────────────────────────────────────────────────────
  // Fix 5: Downtrend triggers if EITHER condition is met:
  //   A) 5 of last 6 transitions are lower (momentum-based)
  //   B) Net NAVPU decline >= ₱0.40 over last 7 days (magnitude-based)
  let trendWarning = null
  const trends = []

  if (last7Navpus && last7Navpus.length >= 5) {
    const recents = last7Navpus.slice(-7)

    // Condition A: 5 of last 6 transitions are lower
    let lowerCount = 0
    for (let i = 1; i < recents.length; i++) {
      if (recents[i] < recents[i - 1]) lowerCount++
    }
    const majorityDown = lowerCount >= 5

    // Condition B: net decline >= ₱0.40 over the window
    const netDecline = recents[recents.length - 1] - recents[0]
    const significantDecline = netDecline <= -0.40

    if (majorityDown || significantDecline) {
      trends.push('LOWER_HIGHS')
    }
  }

  // Consecutive green days (2-3) with no dip signals
  if (last7Navpus && last7Navpus.length >= 3 && dipSignals.length === 0) {
    const recents = last7Navpus.slice(-3)
    const allGreen = recents[1] > recents[0] && recents[2] > recents[1]
    if (allGreen) {
      trends.push('CONSECUTIVE_GREEN')
    }
  }

  if (trends.length > 0) {
    trendWarning = trends.join(' ')
  }

  // ── Base tier ─────────────────────────────────────────────────────────────
  let currentTier = getBaseTier(todayNavpu, effectiveAvgPrice, thresholds)
  let currentAmount = TIERS[currentTier].amount

  // ── Apply dip signal upgrade (Fix 1: single strongest signal only) ────────
  // Priority order: STRONG_DROP > CONFIRMED_WEAKNESS > DROP_STABILIZATION
  // Maximum: +1 tier upgrade, +₱1,000:no stacking
  const DIP_PRIORITY = ['STRONG_DROP', 'CONFIRMED_WEAKNESS', 'DROP_STABILIZATION']
  const strongestDip = DIP_PRIORITY.find((ds) => dipSignals.includes(ds))
  let dipUpgradeCount = 0

  if (strongestDip && currentTier !== 'PRIORITY_BUY') {
    currentTier = upgradeTier(currentTier)
    dipUpgradeCount = 1
    currentAmount = Math.min(currentAmount + 1000, 5000)
  }

  // Post-record window minimum BUY_MORE
  if (divCycle === 'POST_RECORD' && dailyChange <= -0.25) {
    const tierIdx = TIER_ORDER.indexOf(currentTier)
    const buyMoreIdx = TIER_ORDER.indexOf('BUY_MORE')
    if (tierIdx < buyMoreIdx) {
      currentTier = 'BUY_MORE'
      currentAmount = Math.max(currentAmount, 3000)
    }
  }

  // ── Trend filter: reduce amount by 35%, min ₱1,000 ───────────────────────
  const downtrend = trends.includes('LOWER_HIGHS')
  if (downtrend && currentTier !== 'NO_BUY') {
    currentAmount = Math.max(1000, Math.round(currentAmount * 0.65))
  }

  // Fix 3: PRIORITY_BUY modifier:reduce to ₱3,500 during downtrend
  // Preserves the PRIORITY_BUY signal, only adjusts size
  if (currentTier === 'PRIORITY_BUY' && downtrend) {
    currentAmount = 3500
  }

  // Snap amount to tier standard if no upgrades and no trend reduction
  if (dipUpgradeCount === 0 && currentTier !== 'NO_BUY' && !downtrend) {
    currentAmount = TIERS[currentTier].amount
  }

  // ── WATCH tier: skip if no dip signals ────────────────────────────────────
  let finalSignal = currentTier
  if (currentTier === 'WATCH' && dipSignals.length === 0) {
    finalSignal = 'WATCH_SKIP'
    currentAmount = 0
  }

  // ── Monthly cap logic ─────────────────────────────────────────────────────
  let isActionable = currentAmount > 0

  if (finalSignal === 'NO_BUY' || finalSignal === 'WATCH_SKIP') {
    isActionable = false
  }

  if (isActionable) {
    if (monthlyBuyCount >= 2) {
      finalSignal = 'MONTHLY_CAP'
      currentAmount = 0
      isActionable = false
    } else if (monthlyBuyCount === 1) {
      // Check exceptions for 2nd buy
      const exception1 = dailyChange <= -0.30
      const exception2 = todayNavpu < effectiveAvgPrice
      const exception3 =
        divCycle === 'POST_RECORD' && dailyChange <= -0.25

      if (!exception1 && !exception2 && !exception3) {
        finalSignal = 'NO_SECOND_BUY'
        currentAmount = 0
        isActionable = false
      }
    }
  }

  // ── Build recommendation text ─────────────────────────────────────────────
  let recommendation = ''

  switch (finalSignal) {
    case 'NO_BUY':
      recommendation =
        'NAVPU is in the no-buy zone (≥ ₱46.50). Hold your position and wait for a dip below ₱46.50 before adding.'
      break
    case 'WATCH':
      recommendation = `NAVPU is in the watch zone. A small ₱${currentAmount.toLocaleString()} buy is warranted given the dip signal (${dipSignals.join(', ')}). Monitor closely.`
      break
    case 'WATCH_SKIP':
      recommendation =
        'NAVPU is in the watch zone but there are no dip signals. Skip this entry and wait for a confirmed dip.'
      break
    case 'BUY':
      recommendation = `Standard buy signal. Consider investing ₱${currentAmount.toLocaleString()} at today's NAVPU of ₱${todayNavpu.toFixed(2)}. Place order before 2 PM PH time.`
      break
    case 'BUY_MORE':
      recommendation = `Strong dip opportunity. Increase position by ₱${currentAmount.toLocaleString()}. NAVPU at ₱${todayNavpu.toFixed(2)} represents a solid entry point.`
      break
    case 'AGGRESSIVE':
      recommendation = `Aggressive dip. NAVPU is deeply discounted at ₱${todayNavpu.toFixed(2)}. Deploy ₱${currentAmount.toLocaleString()} for maximum accumulation.`
      break
    case 'PRIORITY_BUY':
      recommendation = `NAVPU (₱${todayNavpu.toFixed(2)}) is BELOW your average price (₱${effectiveAvgPrice.toFixed(2)}). Highest-priority buy. Invest ₱${currentAmount.toLocaleString()} to lower your cost average.`
      break
    case 'NO_SECOND_BUY':
      recommendation =
        'You have already made 1 buy this month and no exception rule applies (drop < -0.30%, not below avg price, not in post-record window). Hold until next month or exception triggers.'
      break
    case 'MONTHLY_CAP':
      recommendation =
        'Monthly cap reached (2 buys). No more buys this month. Resume next month or if an extreme event overrides the strategy.'
      break
    default:
      recommendation = 'Monitor and follow the strategy rules.'
  }

  if (staggerWarning) {
    recommendation +=
      ' Extreme drop detected. Consider staggering this buy into 2-3 smaller purchases over the next few days.'
  }

  if (trendWarning && trendWarning.includes('CONSECUTIVE_GREEN')) {
    recommendation += ' Note: 2-3 consecutive green days with no dip signals. Caution on chasing the trend.'
  }

  return {
    signal: finalSignal,
    amount: currentAmount,
    dailyChange,
    dailyChangePct,
    todayNavpu,
    avgPrice: effectiveAvgPrice,
    vsAvg,
    dipSignals,
    divCycle,
    trendWarning: trendWarning || null,
    staggerWarning,
    // Fix 4: stagger group tracking:all buys from the same EXTREME_DROP event
    // share this date and count as 1 toward the monthly cap
    staggerEventDate: staggerWarning ? todayStr : null,
    recommendation,
    isActionable,
  }
}

module.exports = { analyzeSignal, getBaseTier, computeThresholds, AVG_PRICE }

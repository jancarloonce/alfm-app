'use strict'

/**
 * ALFM Buy Signal Engine
 * Pure function: no Firebase dependencies.
 * All inputs are passed as parameters; returns a signal object.
 */

const AVG_PRICE = 45.48

// Tier definitions
const TIERS = {
  NO_BUY:      { signal: 'NO_BUY',      amount: 0    },
  WATCH:       { signal: 'WATCH',       amount: 1000 },
  BUY:         { signal: 'BUY',         amount: 2500 },
  BUY_MORE:    { signal: 'BUY_MORE',    amount: 3500 },
  AGGRESSIVE:  { signal: 'AGGRESSIVE',  amount: 5000 },
  PRIORITY_BUY:{ signal: 'PRIORITY_BUY',amount: 5000 },
}

const TIER_ORDER = ['NO_BUY', 'WATCH', 'BUY', 'BUY_MORE', 'AGGRESSIVE']

// Fixed baseline thresholds: used as fallback when dynamic thresholds drift too far
const BASELINE_THRESHOLDS = {
  noBuyThreshold:  46.50,
  watchThreshold:  46.20,
  buyThreshold:    46.00,
  buyMoreThreshold:45.80,
}

/**
 * Compute dynamic buy tier thresholds from historical NAVPU values.
 * Uses rolling 90-day window with a stability guard.
 */
function computeThresholds(navpuValuesChronological) {
  const clean = navpuValuesChronological.filter((v) => v != null && !isNaN(v))
  const window90 = clean.slice(-90)
  const sorted = [...window90].sort((a, b) => a - b)
  const n = sorted.length

  if (n < 5) return null

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
    noBuyThreshold:  parseFloat(percentile(75).toFixed(2)),
    watchThreshold:  parseFloat(percentile(60).toFixed(2)),
    buyThreshold:    parseFloat(percentile(45).toFixed(2)),
    buyMoreThreshold:parseFloat(percentile(30).toFixed(2)),
  }

  const drifted = Object.keys(computed).some((k) => computed[k] < mean90 - MAX_DRIFT)
  const finalThresholds = drifted ? BASELINE_THRESHOLDS : computed

  return {
    ...finalThresholds,
    usingBaseline: drifted,
    periodHigh: parseFloat(Math.max(...sorted).toFixed(2)),
    periodLow:  parseFloat(Math.min(...sorted).toFixed(2)),
    mean: mean90,
    dataPoints: n,
    computedAt: new Date().toISOString(),
  }
}

function upgradeTier(tier) {
  if (tier === 'PRIORITY_BUY') return 'PRIORITY_BUY'
  const idx = TIER_ORDER.indexOf(tier)
  if (idx === -1 || idx === TIER_ORDER.length - 1) return tier
  return TIER_ORDER[idx + 1]
}

function getBaseTier(navpu, avgPrice, thresholds) {
  const ap = avgPrice || AVG_PRICE
  if (navpu < ap) return 'PRIORITY_BUY'

  if (thresholds) {
    if (navpu >= thresholds.noBuyThreshold)  return 'NO_BUY'
    if (navpu >= thresholds.watchThreshold)  return 'WATCH'
    if (navpu >= thresholds.buyThreshold)    return 'BUY'
    if (navpu >= thresholds.buyMoreThreshold)return 'BUY_MORE'
    return 'AGGRESSIVE'
  }

  if (navpu >= 46.50) return 'NO_BUY'
  if (navpu >= 46.20) return 'WATCH'
  if (navpu >= 46.00) return 'BUY'
  if (navpu >= 45.80) return 'BUY_MORE'
  return 'AGGRESSIVE'
}

function parseDate(str) {
  return new Date(str + 'T00:00:00')
}

function daysDiff(aStr, bStr) {
  return Math.round((parseDate(bStr) - parseDate(aStr)) / (1000 * 60 * 60 * 24))
}

/**
 * Count trading days (Mon-Fri) between dateA and dateB, exclusive of dateA.
 */
function tradingDaysBetween(dateA, dateB) {
  const a = parseDate(dateA)
  const b = parseDate(dateB)
  let count = 0
  const cur = new Date(a)
  cur.setDate(cur.getDate() + 1)
  while (cur <= b) {
    const day = cur.getDay()
    if (day !== 0 && day !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

/**
 * Returns true if date falls in calendar days 1-5 of its month.
 */
function isDays1to5(dateStr) {
  return parseInt(dateStr.slice(8, 10)) <= 5
}

/**
 * Main signal analysis function.
 *
 * BUCKET SYSTEM (replaces single monthlyBuyCount):
 *
 * DIVIDEND BUCKET (max 1/month):
 *   Triggers on post-record window + drop >= -0.25 + quality filter.
 *   Exempt from Days 1-5 lock and gap rule.
 *
 * OPPORTUNITY BUCKET (max 2/month):
 *   Subject to Days 1-5 lock and 7-trading-day gap between buys.
 *   PRIORITY_BUY and STRONG_DROP bypass lock and gap (not cap).
 *   EXTREME_DROP bypasses ALL rules including cap.
 *
 * @param {object} params
 * @param {number}   params.todayNavpu
 * @param {number}   params.yesterdayNavpu
 * @param {number}   params.twoDaysAgoNavpu
 * @param {number[]} params.last7Navpus
 * @param {number}   params.avgPrice
 * @param {boolean}  params.dividendBuyDoneThisMonth
 * @param {number}   params.opportunityBuyCountThisMonth  (0, 1, or 2)
 * @param {string|null} params.lastOpportunityBuyDate     (YYYY-MM-DD or null)
 * @param {string}   params.todayStr
 * @param {string[]} params.recordDates
 * @param {object|null} params.thresholds
 */
function analyzeSignal({
  todayNavpu,
  yesterdayNavpu,
  twoDaysAgoNavpu,
  last7Navpus,
  avgPrice,
  dividendBuyDoneThisMonth = false,
  opportunityBuyCountThisMonth = 0,
  lastOpportunityBuyDate = null,
  todayStr,
  recordDates,
  thresholds = null,
}) {
  const effectiveAvgPrice = avgPrice || AVG_PRICE

  const dailyChange = yesterdayNavpu != null
    ? parseFloat((todayNavpu - yesterdayNavpu).toFixed(4))
    : 0

  const dailyChangePct = yesterdayNavpu != null
    ? parseFloat(((dailyChange / yesterdayNavpu) * 100).toFixed(2))
    : 0

  const vsAvg =
    todayNavpu < effectiveAvgPrice ? 'BELOW_AVG' :
    todayNavpu > effectiveAvgPrice ? 'ABOVE_AVG' : 'AT_AVG'

  // ── Dividend cycle detection ──────────────────────────────────────────────
  let divCycle = 'N/A'
  const sortedRecords = [...recordDates].sort()

  for (const rd of sortedRecords) {
    const diff = daysDiff(rd, todayStr)
    if (diff >= 1 && diff <= 3) { divCycle = 'POST_RECORD'; break }
  }

  if (divCycle === 'N/A') {
    for (const rd of sortedRecords) {
      const diff = daysDiff(todayStr, rd)
      if (diff >= 1 && diff <= 7) { divCycle = 'PRE_RECORD_CAUTION'; break }
    }
  }

  // ── Dip signal detection ──────────────────────────────────────────────────
  const dipSignals = []
  let staggerWarning = false
  const isNoise = Math.abs(dailyChange) < 0.08

  if (!isNoise) {
    if (dailyChange <= -0.30) dipSignals.push('STRONG_DROP')

    if (
      twoDaysAgoNavpu != null && yesterdayNavpu != null &&
      yesterdayNavpu < twoDaysAgoNavpu && todayNavpu < yesterdayNavpu &&
      (todayNavpu - twoDaysAgoNavpu) <= -0.20
    ) {
      dipSignals.push('CONFIRMED_WEAKNESS')
    }

    if (yesterdayNavpu != null && twoDaysAgoNavpu != null) {
      const prevDayChange = yesterdayNavpu - twoDaysAgoNavpu
      if (prevDayChange <= -0.30 && Math.abs(dailyChange) <= 0.10) {
        dipSignals.push('DROP_STABILIZATION')
      }
    }

    if (dailyChange <= -0.50) staggerWarning = true
  }

  // ── Trend detection ───────────────────────────────────────────────────────
  let trendWarning = null
  const trends = []

  if (last7Navpus && last7Navpus.length >= 5) {
    const recents = last7Navpus.slice(-7)
    let lowerCount = 0
    for (let i = 1; i < recents.length; i++) {
      if (recents[i] < recents[i - 1]) lowerCount++
    }
    const netDecline = recents[recents.length - 1] - recents[0]
    if (lowerCount >= 5 || netDecline <= -0.40) trends.push('LOWER_HIGHS')
  }

  if (last7Navpus && last7Navpus.length >= 3 && dipSignals.length === 0) {
    const recents = last7Navpus.slice(-3)
    if (recents[1] > recents[0] && recents[2] > recents[1]) trends.push('CONSECUTIVE_GREEN')
  }

  if (trends.length > 0) trendWarning = trends.join(' ')

  // ── Base tier ─────────────────────────────────────────────────────────────
  let currentTier = getBaseTier(todayNavpu, effectiveAvgPrice, thresholds)
  let currentAmount = TIERS[currentTier].amount

  // ── Dip signal upgrade (single strongest only) ────────────────────────────
  const DIP_PRIORITY = ['STRONG_DROP', 'CONFIRMED_WEAKNESS', 'DROP_STABILIZATION']
  const strongestDip = DIP_PRIORITY.find((ds) => dipSignals.includes(ds))
  let dipUpgradeCount = 0

  if (strongestDip && currentTier !== 'PRIORITY_BUY') {
    currentTier = upgradeTier(currentTier)
    dipUpgradeCount = 1
    currentAmount = Math.min(currentAmount + 1000, 5000)
  }

  // Post-record minimum BUY_MORE (applies to dividend bucket, handled below)
  if (divCycle === 'POST_RECORD' && dailyChange <= -0.25) {
    const tierIdx = TIER_ORDER.indexOf(currentTier)
    const buyMoreIdx = TIER_ORDER.indexOf('BUY_MORE')
    if (tierIdx !== -1 && tierIdx < buyMoreIdx) {
      currentTier = 'BUY_MORE'
      currentAmount = Math.max(currentAmount, 3000)
    }
  }

  // ── Trend filter ──────────────────────────────────────────────────────────
  const downtrend = trends.includes('LOWER_HIGHS')
  if (downtrend && currentTier !== 'NO_BUY') {
    currentAmount = Math.max(1000, Math.round(currentAmount * 0.65))
  }
  if (currentTier === 'PRIORITY_BUY' && downtrend) {
    currentAmount = 3500
  }
  if (dipUpgradeCount === 0 && currentTier !== 'NO_BUY' && !downtrend) {
    currentAmount = TIERS[currentTier].amount
  }

  // ── WATCH_SKIP ────────────────────────────────────────────────────────────
  let finalSignal = currentTier
  if (currentTier === 'WATCH' && dipSignals.length === 0) {
    finalSignal = 'WATCH_SKIP'
    currentAmount = 0
  }

  // ── Bucket logic ──────────────────────────────────────────────────────────
  let isActionable = currentAmount > 0 && finalSignal !== 'NO_BUY' && finalSignal !== 'WATCH_SKIP'
  let isDividendBuy = false
  let bucket = null

  if (isActionable) {
    // Option B: extreme override only when NAVPU is already in cheap territory (below 30th pct)
    // A -0.50 drop from elevated NAVPU is a falling knife; from cheap levels it's a dislocation
    const isExtremeDrop = dailyChange <= -0.50 && (!thresholds || todayNavpu < thresholds.buyMoreThreshold)
    const isStrongDrop  = dailyChange <= -0.30
    const isPriorityBuy = finalSignal === 'PRIORITY_BUY'
    const inLockPeriod  = isDays1to5(todayStr)
    const meetsGap = lastOpportunityBuyDate === null ||
      tradingDaysBetween(lastOpportunityBuyDate, todayStr) >= 7

    // Quality filter for dividend: NAVPU must be below 60th percentile (watchThreshold)
    const qualityOk = !thresholds || todayNavpu < thresholds.watchThreshold
    const isDividendCondition =
      divCycle === 'POST_RECORD' &&
      dailyChange <= -0.25 &&
      !dividendBuyDoneThisMonth &&
      qualityOk

    if (isExtremeDrop) {
      // Bypass ALL rules including caps — true market dislocation
      bucket = 'extreme_override'
      if (!['BUY_MORE', 'AGGRESSIVE', 'PRIORITY_BUY'].includes(finalSignal)) {
        finalSignal = 'BUY_MORE'
        currentAmount = 3500
      }

    } else if (isDividendCondition) {
      // Dividend bucket: exempt from lock and gap
      isDividendBuy = true
      bucket = 'dividend'
      if (!['BUY_MORE', 'AGGRESSIVE', 'PRIORITY_BUY'].includes(finalSignal)) {
        finalSignal = 'BUY_MORE'
        currentAmount = 3500
      }

    } else {
      // Opportunity bucket
      bucket = 'opportunity'

      if (opportunityBuyCountThisMonth >= 2) {
        finalSignal = 'MONTHLY_CAP'
        currentAmount = 0
        isActionable = false

      } else if (isPriorityBuy || isStrongDrop) {
        // Bypass lock and gap — subject to opportunity cap (already checked above)

      } else {
        // Normal signal: enforce lock and gap
        if (inLockPeriod) {
          finalSignal = 'OPP_LOCKED'
          currentAmount = 0
          isActionable = false
        } else if (!meetsGap) {
          finalSignal = 'OPP_GAP_WAIT'
          currentAmount = 0
          isActionable = false
        }
      }
    }
  }

  // ── Recommendation text ───────────────────────────────────────────────────
  let recommendation = ''

  switch (finalSignal) {
    case 'NO_BUY':
      recommendation = 'NAVPU is in the no-buy zone. Hold and wait for a dip.'
      break
    case 'WATCH':
      recommendation = `Watch zone with dip signal (${dipSignals.join(', ')}). Small ₱${currentAmount.toLocaleString()} entry warranted. Monitor closely.`
      break
    case 'WATCH_SKIP':
      recommendation = 'Watch zone but no dip signal. Skip this entry and wait for a confirmed dip.'
      break
    case 'BUY':
      recommendation = `Standard buy signal. Consider ₱${currentAmount.toLocaleString()} at ₱${todayNavpu.toFixed(2)}. Place before 2 PM PH time.`
      break
    case 'BUY_MORE':
      recommendation = isDividendBuy
        ? `Post-dividend dip. Dividend bucket buy: ₱${currentAmount.toLocaleString()} at ₱${todayNavpu.toFixed(2)}.`
        : `Strong dip. Increase position by ₱${currentAmount.toLocaleString()} at ₱${todayNavpu.toFixed(2)}.`
      break
    case 'AGGRESSIVE':
      recommendation = `Aggressive dip. NAVPU deeply discounted at ₱${todayNavpu.toFixed(2)}. Deploy ₱${currentAmount.toLocaleString()}.`
      break
    case 'PRIORITY_BUY':
      recommendation = `NAVPU (₱${todayNavpu.toFixed(2)}) is BELOW your average price (₱${effectiveAvgPrice.toFixed(2)}). Invest ₱${currentAmount.toLocaleString()} to lower cost average.`
      break
    case 'OPP_LOCKED':
      recommendation = 'Opportunity buys are locked for Days 1-5 of the month. Wait until Day 6 unless a strong drop overrides.'
      break
    case 'OPP_GAP_WAIT':
      recommendation = `Minimum 7 trading days required between opportunity buys. Last buy: ${lastOpportunityBuyDate}. Hold.`
      break
    case 'MONTHLY_CAP':
      recommendation = 'Opportunity cap reached (2 buys this month). Resume next month.'
      break
    default:
      recommendation = 'Monitor and follow the strategy rules.'
  }

  if (staggerWarning) {
    recommendation += ' Extreme drop detected. Consider staggering into 2-3 smaller purchases over the next few days.'
  }
  if (trendWarning && trendWarning.includes('CONSECUTIVE_GREEN')) {
    recommendation += ' Caution: 2-3 consecutive green days with no dip signals. Do not chase momentum.'
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
    staggerEventDate: staggerWarning ? todayStr : null,
    recommendation,
    isActionable,
    isDividendBuy,
    bucket,
  }
}

module.exports = { analyzeSignal, getBaseTier, computeThresholds, AVG_PRICE }

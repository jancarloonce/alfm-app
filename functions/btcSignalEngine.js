'use strict'

const DEFAULT_AVG_COST = 60000

const TIERS = {
  NO_BUY:       { signal: 'NO_BUY',       amount: 0    },
  BUY:          { signal: 'BUY',          amount: 500  },
  BUY_MORE:     { signal: 'BUY_MORE',     amount: 750  },
  AGGRESSIVE:   { signal: 'AGGRESSIVE',   amount: 1000 },
  PRIORITY_BUY: { signal: 'PRIORITY_BUY', amount: 1000 },
}

const MIN_BUY_PHP = 500
const MAX_BUY_PHP = 1000

const TIER_ORDER = ['NO_BUY', 'BUY', 'BUY_MORE', 'AGGRESSIVE']

const DRAWDOWN_TIERS = {
  NO_BUY:     3,
  BUY:        5,
  BUY_MORE:  10,
  AGGRESSIVE: 15,
}

const RSI_BANDS = {
  OVERBOUGHT: 70,
  OVERSOLD:   30,
}

const FEAR_GREED_BANDS = {
  EXTREME_FEAR:  25,
  FEAR:          45,
  NEUTRAL_LOW:   55,
  GREED:         75,
}

const MIN_HOURS_GAP           = 1
const MONTHLY_BUDGET_PHP      = 10000
const MACRO_DRAWDOWN_THRESHOLD = 0.25
const MACRO_AMOUNT_REDUCTION   = 0.60
const MAX_EXTREME_OVERRIDES_24H = 2

const DIP_THRESHOLDS = {
  EXTREME_DROP_PCT: -4.00,
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function hoursDiff(aIso, bIso) {
  return (new Date(bIso) - new Date(aIso)) / (1000 * 60 * 60)
}

function upgradeTier(tier) {
  if (tier === 'PRIORITY_BUY') return 'PRIORITY_BUY'
  const idx = TIER_ORDER.indexOf(tier)
  if (idx === -1 || idx === TIER_ORDER.length - 1) return tier
  return TIER_ORDER[idx + 1]
}

function downgradeTier(tier) {
  if (tier === 'PRIORITY_BUY') return 'AGGRESSIVE'
  const idx = TIER_ORDER.indexOf(tier)
  if (idx <= 0) return 'NO_BUY'
  return TIER_ORDER[idx - 1]
}

// ─────────────────────────────────────────────────────────────────────────────
// computeDrawdown — primary signal driver
// ─────────────────────────────────────────────────────────────────────────────

function computeDrawdown(closes, lookback = 720) {
  if (!closes || closes.length < 2) return { drawdownPct: 0, drawdownHigh: closes?.[0] ?? 0 }

  const window = closes.slice(-lookback)
  const drawdownHigh = Math.max(...window)
  const currentPrice = closes[closes.length - 1]
  const drawdownPct = drawdownHigh > 0
    ? parseFloat(((drawdownHigh - currentPrice) / drawdownHigh * 100).toFixed(3))
    : 0

  return { drawdownPct, drawdownHigh }
}

// ─────────────────────────────────────────────────────────────────────────────
// getDrawdownTier — maps drawdown % to buy tier
// ─────────────────────────────────────────────────────────────────────────────

function getDrawdownTier(drawdownPct) {
  if (drawdownPct < DRAWDOWN_TIERS.NO_BUY)     return 'NO_BUY'
  if (drawdownPct < DRAWDOWN_TIERS.BUY)         return 'BUY'
  if (drawdownPct < DRAWDOWN_TIERS.BUY_MORE)    return 'BUY_MORE'
  if (drawdownPct < DRAWDOWN_TIERS.AGGRESSIVE)  return 'AGGRESSIVE'
  return 'PRIORITY_BUY'
}

// ─────────────────────────────────────────────────────────────────────────────
// applyFearGreed
// ─────────────────────────────────────────────────────────────────────────────

function applyFearGreed(amount, fearGreed) {
  if (fearGreed == null) return { adjustedAmount: amount, fearGreedLabel: 'N/A' }

  let multiplier = 1.0
  let fearGreedLabel = 'NEUTRAL'

  if      (fearGreed <= FEAR_GREED_BANDS.EXTREME_FEAR) { multiplier = 1.5; fearGreedLabel = 'EXTREME_FEAR'  }
  else if (fearGreed <= FEAR_GREED_BANDS.FEAR)          { multiplier = 1.2; fearGreedLabel = 'FEAR'          }
  else if (fearGreed <= FEAR_GREED_BANDS.NEUTRAL_LOW)   { multiplier = 1.0; fearGreedLabel = 'NEUTRAL'       }
  else if (fearGreed <= FEAR_GREED_BANDS.GREED)         { multiplier = 0.8; fearGreedLabel = 'GREED'         }
  else                                                   { multiplier = 0.5; fearGreedLabel = 'EXTREME_GREED' }

  const rounded = Math.round((amount * multiplier) / 50) * 50
  const adjustedAmount = Math.min(Math.max(rounded, amount > 0 ? MIN_BUY_PHP : 0), MAX_BUY_PHP)

  return { adjustedAmount, fearGreedLabel }
}

// ─────────────────────────────────────────────────────────────────────────────
// analyzeSignal — main entry point (drawdown-based)
// ─────────────────────────────────────────────────────────────────────────────

function analyzeSignal({
  currentPrice,
  prevHourPrice,
  avgCost,
  totalSpentThisMonth = 0,
  lastOpportunityBuyTimestamp = null,
  nowIso,
  closes = [],
  rsi = null,
  fearGreedIndex = null,
  volumeRatio = null,
  high90d = null,
  extremeOverrideCount24h = 0,
}) {
  const effectiveAvgCost = avgCost || DEFAULT_AVG_COST

  const hourlyChange = prevHourPrice != null
    ? parseFloat((currentPrice - prevHourPrice).toFixed(2))
    : 0

  const hourlyChangePct = prevHourPrice != null
    ? parseFloat(((hourlyChange / prevHourPrice) * 100).toFixed(3))
    : 0

  const vsAvg =
    currentPrice < effectiveAvgCost ? 'BELOW_AVG' :
    currentPrice > effectiveAvgCost ? 'ABOVE_AVG' : 'AT_AVG'

  // ── Drawdown computation (primary signal) ──────────────────────────────
  const { drawdownPct, drawdownHigh } = computeDrawdown(closes, 720)

  // ── Base tier from drawdown ────────────────────────────────────────────
  let currentTier = getDrawdownTier(drawdownPct)

  let currentAmount = TIERS[currentTier].amount

  // ── RSI modifier ──────────────────────────────────────────────────────
  let rsiLabel = 'N/A'
  if (rsi != null) {
    if (rsi < RSI_BANDS.OVERSOLD) {
      rsiLabel = 'OVERSOLD'
      if (currentTier !== 'PRIORITY_BUY') {
        currentTier = upgradeTier(currentTier)
        currentAmount = TIERS[currentTier].amount
      }
    } else if (rsi > RSI_BANDS.OVERBOUGHT) {
      rsiLabel = 'OVERBOUGHT'
      currentTier = downgradeTier(currentTier)
      currentAmount = TIERS[currentTier].amount
    } else {
      rsiLabel = 'NEUTRAL'
    }
  }

  // ── Macro drawdown kill-switch ─────────────────────────────────────────
  let macroDrawdownActive = false
  if (high90d != null && high90d > 0) {
    const drawdownFromHigh90 = (high90d - currentPrice) / high90d
    if (drawdownFromHigh90 >= MACRO_DRAWDOWN_THRESHOLD) {
      macroDrawdownActive = true
      if (currentTier === 'AGGRESSIVE') currentTier = 'BUY_MORE'
      if (currentAmount > 0) {
        currentAmount = Math.max(MIN_BUY_PHP, Math.round(currentAmount * MACRO_AMOUNT_REDUCTION / 50) * 50)
      }
    }
  }

  let finalSignal = currentTier

  // ── Fear & Greed amount scaling ────────────────────────────────────────
  const { adjustedAmount, fearGreedLabel } = applyFearGreed(currentAmount, fearGreedIndex)
  currentAmount = adjustedAmount

  // ── Bucket / rate-limiting logic ───────────────────────────────────────
  let isActionable = currentAmount > 0 && finalSignal !== 'NO_BUY'
  let bucket = null

  if (isActionable) {
    const isExtremeDrop = hourlyChangePct <= DIP_THRESHOLDS.EXTREME_DROP_PCT

    const meetsGap = lastOpportunityBuyTimestamp === null ||
      hoursDiff(lastOpportunityBuyTimestamp, nowIso) >= MIN_HOURS_GAP

    if (isExtremeDrop) {
      if (extremeOverrideCount24h >= MAX_EXTREME_OVERRIDES_24H) {
        bucket = 'opportunity'
      } else {
        bucket = 'extreme_override'
        if (!['BUY_MORE', 'AGGRESSIVE', 'PRIORITY_BUY'].includes(finalSignal)) {
          finalSignal = 'BUY_MORE'
          currentAmount = TIERS['BUY_MORE'].amount
        }
      }
    } else {
      bucket = 'opportunity'

      const wouldExceedBudget = totalSpentThisMonth + currentAmount > MONTHLY_BUDGET_PHP

      if (wouldExceedBudget) {
        const remaining = MONTHLY_BUDGET_PHP - totalSpentThisMonth
        if (remaining >= MIN_BUY_PHP) {
          currentAmount = Math.floor(remaining / 50) * 50
        } else {
          finalSignal = 'BUDGET_CAP'
          currentAmount = 0
          isActionable = false
        }
      } else if (finalSignal === 'PRIORITY_BUY' || isExtremeDrop) {
        // Strong conviction — bypass gap rule
      } else if (!meetsGap) {
        finalSignal = 'OPP_GAP_WAIT'
        currentAmount = 0
        isActionable = false
      }
    }
  }

  // ── Recommendation text ────────────────────────────────────────────────
  const priceStr  = `$${currentPrice.toLocaleString()}`
  const amountStr = `₱${currentAmount.toLocaleString()}`
  const ddStr     = `${drawdownPct.toFixed(1)}%`

  let recommendation = ''
  switch (finalSignal) {
    case 'NO_BUY':
      recommendation = `BTC at ${priceStr} is ${ddStr} off 30d high — not enough drawdown. Hold cash.`
      break
    case 'BUY':
      recommendation = `Drawdown ${ddStr}. Consider ${amountStr} at ${priceStr}.`
      break
    case 'BUY_MORE':
      recommendation = `Drawdown ${ddStr} — solid dip. Buy ${amountStr} at ${priceStr}.`
      break
    case 'AGGRESSIVE':
      recommendation = `BTC is ${ddStr} below 30d high at ${priceStr}. Deploy ${amountStr} aggressively.`
      break
    case 'PRIORITY_BUY':
      recommendation = `BTC is ${ddStr} below 30d high at ${priceStr}. Priority buy ${amountStr}.`
      break
    case 'OPP_GAP_WAIT':
      recommendation = `Buy already recorded this hour. Next check in ~1 hour.`
      break
    case 'BUDGET_CAP':
      recommendation = `Monthly budget reached (₱${MONTHLY_BUDGET_PHP.toLocaleString()} spent). No more buys until next month.`
      break
    default:
      recommendation = 'Monitor and follow the strategy rules.'
  }

  if (rsiLabel === 'OVERBOUGHT') {
    recommendation += ' RSI overbought (>70) — tier downgraded.'
  }
  if (rsiLabel === 'OVERSOLD') {
    recommendation += ' RSI oversold (<30) — tier upgraded. Bounce conditions present.'
  }
  if (fearGreedLabel === 'EXTREME_GREED') {
    recommendation += ' Extreme Greed — amount scaled down to 50%.'
  }
  if (fearGreedLabel === 'EXTREME_FEAR') {
    recommendation += ' Extreme Fear — amount scaled up to 150%. Panic often = opportunity.'
  }
  if (macroDrawdownActive) {
    recommendation += ` MACRO DRAWDOWN: BTC is >25% below 90d high — buy sizes reduced to ${Math.round(MACRO_AMOUNT_REDUCTION * 100)}%.`
  }

  return {
    signal:      finalSignal,
    amount:      currentAmount,
    isActionable,
    bucket,

    currentPrice,
    avgCost:     effectiveAvgCost,
    vsAvg,
    hourlyChange,
    hourlyChangePct,

    drawdownPct,
    drawdownHigh,

    rsi:           rsi ?? null,
    rsiLabel,
    fearGreedIndex: fearGreedIndex ?? null,
    fearGreedLabel,
    volumeRatio:   volumeRatio ?? null,

    high90d:            high90d ?? null,
    macroDrawdownActive,
    extremeOverrideCount24h,

    recommendation,
  }
}

module.exports = {
  analyzeSignal,
  computeDrawdown,
  getDrawdownTier,
  applyFearGreed,
  hoursDiff,
  DEFAULT_AVG_COST,
  TIERS,
  TIER_ORDER,
  DRAWDOWN_TIERS,
  RSI_BANDS,
  FEAR_GREED_BANDS,
  MIN_HOURS_GAP,
  MONTHLY_BUDGET_PHP,
  MIN_BUY_PHP,
  MAX_BUY_PHP,
}

'use strict'

/**
 * BTC Buy Signal Engine — Hourly Candle Edition
 * -----------------------------------------------
 * Pure function: no Firebase dependencies.
 * All inputs are passed as parameters; returns a signal object.
 *
 * Timeframe: HOURLY candles (1h OHLCV from Binance/CoinGecko)
 * Buy amounts: PHP (₱10,000/month total budget)
 * Price inputs: USD (BTC/USDT standard pair)
 *
 * Why hourly vs daily:
 *   BTC can swing ±5–10% within hours. A daily engine running once at 4 PM
 *   would miss intraday dips that recover before close. Hourly candles let us
 *   catch those windows and act on them the same hour they appear.
 *
 * Hourly calibration vs daily calibration:
 *   Daily STRONG_DROP threshold (-3%) ÷ ~24 ≈ -0.125%/hr on average, but
 *   BTC volatility is fat-tailed — spikes cluster. Empirically, a -1.5% move
 *   in a single hour is a meaningful dip (top ~5% of negative hourly moves).
 *   See DIP_THRESHOLDS below for full mapping.
 *
 * Rolling window:
 *   Uses last 720 candles (30 days × 24 hours) for threshold computation —
 *   same percentile logic as the ALFM 90-day daily window, just hourly granularity.
 *
 * Budget design (₱10,000/month hard cap, ₱500–₱1,000 per buy):
 *   The engine buys on every actionable hourly signal. The only throttle is the
 *   monthly PHP budget — once totalSpentThisMonth + thisBuy would exceed
 *   MONTHLY_BUDGET_PHP the signal becomes BUDGET_CAP. No fixed buy-count limit.
 *
 *   Tier amounts: WATCH=₱500, BUY=₱500, BUY_MORE=₱750, AGGRESSIVE=₱1,000,
 *   PRIORITY_BUY=₱1,000. Fear & Greed scaling stays but is clamped to the
 *   ₱500–₱1,000 range so a single buy never exceeds the max.
 *
 * Bucket system:
 *   OPPORTUNITY BUCKET (budget-gated, no fixed count):
 *     Normal signals: subject to 1-hour gap (prevents same-hour duplicate buys).
 *     PRIORITY_BUY and STRONG_DROP: bypass gap rule.
 *     EXTREME_DROP: bypasses ALL rules including the budget cap.
 *
 * Optional modifiers (all nullable — pass null to skip):
 *   rsi          — RSI(14) on hourly candles: <30 upgrades tier, >70 downgrades
 *   fearGreedIndex — Crypto Fear & Greed Index (0–100): scales amount up/down
 *   volumeRatio  — current hour volume / 30-day hourly avg: <0.8 cancels STRONG_DROP
 */

// ── Default avg cost basis ────────────────────────────────────────────────────
// User's average BTC purchase price in USD. Update to your actual cost basis.
const DEFAULT_AVG_COST = 60000  // USD

// ── Tier definitions: signal label + PHP buy amount ──────────────────────────
// All amounts sit within the ₱500–₱1,000 per-buy range.
// Min ₱500 keeps every entry meaningful; max ₱1,000 caps exposure per signal.
/**
 * @typedef {'NO_BUY'|'WATCH'|'BUY'|'BUY_MORE'|'AGGRESSIVE'|'PRIORITY_BUY'} TierName
 */
const TIERS = {
  NO_BUY:       { signal: 'NO_BUY',       amount: 0    },
  WATCH:        { signal: 'WATCH',        amount: 500  },   // small watch entry
  BUY:          { signal: 'BUY',          amount: 500  },   // standard DCA
  BUY_MORE:     { signal: 'BUY_MORE',     amount: 750  },   // confirmed dip
  AGGRESSIVE:   { signal: 'AGGRESSIVE',   amount: 1000 },   // deep discount
  PRIORITY_BUY: { signal: 'PRIORITY_BUY', amount: 1000 },   // below avg cost
}

// Per-buy PHP bounds — Fear & Greed scaling is clamped within these.
const MIN_BUY_PHP = 500
const MAX_BUY_PHP = 1000

const TIER_ORDER = ['NO_BUY', 'WATCH', 'BUY', 'BUY_MORE', 'AGGRESSIVE']

// ── Hourly dip thresholds (%) ─────────────────────────────────────────────────
// Calibrated for 1h BTC/USDT candles. BTC's hourly distribution is fat-tailed:
//   - Top 5% of negative hours: ~ -1.5% or worse  → STRONG_DROP
//   - Top 1% of negative hours: ~ -4.0% or worse  → EXTREME_DROP
//   - Two consecutive -1.5% hours compounds to ~-3% → CONFIRMED_WEAKNESS net threshold
// NOISE_PCT filters micro-moves that carry no signal (spread noise, thin liquidity).
const DIP_THRESHOLDS = {
  NOISE_PCT:              0.30,   // abs hourly change below this is ignored
  STRONG_DROP_PCT:       -1.50,   // single-hour drop → STRONG_DROP
  EXTREME_DROP_PCT:      -4.00,   // single-hour drop → EXTREME_DROP (bypasses all rules)
  CONFIRMED_WEAKNESS_NET:-2.50,   // 2-hour net decline → CONFIRMED_WEAKNESS
  STAGGER_WARNING_PCT:   -4.00,   // same as extreme — triggers stagger recommendation
}

// ── Baseline thresholds (USD) ─────────────────────────────────────────────────
// Used as a floor when 720-candle dynamic percentiles drift too far down.
// Review and update every 1–2 months to reflect current BTC price regime.
const BASELINE_THRESHOLDS = {
  noBuyThreshold:   70000,   // 75th pct fallback
  watchThreshold:   65000,   // 60th pct fallback
  buyThreshold:     60000,   // 45th pct fallback
  buyMoreThreshold: 55000,   // 30th pct fallback
}

// ── RSI interpretation bands (hourly RSI-14) ─────────────────────────────────
const RSI_BANDS = {
  OVERBOUGHT: 70,   // downgrade tier one level
  OVERSOLD:   30,   // upgrade tier one level
}

// ── Fear & Greed index bands (0–100, standard crypto index) ──────────────────
// Fetched once per day — daily cadence is fine since it's a slow-moving index.
const FEAR_GREED_BANDS = {
  EXTREME_FEAR:  25,   // ×1.5 amount
  FEAR:          45,   // ×1.2 amount
  NEUTRAL_LOW:   55,   // ×1.0 (no change)
  GREED:         75,   // ×0.8 amount
  // above 75 (Extreme Greed): ×0.5 amount
}

// ── Rate-limiting constants ───────────────────────────────────────────────────
// GAP: 1 hour minimum between buys — just enough to prevent a duplicate buy if
//   the function is retried or fires twice in the same hour. Since the signal
//   runs hourly and the user wants to buy on each actionable signal, this is
//   intentionally loose.
// BUDGET: hard monthly PHP cap. Once totalSpentThisMonth + thisBuyAmount would
//   exceed this, the signal becomes BUDGET_CAP and no email is sent.
const MIN_HOURS_GAP           = 1      // prevent same-hour duplicates only
const MONTHLY_BUDGET_PHP      = 10000  // ₱10,000/month hard cap
const MACRO_DRAWDOWN_THRESHOLD = 0.25  // >25% below 90d high → kill-switch activates
const MACRO_AMOUNT_REDUCTION   = 0.60  // reduce all buy amounts to 60% during macro drawdown
const MAX_EXTREME_OVERRIDES_24H = 2    // cap extreme_override bucket to 2 per 24-hour window

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hours elapsed from ISO timestamp A to ISO timestamp B.
 * @param {string} aIso  ISO 8601 datetime string (last buy timestamp)
 * @param {string} bIso  ISO 8601 datetime string (now)
 * @returns {number}
 */
function hoursDiff(aIso, bIso) {
  return (new Date(bIso) - new Date(aIso)) / (1000 * 60 * 60)
}

/**
 * Advance a tier up one level in TIER_ORDER. PRIORITY_BUY is the ceiling.
 * @param {TierName} tier
 * @returns {TierName}
 */
function upgradeTier(tier) {
  if (tier === 'PRIORITY_BUY') return 'PRIORITY_BUY'
  const idx = TIER_ORDER.indexOf(tier)
  if (idx === -1 || idx === TIER_ORDER.length - 1) return tier
  return TIER_ORDER[idx + 1]
}

/**
 * Downgrade a tier one level. NO_BUY is the floor.
 * PRIORITY_BUY drops to AGGRESSIVE (RSI overbought tempers even below-cost buys).
 * @param {TierName} tier
 * @returns {TierName}
 */
function downgradeTier(tier) {
  if (tier === 'PRIORITY_BUY') return 'AGGRESSIVE'
  const idx = TIER_ORDER.indexOf(tier)
  if (idx <= 0) return 'NO_BUY'
  return TIER_ORDER[idx - 1]
}

// ─────────────────────────────────────────────────────────────────────────────
// computeThresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute dynamic buy zone thresholds from a chronological array of BTC
 * hourly close prices (USD).
 *
 * Uses the same percentile algorithm as the ALFM daily engine, applied to
 * the last 720 candles (30 days of hourly data):
 *
 *   noBuyThreshold   = 75th percentile  → price is expensive, hold cash
 *   watchThreshold   = 60th percentile  → slightly elevated, watch
 *   buyThreshold     = 45th percentile  → below median, reasonable entry
 *   buyMoreThreshold = 30th percentile  → clear discount zone
 *   below buyMoreThreshold              → AGGRESSIVE
 *
 * Stability guard: if any computed threshold is more than 30% below the
 * window mean (sustained downtrend), fall back to BASELINE_THRESHOLDS to
 * avoid the engine treating deeply depressed prices as "normal" cheap.
 *
 * @param {number[]} pricesChronological  Hourly close prices, oldest first.
 * @returns {object|null}  Threshold object, or null if fewer than 5 candles.
 */
function computeThresholds(pricesChronological) {
  const clean = pricesChronological.filter((v) => v != null && !isNaN(v))
  const window720 = clean.slice(-720)   // 30 days × 24 hours
  const sorted = [...window720].sort((a, b) => a - b)
  const n = sorted.length

  if (n < 5) return null

  function percentile(p) {
    const idx = (p / 100) * (n - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return parseFloat((sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])).toFixed(2))
  }

  const mean720 = parseFloat((sorted.reduce((a, b) => a + b, 0) / n).toFixed(2))
  const MAX_DRIFT_RATIO = 0.30

  const computed = {
    noBuyThreshold:   parseFloat(percentile(75).toFixed(2)),
    watchThreshold:   parseFloat(percentile(60).toFixed(2)),
    buyThreshold:     parseFloat(percentile(45).toFixed(2)),
    buyMoreThreshold: parseFloat(percentile(30).toFixed(2)),
  }

  const drifted = Object.keys(computed).some(
    (k) => computed[k] < mean720 * (1 - MAX_DRIFT_RATIO)
  )
  const finalThresholds = drifted ? BASELINE_THRESHOLDS : computed

  return {
    ...finalThresholds,
    usingBaseline: drifted,
    periodHigh:    parseFloat(Math.max(...sorted).toFixed(2)),
    periodLow:     parseFloat(Math.min(...sorted).toFixed(2)),
    mean:          mean720,
    dataPoints:    n,
    windowCandles: 720,
    computedAt:    new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getBaseTier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine the base signal tier from the current BTC price.
 *
 * PRIORITY_BUY fires when price drops below the user's average cost — this
 * is the strongest DCA signal and overrides all zone thresholds.
 *
 * @param {number}      price       Current BTC price (USD).
 * @param {number}      avgCost     User's average cost basis (USD).
 * @param {object|null} thresholds  Output of computeThresholds(), or null.
 * @returns {TierName}
 */
function getBaseTier(price, avgCost, thresholds) {
  const ap = avgCost || DEFAULT_AVG_COST

  if (price < ap) return 'PRIORITY_BUY'

  if (thresholds) {
    if (price >= thresholds.noBuyThreshold)   return 'NO_BUY'
    if (price >= thresholds.watchThreshold)   return 'WATCH'
    if (price >= thresholds.buyThreshold)     return 'BUY'
    if (price >= thresholds.buyMoreThreshold) return 'BUY_MORE'
    return 'AGGRESSIVE'
  }

  if (price >= BASELINE_THRESHOLDS.noBuyThreshold)   return 'NO_BUY'
  if (price >= BASELINE_THRESHOLDS.watchThreshold)   return 'WATCH'
  if (price >= BASELINE_THRESHOLDS.buyThreshold)     return 'BUY'
  if (price >= BASELINE_THRESHOLDS.buyMoreThreshold) return 'BUY_MORE'
  return 'AGGRESSIVE'
}

// ─────────────────────────────────────────────────────────────────────────────
// applyFearGreed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scale the PHP buy amount based on the Crypto Fear & Greed Index (0–100).
 *
 * Fear historically correlates with local bottoms; greed with local tops.
 * This is a secondary amount modifier — the tier system drives signal direction.
 * Rounded to nearest ₱100 for clean amounts.
 *
 * Multipliers:
 *   0–25   Extreme Fear  → ×1.5
 *   26–45  Fear          → ×1.2
 *   46–55  Neutral       → ×1.0
 *   56–75  Greed         → ×0.8
 *   76–100 Extreme Greed → ×0.5
 *
 * @param {number}      amount      Base buy amount (PHP).
 * @param {number|null} fearGreed   Fear & Greed value, or null to skip.
 * @returns {{ adjustedAmount: number, fearGreedLabel: string }}
 */
function applyFearGreed(amount, fearGreed) {
  if (fearGreed == null) return { adjustedAmount: amount, fearGreedLabel: 'N/A' }

  let multiplier = 1.0
  let fearGreedLabel = 'NEUTRAL'

  if      (fearGreed <= FEAR_GREED_BANDS.EXTREME_FEAR) { multiplier = 1.5; fearGreedLabel = 'EXTREME_FEAR'  }
  else if (fearGreed <= FEAR_GREED_BANDS.FEAR)          { multiplier = 1.2; fearGreedLabel = 'FEAR'          }
  else if (fearGreed <= FEAR_GREED_BANDS.NEUTRAL_LOW)   { multiplier = 1.0; fearGreedLabel = 'NEUTRAL'       }
  else if (fearGreed <= FEAR_GREED_BANDS.GREED)         { multiplier = 0.8; fearGreedLabel = 'GREED'         }
  else                                                   { multiplier = 0.5; fearGreedLabel = 'EXTREME_GREED' }

  // Round to nearest ₱50, then clamp to [MIN_BUY_PHP, MAX_BUY_PHP]
  const rounded = Math.round((amount * multiplier) / 50) * 50
  const adjustedAmount = Math.min(Math.max(rounded, amount > 0 ? MIN_BUY_PHP : 0), MAX_BUY_PHP)

  return { adjustedAmount, fearGreedLabel }
}

// ─────────────────────────────────────────────────────────────────────────────
// analyzeSignal — main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main BTC hourly signal analysis function.
 *
 * SIGNAL TIERS (weakest → strongest):
 *   NO_BUY        — price too high relative to 30-day range, hold cash
 *   WATCH_SKIP    — watch zone but no confirming hourly dip signal
 *   WATCH         — watch zone + dip signal, small ₱500 entry
 *   BUY           — standard buy zone, ₱1,500
 *   BUY_MORE      — confirmed dip, ₱2,500
 *   AGGRESSIVE    — deep discount, ₱3,000
 *   PRIORITY_BUY  — price below your avg cost basis, ₱3,000
 *
 * OVERRIDE / THROTTLE SIGNALS:
 *   OPP_GAP_WAIT  — fewer than 1h since last buy (duplicate prevention)
 *   BUDGET_CAP    — adding this buy would exceed ₱10,000 monthly budget
 *   extreme_override bucket — EXTREME_DROP bypasses all throttles including budget cap
 *
 * HOURLY DIP SIGNALS (percentage-based):
 *   STRONG_DROP         — this hour's close fell ≥ 1.5% vs previous hour
 *   CONFIRMED_WEAKNESS  — 2 consecutive declining hours, net ≥ -2.5%
 *   DROP_STABILIZATION  — previous hour ≥ -1.5%, current abs move ≤ 0.3% (base forming)
 *
 * TREND SIGNALS (last 24 hourly candles):
 *   LOWER_HIGHS         — ≥18 of 24 hours declining OR net 24h drop ≥ -5%
 *   CONSECUTIVE_GREEN   — 3 consecutive up hours with no dip signals (caution)
 *
 * OPTIONAL MODIFIERS (pass null to skip any):
 *   rsi (hourly RSI-14):   <30 upgrades tier, >70 downgrades tier
 *   fearGreedIndex:        daily index, scales PHP amount ×0.5–×1.5
 *   volumeRatio:           this hour / 30-day hourly avg; <0.8 cancels STRONG_DROP
 *
 * @param {object}      params
 * @param {number}      params.currentPrice               Current hourly close (USD)
 * @param {number}      params.prevHourPrice              Previous hour close (USD)
 * @param {number}      params.twoHoursAgoPrice           Two hours ago close (USD)
 * @param {number[]}    params.last24Prices               Last 24 hourly closes, oldest first
 * @param {number}      params.avgCost                    User's avg cost basis (USD)
 * @param {number}      params.totalSpentThisMonth           Total PHP spent on BTC this calendar month
 * @param {string|null} params.lastOpportunityBuyTimestamp   ISO timestamp of last opportunity buy
 * @param {string}      params.nowIso                     Current datetime as ISO string
 * @param {object|null} params.thresholds                 Output of computeThresholds(), or null
 * @param {number|null} [params.rsi]                      Hourly RSI(14), or null to skip
 * @param {number|null} [params.fearGreedIndex]           Fear & Greed index 0–100, or null to skip
 * @param {number|null} [params.volumeRatio]              This hour vol / 30d avg vol, or null to skip
 * @param {number|null} [params.high90d]                  Highest close over last 2,160 candles (90d), or null to skip
 * @param {number}      [params.extremeOverrideCount24h]  How many extreme_override buys fired in last 24h
 *
 * @returns {object}  Signal result (see return statement for full shape)
 */
function analyzeSignal({
  currentPrice,
  prevHourPrice,
  twoHoursAgoPrice,
  last24Prices,
  avgCost,
  totalSpentThisMonth = 0,
  lastOpportunityBuyTimestamp = null,
  nowIso,
  thresholds = null,
  rsi = null,
  fearGreedIndex = null,
  volumeRatio = null,
  high90d = null,
  extremeOverrideCount24h = 0,
}) {
  const effectiveAvgCost = avgCost || DEFAULT_AVG_COST

  // ── Hourly change ───────────────────────────────────────────────────────────
  const hourlyChange = prevHourPrice != null
    ? parseFloat((currentPrice - prevHourPrice).toFixed(2))
    : 0

  const hourlyChangePct = prevHourPrice != null
    ? parseFloat(((hourlyChange / prevHourPrice) * 100).toFixed(3))
    : 0

  const vsAvg =
    currentPrice < effectiveAvgCost ? 'BELOW_AVG' :
    currentPrice > effectiveAvgCost ? 'ABOVE_AVG' : 'AT_AVG'

  // ── Noise filter ────────────────────────────────────────────────────────────
  const isNoise = Math.abs(hourlyChangePct) < DIP_THRESHOLDS.NOISE_PCT

  // ── Hourly dip signal detection ─────────────────────────────────────────────
  const dipSignals = []
  let staggerWarning = false

  if (!isNoise) {
    if (hourlyChangePct <= DIP_THRESHOLDS.STRONG_DROP_PCT) {
      dipSignals.push('STRONG_DROP')
    }

    // 2 consecutive declining hours with meaningful net loss
    if (
      twoHoursAgoPrice != null && prevHourPrice != null &&
      prevHourPrice < twoHoursAgoPrice && currentPrice < prevHourPrice
    ) {
      const netPct = ((currentPrice - twoHoursAgoPrice) / twoHoursAgoPrice) * 100
      if (netPct <= DIP_THRESHOLDS.CONFIRMED_WEAKNESS_NET) {
        dipSignals.push('CONFIRMED_WEAKNESS')
      }
    }

    // Previous hour had a big drop; this hour is flat — possible base forming
    if (prevHourPrice != null && twoHoursAgoPrice != null) {
      const prevPct = ((prevHourPrice - twoHoursAgoPrice) / twoHoursAgoPrice) * 100
      if (
        prevPct <= DIP_THRESHOLDS.STRONG_DROP_PCT &&
        Math.abs(hourlyChangePct) <= DIP_THRESHOLDS.NOISE_PCT
      ) {
        dipSignals.push('DROP_STABILIZATION')
      }
    }

    if (hourlyChangePct <= DIP_THRESHOLDS.STAGGER_WARNING_PCT) {
      staggerWarning = true
    }
  }

  // ── Volume confirmation ─────────────────────────────────────────────────────
  // Low-volume drops are often illiquid wicks, not genuine selling pressure.
  // If volume is below 80% of the 30-day hourly average, STRONG_DROP is removed.
  let volumeWarning = false
  if (volumeRatio != null && volumeRatio < 0.8 && dipSignals.includes('STRONG_DROP')) {
    dipSignals.splice(dipSignals.indexOf('STRONG_DROP'), 1)
    volumeWarning = true
  }

  // ── Trend detection (last 24 hourly candles) ────────────────────────────────
  const trends = []
  let trendWarning = null

  if (last24Prices && last24Prices.length >= 12) {
    const recents = last24Prices.slice(-24)
    let lowerCount = 0
    for (let i = 1; i < recents.length; i++) {
      if (recents[i] < recents[i - 1]) lowerCount++
    }
    const netPct24h = ((recents[recents.length - 1] - recents[0]) / recents[0]) * 100
    // ≥75% of last 24 hours declining, or net 24h decline of -5%+
    if (lowerCount >= Math.ceil(recents.length * 0.75) || netPct24h <= -5) {
      trends.push('LOWER_HIGHS')
    }
  }

  if (last24Prices && last24Prices.length >= 3 && dipSignals.length === 0) {
    const recents = last24Prices.slice(-3)
    if (recents[1] > recents[0] && recents[2] > recents[1]) {
      trends.push('CONSECUTIVE_GREEN')
    }
  }

  if (trends.length > 0) trendWarning = trends.join(' ')

  // ── Base tier ───────────────────────────────────────────────────────────────
  let currentTier = getBaseTier(currentPrice, effectiveAvgCost, thresholds)
  let currentAmount = TIERS[currentTier].amount

  // ── RSI modifier ────────────────────────────────────────────────────────────
  // Applied before dip upgrade so dip signals can still lift an RSI-downgraded tier.
  let rsiLabel = 'N/A'
  if (rsi != null) {
    if (rsi < RSI_BANDS.OVERSOLD) {
      rsiLabel = 'OVERSOLD'
      if (currentTier !== 'PRIORITY_BUY') {
        currentTier = upgradeTier(currentTier)
        currentAmount = Math.min(currentAmount + 500, 3000)
      }
    } else if (rsi > RSI_BANDS.OVERBOUGHT) {
      rsiLabel = 'OVERBOUGHT'
      currentTier = downgradeTier(currentTier)
      currentAmount = Math.max(currentAmount - 500, 0)
    } else {
      rsiLabel = 'NEUTRAL'
    }
  }

  // ── Dip signal tier upgrade ─────────────────────────────────────────────────
  // Only the strongest dip signal applies (no double-stacking upgrades).
  const DIP_PRIORITY = ['STRONG_DROP', 'CONFIRMED_WEAKNESS', 'DROP_STABILIZATION']
  const strongestDip = DIP_PRIORITY.find((ds) => dipSignals.includes(ds))
  let dipUpgradeApplied = false

  if (strongestDip && currentTier !== 'PRIORITY_BUY') {
    currentTier = upgradeTier(currentTier)
    dipUpgradeApplied = true
    currentAmount = Math.min(currentAmount + 500, 3000)
  }

  // ── Downtrend amount reduction ──────────────────────────────────────────────
  // In a 24h downtrend, reduce position size to avoid catching a falling knife.
  // PRIORITY_BUY is capped at ₱2,000 during a downtrend (still DCA, just smaller).
  const downtrend = trends.includes('LOWER_HIGHS')
  if (downtrend && currentTier !== 'NO_BUY') {
    currentAmount = Math.max(500, Math.round(currentAmount * 0.65 / 100) * 100)
  }
  if (currentTier === 'PRIORITY_BUY' && downtrend) {
    currentAmount = 2000
  }
  if (!dipUpgradeApplied && currentTier !== 'NO_BUY' && !downtrend) {
    currentAmount = TIERS[currentTier].amount
  }

  // ── Macro drawdown kill-switch ──────────────────────────────────────────────
  // If BTC is more than 25% below its 90-day high, we're in a macro downtrend.
  // Reduce all buy amounts to 60% and disable the AGGRESSIVE tier — avoid
  // deploying full size into a sustained multi-week bleed.
  let macroDrawdownActive = false
  if (high90d != null && high90d > 0) {
    const drawdownFromHigh = (high90d - currentPrice) / high90d
    if (drawdownFromHigh >= MACRO_DRAWDOWN_THRESHOLD) {
      macroDrawdownActive = true
      if (currentTier === 'AGGRESSIVE') currentTier = 'BUY_MORE'
      if (currentAmount > 0) {
        currentAmount = Math.max(MIN_BUY_PHP, Math.round(currentAmount * MACRO_AMOUNT_REDUCTION / 50) * 50)
      }
    }
  }

  // ── WATCH_SKIP ──────────────────────────────────────────────────────────────
  let finalSignal = currentTier
  if (currentTier === 'WATCH' && dipSignals.length === 0) {
    finalSignal = 'WATCH_SKIP'
    currentAmount = 0
  }

  // ── Fear & Greed amount scaling ─────────────────────────────────────────────
  const { adjustedAmount, fearGreedLabel } = applyFearGreed(currentAmount, fearGreedIndex)
  currentAmount = adjustedAmount

  // ── Bucket / rate-limiting logic ────────────────────────────────────────────
  let isActionable = currentAmount > 0 && !['NO_BUY', 'WATCH_SKIP'].includes(finalSignal)
  let bucket = null

  if (isActionable) {
    const isExtremeDrop = hourlyChangePct <= DIP_THRESHOLDS.EXTREME_DROP_PCT
    const isStrongDrop  = dipSignals.includes('STRONG_DROP')
    const isPriorityBuy = finalSignal === 'PRIORITY_BUY'

    const meetsGap = lastOpportunityBuyTimestamp === null ||
      hoursDiff(lastOpportunityBuyTimestamp, nowIso) >= MIN_HOURS_GAP

    if (isExtremeDrop) {
      // True market dislocation — bypass gap rule and budget, but cap to 2 per 24h
      // to prevent cascade over-deployment during multi-hour crash sequences.
      if (extremeOverrideCount24h >= MAX_EXTREME_OVERRIDES_24H) {
        // Demote to normal opportunity bucket — still buy if budget allows
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

      // Budget check: would this buy push total monthly spend over ₱10,000?
      const wouldExceedBudget = totalSpentThisMonth + currentAmount > MONTHLY_BUDGET_PHP

      if (wouldExceedBudget) {
        // Partial buy if some budget remains, otherwise cap out
        const remaining = MONTHLY_BUDGET_PHP - totalSpentThisMonth
        if (remaining >= MIN_BUY_PHP) {
          // Round down to nearest ₱50 so we don't go over
          currentAmount = Math.floor(remaining / 50) * 50
        } else {
          finalSignal = 'BUDGET_CAP'
          currentAmount = 0
          isActionable = false
        }

      } else if (isPriorityBuy || isStrongDrop) {
        // Strong conviction — bypass gap rule

      } else if (!meetsGap) {
        finalSignal = 'OPP_GAP_WAIT'
        currentAmount = 0
        isActionable = false
      }
    }
  }

  // ── Recommendation text ─────────────────────────────────────────────────────
  const priceStr  = `$${currentPrice.toLocaleString()}`
  const amountStr = `₱${currentAmount.toLocaleString()}`

  let recommendation = ''
  switch (finalSignal) {
    case 'NO_BUY':
      recommendation = `BTC at ${priceStr} is in the no-buy zone. Hold cash.`
      break
    case 'WATCH':
      recommendation = `Watch zone + dip signal (${dipSignals.join(', ')}). Small ${amountStr} entry. Monitor next 1–2 hours.`
      break
    case 'WATCH_SKIP':
      recommendation = 'Watch zone but no hourly dip signal. Skip and wait for a confirmed pullback.'
      break
    case 'BUY':
      recommendation = `Standard buy zone. Consider ${amountStr} at ${priceStr}.`
      break
    case 'BUY_MORE':
      recommendation = `Dip signal confirmed (${dipSignals.join(', ')}). Buy ${amountStr} at ${priceStr}.`
      break
    case 'AGGRESSIVE':
      recommendation = `BTC is deeply discounted at ${priceStr}. Deploy ${amountStr} aggressively.`
      break
    case 'PRIORITY_BUY':
      recommendation = `BTC (${priceStr}) is BELOW your avg cost ($${effectiveAvgCost.toLocaleString()}). Buy ${amountStr} to lower your cost basis.`
      break
    case 'OPP_GAP_WAIT':
      recommendation = `Buy already recorded this hour. Last buy: ${lastOpportunityBuyTimestamp}. Next check in ~1 hour.`
      break
    case 'BUDGET_CAP':
      recommendation = `Monthly budget reached (₱${MONTHLY_BUDGET_PHP.toLocaleString()} spent). No more buys until next month.`
      break
    default:
      recommendation = 'Monitor and follow the strategy rules.'
  }

  if (staggerWarning) {
    recommendation += ' Extreme drop — split into 2–3 smaller buys over the next few hours instead of deploying all at once.'
  }
  if (volumeWarning) {
    recommendation += ' STRONG_DROP removed: volume below 80% of 30d avg — likely a low-conviction wick.'
  }
  if (trendWarning?.includes('LOWER_HIGHS')) {
    recommendation += ' 24h downtrend detected — position size reduced.'
  }
  if (trendWarning?.includes('CONSECUTIVE_GREEN')) {
    recommendation += ' 3 consecutive green hours with no dip. Do not chase momentum.'
  }
  if (rsiLabel === 'OVERBOUGHT') {
    recommendation += ' RSI overbought (>70) — tier downgraded. Wait for a pullback.'
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
    recommendation += ` MACRO DRAWDOWN: BTC is >25% below 90d high — buy sizes reduced to ${Math.round(MACRO_AMOUNT_REDUCTION * 100)}% and AGGRESSIVE tier disabled.`
  }
  if (extremeOverrideCount24h >= MAX_EXTREME_OVERRIDES_24H && hourlyChangePct <= DIP_THRESHOLDS.EXTREME_DROP_PCT) {
    recommendation += ` Extreme override cap reached (${MAX_EXTREME_OVERRIDES_24H}/24h) — demoted to opportunity bucket.`
  }

  return {
    // Core signal
    signal:      finalSignal,
    amount:      currentAmount,   // PHP
    isActionable,
    bucket,

    // Price context
    currentPrice,
    avgCost:     effectiveAvgCost,
    vsAvg,
    hourlyChange,
    hourlyChangePct,

    // Dip & trend context
    dipSignals,
    trendWarning:  trendWarning || null,
    staggerWarning,
    volumeWarning,

    // Modifier context
    rsi:           rsi ?? null,
    rsiLabel,
    fearGreedIndex: fearGreedIndex ?? null,
    fearGreedLabel,
    volumeRatio:   volumeRatio ?? null,

    // Macro context
    high90d:            high90d ?? null,
    macroDrawdownActive,
    extremeOverrideCount24h,

    // Thresholds used
    thresholds:    thresholds ?? null,

    recommendation,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SWING TRADE ENGINE
// Strategy: buy short-term weakness, hold 2–5 days, exit into bounce strength.
// Based on backtest insight: 72h is the strongest edge window (73.2% win rate).
// ─────────────────────────────────────────────────────────────────────────────

const SWING = {
  // Entry conditions
  DROP_MIN_PCT:       -3,    // 24h drop must be at least -3%
  DROP_MAX_PCT:       -8,    // -8%+ is a flush — too dangerous
  RSI_ENTRY:          35,    // RSI must be below this (oversold)
  VOLUME_MIN:         1.2,   // volume must be ≥ 1.2× 30d avg
  MAX_BOUNCE_PCT:     2,     // don't enter if already bounced 2%+ from 24h low
  ADD_ENTRY_DROP:    -2,     // add next entry after another -2% from last entry

  // Exit levels (gross price move from avg entry)
  TP_PCT:             0.06,  // +6% → sell ALL (~+5% net after fees)
  STOP_LOSS_PCT:     -0.08,  // -8% → exit all

  // Hold limits
  HOLD_MAX_HOURS:     120,   // 5-day hard exit
  MIN_HOLD_HOURS:     24,    // minimum hold before any exit (except stop loss)

  // Macro filters
  KILL_SWITCH_7D:    -10,    // 7-day drop ≤ -10% → pause entries for 24h
  MA200_REDUCE:       0.5,   // below 200d MA → 50% position size

  // PDAX fee
  FEE:                0.005,

  // Position
  MAX_ENTRIES:        3,
}

function swingExitLevels(avgEntryUsd) {
  return {
    stopLossUsd: parseFloat((avgEntryUsd * (1 + SWING.STOP_LOSS_PCT)).toFixed(2)),
    tpUsd:       parseFloat((avgEntryUsd * (1 + SWING.TP_PCT)).toFixed(2)),
  }
}

function swingEntryAmount(balancePhp, macroMode) {
  const base = parseFloat((balancePhp / SWING.MAX_ENTRIES).toFixed(2))
  return macroMode === 'REDUCED' ? parseFloat((base * 0.5).toFixed(2)) : base
}

/**
 * Main swing trade signal analysis.
 *
 * States:
 *   FLAT     — no position, scanning for Entry 1
 *   BUILDING — 1–2 entries placed, watching for more entries or exit
 *   FULL     — all 3 entries placed, watching exit only
 *
 * Signals:
 *   SCAN       — watching, no conditions met
 *   KILL_SWITCH — 7d flush, pause new entries
 *   ENTRY_1    — initial entry conditions met
 *   ADD_ENTRY  — additional entry (-2% from last)
 *   HOLDING    — in position, no exit signal
 *   TP_HIT     — +6% reached, sell ALL (~+5% net)
 *   TIME_EXIT  — 120h limit hit, exit at market
 *   STOP_LOSS  — -8% hit, exit all
 */
function analyzeSwingSignal({
  currentPrice,
  prevHourPrice       = null,
  currentOpen         = null,   // current candle open (for green/small-range check)
  price24hAgo         = null,
  price7dAgo          = null,
  low24h              = null,   // min close over last 24 candles
  rsi                 = null,
  volumeRatio         = null,
  ma200               = null,   // 200-day MA from daily candles
  positionState       = 'FLAT', // 'FLAT' | 'BUILDING' | 'FULL'
  entryCount          = 0,
  entries             = [],     // [{ priceUsd, amountPhp, timestamp }]
  avgEntryPriceUsd    = null,
  lastEntryPriceUsd   = null,
  firstEntryTimestamp = null,
  currentBalancePhp   = 15000,
  totalDeployedPhp    = 0,
  stopLossUsd         = null,
  tpUsd               = null,
  hardExitTimestamp   = null,
  killSwitchUntil     = null,
  nowIso,
}) {
  const hourlyChange    = prevHourPrice != null ? parseFloat((currentPrice - prevHourPrice).toFixed(2)) : 0
  const hourlyChangePct = prevHourPrice != null ? parseFloat(((hourlyChange / prevHourPrice) * 100).toFixed(3)) : 0
  const change24hPct    = price24hAgo != null ? parseFloat(((currentPrice - price24hAgo) / price24hAgo * 100).toFixed(2)) : null
  const change7dPct     = price7dAgo  != null ? parseFloat(((currentPrice - price7dAgo)  / price7dAgo  * 100).toFixed(2)) : null

  const now = new Date(nowIso)

  // ── Macro mode ──────────────────────────────────────────────────────────────
  const isKillActive      = killSwitchUntil && now < new Date(killSwitchUntil)
  const triggerKillSwitch = change7dPct != null && change7dPct <= SWING.KILL_SWITCH_7D
  let   newKillSwitchUntil = killSwitchUntil

  if (triggerKillSwitch && !isKillActive) {
    newKillSwitchUntil = new Date(now.getTime() + 24 * 3600000).toISOString()
  }

  let macroMode = 'NORMAL'
  if (isKillActive || triggerKillSwitch) {
    macroMode = 'PAUSED'
  } else if (ma200 != null && currentPrice < ma200) {
    macroMode = 'REDUCED'
  }

  const inPosition = positionState === 'BUILDING' || positionState === 'FULL'
  const ctx = { currentPrice, hourlyChange, hourlyChangePct, change24hPct, change7dPct, macroMode, newKillSwitchUntil, entryCount, rsi, volumeRatio, totalDeployedPhp }

  // ── Exit logic (priority over entries) ──────────────────────────────────────
  if (inPosition && avgEntryPriceUsd != null) {
    const pctFromEntry = parseFloat(((currentPrice - avgEntryPriceUsd) / avgEntryPriceUsd * 100).toFixed(2))
    const hoursHeld    = firstEntryTimestamp ? Math.round((now - new Date(firstEntryTimestamp)) / 3600000) : null
    const hoursToExit  = hardExitTimestamp   ? Math.round((new Date(hardExitTimestamp) - now) / 3600000)  : null

    // Stop loss — bypasses min hold
    if (stopLossUsd != null && currentPrice <= stopLossUsd) {
      return { ...ctx, signal: 'STOP_LOSS', isActionable: true, sellPct: 100, pctFromEntry, hoursHeld,
        avgEntryPriceUsd, stopLossUsd,
        recommendation: `STOP LOSS: BTC at $${currentPrice.toLocaleString()} hit stop $${stopLossUsd.toLocaleString()} (${pctFromEntry}%). Sell ALL on PDAX immediately.` }
    }

    // Time exit
    if (hardExitTimestamp && now >= new Date(hardExitTimestamp)) {
      return { ...ctx, signal: 'TIME_EXIT', isActionable: true, sellPct: 100, pctFromEntry, hoursHeld,
        avgEntryPriceUsd, hardExitTimestamp,
        recommendation: `120h HARD EXIT after ${hoursHeld}h. Exit at market on PDAX. Capital discipline over profit chasing.` }
    }

    // TP — +6%, sell ALL
    if (tpUsd != null && currentPrice >= tpUsd) {
      const minHoldOk = hoursHeld == null || hoursHeld >= SWING.MIN_HOLD_HOURS
      if (minHoldOk) {
        return { ...ctx, signal: 'TP_HIT', isActionable: true, sellPct: 100, pctFromEntry, hoursHeld,
          avgEntryPriceUsd, tpUsd,
          recommendation: `TP +6% hit at $${currentPrice.toLocaleString()}. Sell ALL on PDAX. Position closed. (~+5% net after fees)` }
      }
    }

    // Still holding
    return { ...ctx, signal: 'HOLDING', isActionable: false, sellPct: 0,
      pctFromEntry, hoursHeld, hoursToExit, avgEntryPriceUsd,
      stopLossUsd, tpUsd,
      recommendation: `Holding ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} @ avg $${avgEntryPriceUsd.toLocaleString()} · ${pctFromEntry >= 0 ? '+' : ''}${pctFromEntry}% · TP: $${tpUsd?.toLocaleString() ?? '—'} (+6%) · Hard exit in ${hoursToExit ?? '?'}h.` }
  }

  // ── Kill switch ──────────────────────────────────────────────────────────────
  if (macroMode === 'PAUSED') {
    const until = newKillSwitchUntil ? new Date(newKillSwitchUntil).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' }) : '?'
    return { ...ctx, signal: 'KILL_SWITCH', isActionable: false,
      recommendation: `KILL SWITCH: 7-day decline ${change7dPct?.toFixed(1) ?? '?'}% ≤ -10%. No new entries for 24h (until ~${until} PH).` }
  }

  // ── Add entry (Entry 2 or 3) ─────────────────────────────────────────────────
  if (positionState === 'BUILDING' && entryCount < SWING.MAX_ENTRIES && lastEntryPriceUsd != null) {
    const dropFromLast = (currentPrice - lastEntryPriceUsd) / lastEntryPriceUsd * 100
    if (dropFromLast <= SWING.ADD_ENTRY_DROP) {
      const amount = swingEntryAmount(currentBalancePhp, macroMode)
      // Recompute avg and exit levels including this new entry
      const newAvg = [...entries.map(e => e.priceUsd), currentPrice].reduce((a, b) => a + b) / (entryCount + 1)
      const levels = swingExitLevels(newAvg)
      return { ...ctx, signal: 'ADD_ENTRY', isActionable: true, sellPct: 0,
        amount, entryNumber: entryCount + 1, lastEntryPriceUsd,
        dropFromLastPct: parseFloat(dropFromLast.toFixed(2)),
        projectedAvgEntry: parseFloat(newAvg.toFixed(2)), ...levels,
        recommendation: `Entry ${entryCount + 1}/3: price dropped ${dropFromLast.toFixed(1)}% from last entry $${lastEntryPriceUsd.toLocaleString()}. Add ₱${amount.toLocaleString()}${macroMode === 'REDUCED' ? ' (50% — below 200 MA)' : ''} at $${currentPrice.toLocaleString()}. New avg entry ~$${newAvg.toFixed(0)}.` }
    }
  }

  // ── Entry 1 (FLAT only) ──────────────────────────────────────────────────────
  if (positionState === 'FLAT') {
    const met   = []
    const unmet = []

    // 1. 24h drop -3% to -8%
    if (change24hPct != null) {
      if (change24hPct <= SWING.DROP_MIN_PCT && change24hPct >= SWING.DROP_MAX_PCT)
        met.push(`24h drop ${change24hPct.toFixed(1)}%`)
      else if (change24hPct > SWING.DROP_MIN_PCT)
        unmet.push(`24h drop only ${change24hPct.toFixed(1)}% (need ≤ -3%)`)
      else
        unmet.push(`24h drop ${change24hPct.toFixed(1)}% too extreme — flush risk`)
    } else {
      unmet.push('24h price unavailable')
    }

    // 2. RSI < 35
    if (rsi != null) {
      if (rsi < SWING.RSI_ENTRY) met.push(`RSI ${rsi.toFixed(0)} oversold`)
      else unmet.push(`RSI ${rsi.toFixed(0)} not oversold (need < ${SWING.RSI_ENTRY})`)
    } else {
      unmet.push('RSI unavailable')
    }

    // 3. Stabilization: green candle or small range (≤ 0.3% body)
    const isGreen     = currentOpen != null && currentPrice > currentOpen
    const bodyPct     = currentOpen != null ? Math.abs((currentPrice - currentOpen) / currentOpen * 100) : null
    const isSmallBody = bodyPct != null && bodyPct <= 0.3
    if (isGreen)      met.push('green candle (stabilizing)')
    else if (isSmallBody) met.push('small-range candle (base forming)')
    else              unmet.push('no stabilization signal yet')

    // 4. Volume ≥ 1.2×
    if (volumeRatio != null) {
      if (volumeRatio >= SWING.VOLUME_MIN) met.push(`volume ${volumeRatio.toFixed(2)}× avg`)
      else unmet.push(`volume ${volumeRatio.toFixed(2)}× avg (need ≥ ${SWING.VOLUME_MIN}×)`)
    }

    // 5. Not chasing: bounce from 24h low ≤ 2%
    const bouncePct = low24h != null ? parseFloat(((currentPrice - low24h) / low24h * 100).toFixed(2)) : null
    if (bouncePct != null) {
      if (bouncePct <= SWING.MAX_BOUNCE_PCT) met.push(`only ${bouncePct.toFixed(1)}% off low`)
      else unmet.push(`bounced ${bouncePct.toFixed(1)}% from low — chasing`)
    }

    // All core conditions required: drop + RSI + stabilization + not chasing
    // Volume is optional (adds confidence but not a hard gate when unavailable)
    const coreOk =
      change24hPct != null && change24hPct <= SWING.DROP_MIN_PCT && change24hPct >= SWING.DROP_MAX_PCT &&
      rsi != null && rsi < SWING.RSI_ENTRY &&
      (isGreen || isSmallBody) &&
      (bouncePct == null || bouncePct <= SWING.MAX_BOUNCE_PCT)
    const volumeOk = volumeRatio == null || volumeRatio >= SWING.VOLUME_MIN

    if (coreOk && volumeOk) {
      const amount = swingEntryAmount(currentBalancePhp, macroMode)
      const levels = swingExitLevels(currentPrice)
      const hardExit = new Date(now.getTime() + SWING.HOLD_MAX_HOURS * 3600000).toISOString()
      return { ...ctx, signal: 'ENTRY_1', isActionable: true, sellPct: 0,
        amount, entryNumber: 1, entrySignals: met, ...levels, hardExitTimestamp: hardExit,
        recommendation: `Entry 1/3: ${met.join(' · ')}. Deploy ₱${amount.toLocaleString()}${macroMode === 'REDUCED' ? ' (50% — below 200 MA)' : ''} at $${currentPrice.toLocaleString()}. SL $${levels.stopLossUsd.toLocaleString()} · TP $${levels.tpUsd.toLocaleString()} (+6%, sell ALL) · Hard exit in 120h.` }
    }

    return { ...ctx, signal: 'SCAN', isActionable: false, sellPct: 0,
      entrySignals: met, missingConditions: unmet,
      recommendation: `Scanning. ${unmet.length ? 'Waiting for: ' + unmet.slice(0, 2).join('; ') + '.' : 'Near entry.'}` }
  }

  return { ...ctx, signal: 'SCAN', isActionable: false, sellPct: 0,
    recommendation: 'Watching for entry opportunity.' }
}

module.exports = {
  analyzeSignal,
  computeThresholds,
  getBaseTier,
  applyFearGreed,
  hoursDiff,
  DEFAULT_AVG_COST,
  TIERS,
  TIER_ORDER,
  DIP_THRESHOLDS,
  BASELINE_THRESHOLDS,
  RSI_BANDS,
  FEAR_GREED_BANDS,
  MIN_HOURS_GAP,
  MONTHLY_BUDGET_PHP,
  MIN_BUY_PHP,
  MAX_BUY_PHP,
  analyzeSwingSignal,
  swingExitLevels,
  swingEntryAmount,
  SWING,
}

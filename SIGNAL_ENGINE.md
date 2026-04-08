# ALFM Signal Engine - How It Works

**File:** `functions/signalEngine.js`
**Last updated:** April 2026 (bucket system implemented)
**Purpose:** Given today's NAVPU and context data, produce a buy signal with an exact peso amount.

---

## Overview

The signal engine is a **pure function** - it takes inputs, applies rules, and returns a signal. It has no side effects, no database calls. Every decision is traceable through the steps below.

```
Inputs -> Step 1: Base Tier -> Step 2: Dip Signals -> Step 3: Trend Filter
       -> Step 4: Dividend Cycle -> Step 5: WATCH_SKIP -> Step 6: Bucket Logic -> Output Signal
```

---

## Inputs

| Input | Description |
|---|---|
| `todayNavpu` | Latest published NAVPU (note: this is the *previous* business day's closing value - Philippine mutual funds publish NAV with a 1-day lag) |
| `yesterdayNavpu` | The business day before `todayNavpu` - used for daily change calculation |
| `twoDaysAgoNavpu` | Two business days ago - used for multi-day pattern detection |
| `last7Navpus` | Last 7 business-day NAVPU values (oldest to newest) - weekends stripped |
| `avgPrice` | Your current average purchase price (e.g. 45.48) |
| `dividendBuyDoneThisMonth` | Boolean - whether a dividend bucket buy has already been executed this month |
| `opportunityBuyCountThisMonth` | Integer (0, 1, or 2) - number of opportunity bucket buys this month (stagger-aware) |
| `lastOpportunityBuyDate` | String or null - date of the most recent opportunity buy (YYYY-MM-DD) |
| `todayStr` | Today's date as `YYYY-MM-DD` |
| `recordDates` | Array of dividend record dates (e.g. `['2026-01-29', '2026-03-27']`) |
| `thresholds` | Dynamic tier boundaries computed from historical data (see Step 1) |

> **Important:** All NAVPU comparison arrays (yesterday, twoDaysAgo, last7) have weekends stripped before being passed in. This prevents comparing the same repeated weekend value as if it were a new trading day.

---

## Step 1 - Base Tier

The NAVPU is placed into one of six tiers. Tier boundaries are **dynamic** - computed from the percentile distribution of the last 90 business days of NAVPU data, so they evolve as more data accumulates.

### Dynamic Thresholds (percentile-based, rolling 90-day window)

| Percentile | Threshold | Tier |
|---|---|---|
| 75th | `noBuyThreshold` | NO_BUY if NAVPU >= this |
| 60th | `watchThreshold` | WATCH if NAVPU >= this |
| 45th | `buyThreshold` | BUY if NAVPU >= this |
| 30th | `buyMoreThreshold` | BUY_MORE if NAVPU >= this |
| Below 30th | - | AGGRESSIVE |
| Below avg price | - | PRIORITY_BUY (overrides all) |

> **Example with 91 days of data (Jan-Apr 2026):**
> 75th pct ~46.80 -> NO_BUY above 46.80
> 60th pct ~46.35 -> WATCH
> 45th pct ~46.07 -> BUY
> 30th pct ~45.98 -> BUY_MORE
> Below 45.98 -> AGGRESSIVE
> Below 45.48 (avg price) -> PRIORITY_BUY

### Threshold Stability Guard
If the fund enters a prolonged decline, percentile thresholds can drift downward, making genuinely cheap prices appear "normal." To prevent this:

- If **any** computed threshold falls more than **0.30 below the 90-day mean**, all thresholds revert to fixed baseline values:

| Tier | Baseline |
|---|---|
| NO_BUY | >= 46.50 |
| WATCH | 46.20 - 46.49 |
| BUY | 46.00 - 46.19 |
| BUY_MORE | 45.80 - 45.99 |
| AGGRESSIVE | <= 45.79 |

The signal output includes `usingBaseline: true` when this fallback is active.

**Fallback for insufficient data:** If fewer than 5 data points exist, hardcoded baseline thresholds are used.

### Position Sizing per Tier

| Tier | Default Amount |
|---|---|
| NO_BUY | 0 |
| WATCH | 1,000 (only if dip signal present, else WATCH_SKIP) |
| BUY | 2,500 |
| BUY_MORE | 3,500 |
| AGGRESSIVE | 5,000 |
| PRIORITY_BUY | 5,000 (reduced to 3,500 if downtrend active) |

---

## Step 2 - Dip Signals

Dip signals can upgrade the tier and increase the allocation. Two guards apply before any dip signal is considered:

### Noise Filter
If `|dailyChange| < 0.08`, the move is treated as noise and **all dip signal detection is skipped**. The base tier still applies but no upgrades occur.

### Single Strongest Signal Rule
Only **one** dip signal upgrades the tier per day - the strongest one detected, based on this priority:

1. **STRONG_DROP** (highest priority)
2. **CONFIRMED_WEAKNESS**
3. **DROP_STABILIZATION**

Maximum effect: **+1 tier level, +1,000 to amount** (capped at 5,000). Signals do not stack.

---

### Signal 1 - STRONG_DROP
- **Condition:** `dailyChange <= -0.30`
- **Effect:** Upgrade tier +1, amount +1,000
- **Rationale:** Historical data shows rebounds within 1-3 days (Jan 30 -0.35, Feb 5 -0.36, Mar 3 -0.49, Mar 24 -0.47 - all bounced).
- **Bucket override:** Also bypasses Days 1-5 lock and 7-trading-day gap in the opportunity bucket (see Step 6).

### Signal 2 - CONFIRMED_WEAKNESS
- **Condition:** 2 consecutive red days (business days) AND total 2-day drop >= -0.20
- **Effect:** Upgrade tier +1
- **Rationale:** Filters one-day noise. Two consecutive down days with meaningful total decline is a more reliable entry signal.

### Signal 3 - DROP_STABILIZATION
- **Condition:** Previous business day's drop >= -0.30 AND today's change is within +-0.10 (flat/sideways)
- **Effect:** Upgrade tier +1
- **Rationale:** Selling pressure is easing. Historical example: Mar 3 dropped to 45.56 -> Mar 4 bounced to 45.95.

### Signal 4 - EXTREME_DROP (bucket override)
- **Condition:** `dailyChange <= -0.50` **AND** `NAVPU < buyMoreThreshold` (30th percentile)
- **Effect:** Sets `bucket = 'extreme_override'`, `staggerWarning = true`, ensures minimum BUY_MORE signal
- **Bucket bypass:** Bypasses ALL rules including dividend cap, opportunity cap, lock period, and gap rule
- **Action:** Split the buy into 2-3 smaller purchases over the next 2-3 days
- **Stagger counting:** All stagger buys sharing the same `staggerEventDate` count as **0** toward the opportunity cap (they are excluded from the cap entirely as extreme_override)
- **Rationale:** A -0.50 drop when NAVPU is already cheap (below 30th percentile) is a genuine market dislocation worth aggressive accumulation. A -0.50 drop from elevated NAVPU is a falling knife — treated as STRONG_DROP instead and subject to normal opportunity bucket rules.

### Tier Upgrade Order
```
NO_BUY -> WATCH -> BUY -> BUY_MORE -> AGGRESSIVE
```
PRIORITY_BUY cannot be upgraded (already highest priority).

---

## Step 3 - Trend Filter (Risk Reduction)

After dip signal upgrades, two trend conditions apply.

### Downtrend Detection
A downtrend is detected if **either** condition is met:

- **Condition A (momentum):** 5 or more of the last 6 business-day NAVPU transitions are lower than the previous day
- **Condition B (magnitude):** Net NAVPU decline >= 0.40 over the last 7 business days

**Effect when downtrend detected:**
- Reduce amount by 35%, minimum 1,000
- Example: BUY_MORE 3,500 -> 2,275
- **PRIORITY_BUY exception:** Signal is preserved but amount is reduced to 3,500 instead of 5,000.

### Consecutive Green Days (momentum caution)
- **Condition:** Last 3 business days are all up AND no dip signals are present
- **Effect:** Adds `CONSECUTIVE_GREEN` to `trendWarning` - informational flag only, no amount change
- **Rationale:** Do not chase momentum. Wait for a pullback.

---

## Step 4 - Dividend Cycle Awareness

The fund pays monthly dividends. NAVPU behavior around record dates follows a predictable pattern.

### Post-Record Window (HIGH EDGE)
- **Condition:** Today is 1-3 days AFTER a dividend record date AND `dailyChange <= -0.25`
- **Effect:** Minimum tier forced to BUY_MORE even if base tier was lower
- **Bucket classification:** Qualifies this buy as a **dividend bucket** buy (see Step 6)
- **Rationale:** NAVPU typically dips after the record date as it goes ex-dividend. Predictable buying opportunity.

### Pre-Record Caution
- **Condition:** Today is 1-7 days BEFORE an upcoming record date
- **Effect:** Adds `PRE_RECORD_CAUTION` flag - informational only, no amount change
- **Rationale:** NAVPU tends to be elevated before record dates. Avoid buying at peak prices.

### Known Record Dates (confirmed 2026)
January 29, February 26, March 27, April 28

---

## Step 5 - WATCH_SKIP

WATCH tier with no dip signals is downgraded to WATCH_SKIP (amount = 0, not actionable).
This prevents low-conviction entries in the elevated WATCH zone when no catalyst is present.

---

## Step 6 - Bucket Logic

The core of the Week 1 Clustering Bias fix. Replaces the old single monthly cap with two separate buckets, each with its own rules.

### Two Buckets

**DIVIDEND BUCKET (max 1 per month)**
- Triggers when: POST_RECORD window + `dailyChange <= -0.25` + NAVPU below 60th percentile + `dividendBuyDoneThisMonth == false`
- Exempt from: Days 1-5 lock, 7-trading-day gap rule
- Signal is upgraded to minimum BUY_MORE (3,500) if not already higher
- Returns `isDividendBuy: true`, `bucket: 'dividend'`

**OPPORTUNITY BUCKET (max 2 per month)**
- All other actionable signals go here
- Subject to: Days 1-5 lock, 7-trading-day gap, and a 2-buy cap
- Returns `isDividendBuy: false`, `bucket: 'opportunity'`

**EXTREME OVERRIDE (no cap)**
- Triggered by `dailyChange <= -0.50`
- Bypasses ALL bucket rules, caps, locks, and gaps
- Returns `bucket: 'extreme_override'`
- Stagger buys from an EXTREME_DROP event are excluded from opportunity cap counting

### Override Hierarchy (strongest wins)

```
1. EXTREME_DROP (dailyChange <= -0.50) -> extreme_override bucket, bypass ALL
2. Dividend condition (POST_RECORD + drop >= -0.25 + quality) -> dividend bucket, exempt from lock/gap
3. PRIORITY_BUY or STRONG_DROP -> opportunity bucket, bypass lock/gap (not cap)
4. All others -> opportunity bucket, enforce lock + gap + cap
```

### Days 1-5 Lock (Opportunity Bucket Only)
- **Condition:** Today's date is calendar day 1-5 of the month
- **Effect:** Signal blocked -> `OPP_LOCKED`, amount = 0
- **Bypass:** PRIORITY_BUY, STRONG_DROP, or EXTREME_DROP signals bypass this lock
- **Rationale:** Prevents the dividend cycle from consuming both opportunity slots in week 1, leaving nothing for genuine dips in weeks 2-4.

### 7-Trading-Day Minimum Gap (Opportunity Bucket Only)
- **Condition:** Fewer than 7 trading days have passed since the last opportunity buy
- **Effect:** Signal blocked -> `OPP_GAP_WAIT`, amount = 0
- **Bypass:** PRIORITY_BUY, STRONG_DROP, or EXTREME_DROP signals bypass this gap rule
- **Rationale:** Prevents clustering multiple buys in a short window. Spreads capital deployment across the month.

### Opportunity Cap
- **Condition:** `opportunityBuyCountThisMonth >= 2`
- **Effect:** `MONTHLY_CAP`, amount = 0
- **No exceptions** (unlike the old NO_SECOND_BUY system)
- Stagger buy groups from the same EXTREME_DROP event count as 0 toward this cap (extreme_override is excluded)

---

## Output Signals

| Signal | Bucket | Meaning | Amount |
|---|---|---|---|
| `NO_BUY` | - | NAVPU too high - hold | 0 |
| `WATCH` | - | Watch zone with dip signal - small entry | 1,000 |
| `WATCH_SKIP` | - | Watch zone, no dip signal - skip | 0 |
| `BUY` | opportunity | Standard entry zone | 2,500 |
| `BUY_MORE` | opportunity or dividend | Strong zone / post-dividend dip | 3,500 |
| `AGGRESSIVE` | opportunity | Near period low - maximum accumulation | 5,000 |
| `PRIORITY_BUY` | opportunity (lock/gap bypassed) | Below your avg price - lower cost basis | 5,000 (3,500 in downtrend) |
| `OPP_LOCKED` | - | Days 1-5 lock in effect - wait | 0 |
| `OPP_GAP_WAIT` | - | < 7 trading days since last opp buy | 0 |
| `MONTHLY_CAP` | - | 2 opportunity buys done this month | 0 |

---

## Full Decision Flow (Summary)

```
1. Calculate dailyChange = todayNavpu - yesterdayNavpu (business days only)

2. Determine base tier from NAVPU vs dynamic percentile thresholds (rolling 90-day)
   -> Stability guard: if thresholds drift >0.30 below mean, use fixed baseline
   -> Special override: if NAVPU < avgPrice -> PRIORITY_BUY regardless

3. Noise filter: if |dailyChange| < 0.08 -> skip all dip signal detection

4. Detect dip signals (STRONG_DROP, CONFIRMED_WEAKNESS, DROP_STABILIZATION)
   -> Apply only the STRONGEST signal detected (no stacking)
   -> +1 tier upgrade, +1,000 to amount (max 5,000)
   -> EXTREME_DROP (<= -0.50 AND NAVPU < 30th pct) sets bucket = 'extreme_override' + stagger warning
   -> EXTREME_DROP (<= -0.50 BUT NAVPU >= 30th pct) treated as STRONG_DROP, normal opportunity rules apply

5. Dividend cycle: POST_RECORD + drop >= -0.25 -> minimum BUY_MORE

6. Apply trend filter (downtrend = 5/6 days down OR net -0.40 over 7 days)
   -> Reduce amount by 35%, min 1,000
   -> PRIORITY_BUY during downtrend -> 3,500 instead of 5,000

7. WATCH with no dip signals -> WATCH_SKIP (0)

8. Bucket logic (in priority order):
   a. EXTREME_DROP -> extreme_override bucket, bypass ALL rules and caps
   b. Dividend condition (POST_RECORD + drop >= -0.25 + below 60th pct + not done this month)
      -> dividend bucket, minimum BUY_MORE, exempt from lock/gap
   c. All others -> opportunity bucket:
      - Cap check: opportunityBuyCountThisMonth >= 2 -> MONTHLY_CAP
      - Bypass check: PRIORITY_BUY or STRONG_DROP -> skip lock/gap
      - Lock check: calendar day 1-5 -> OPP_LOCKED
      - Gap check: < 7 trading days since last opp buy -> OPP_GAP_WAIT

9. Return signal, amount, recommendation text, isDividendBuy, bucket, and all flags
```

---

## Known Limitations

1. **`todayNavpu` is previous business day's closing price** - Philippine mutual funds publish NAV with a 1-day lag. The engine runs at 9 AM on the latest published value. When you buy before 2 PM, the executed price will be *today's* end-of-day NAV (unknown at signal time).

2. **No macro awareness** - USD/PHP exchange rate swings directly affect NAVPU since the underlying BlackRock fund is USD-denominated. Manual override recommended on known high-volatility event days (Fed decisions, BSP rate announcements).

3. **180-day lock-up not tracked** - The engine does not know which units are redeemable vs locked. This does not affect buy signals but is worth monitoring separately.

4. **Dividend amount variability** - Actual dividend per unit varies monthly (~0.22-0.24/unit based on recent history). Update `KNOWN_RECORD_DATES` in `index.js` each time a new record date is announced.

5. **Threshold drift monitoring** - Log all computed thresholds daily to audit how they shift over time. The stability guard prevents acute drift but gradual long-term shifts should be reviewed quarterly.

6. **Gap rule uses trading days** - `tradingDaysBetween()` counts Mon-Fri calendar days, not actual Philippine trading days. PSE holidays are not accounted for, which may slightly under-count the effective gap.

---

## Backtesting

**File:** `functions/backtest.js`
**Triggered by:** HTTP GET `runBacktest` (manual) or scheduled on the 1st and 15th of each month at 10:00 AM Manila.

### How It Works

The backtest replays the signal engine against every business day in `navpu_history`, oldest to newest, with **strict no-lookahead**: each day only uses data that would have been available at that point in time.

Key simulation rules:

- **avgPrice is dynamic** - starts as `null` (no position), then updates after each simulated actionable buy using the actual buy amount and NAVPU. Reflects how your real average price evolves.
- **Thresholds are dynamic** - `computeThresholds()` is called each day using only historical values up to that day. The engine never sees future percentile data.
- **Bucket state is tracked per-day** - `dividendBuyDoneThisMonth`, `opportunityBuyCountThisMonth`, and `lastOpportunityBuyDate` are derived from already-processed results only, matching how the live system reads from Firestore.
- **Weekends are stripped** - only business days (Mon-Fri) are included. Forward return windows (3d, 15d, 30d) count business days, not calendar days.

### Correctness Metrics (per signal)

Each actionable signal is evaluated against two conditions:

| Field | Condition | Meaning |
|---|---|---|
| `positiveReturn3d` | NAVPU higher 3 business days later | Short-term price appreciation |
| `belowAvg5d` | Entry price below 5-day forward average | Good entry quality (bought before it went higher) |
| `correctBoth` | Both conditions true | Combined correctness (the headline metric) |

For NO_BUY / WATCH_SKIP signals: `noBuyCorrect` = NAVPU dropped at least once in the next 5 days (holding was correct).

### Summary Metrics

| Metric | What it measures |
|---|---|
| `pctCorrectBoth` | % of actionable signals where both 3d return > 0 AND entry below 5d avg |
| `pctPositiveReturn3d` | % of actionable signals where NAVPU was higher 3 days later |
| `pctPositiveReturn15d` | % of actionable signals where NAVPU was higher 15 days later |
| `pctPositiveReturn30d` | % of actionable signals where NAVPU was higher 30 days later |
| `avgReturn1d / 3d / 5d / 15d / 30d` | Average % return at each horizon across all actionable signals |
| `noBuyEffectiveness` | % of NO_BUY days where NAVPU dropped within 5 days (hold was correct) |
| `bucketWinRates` | 15d win rate, signal count, and avg 15d return broken down by bucket type |
| `buyDayDistribution` | Count of actionable signals per week of month (Week 1-4) |
| `week1BucketBreakdown` | Week 1 signal count split by bucket (dividend / opportunity / extreme_override) — shows what's driving early-month concentration |

### How to Interpret the Numbers

**Use 15d and 30d win rates as the primary accuracy measure.** The 3-day window is misleading for this fund because:
- NAVPU is published with a 1-day lag, so your actual execution price is unknown at signal time
- Dips typically take 5-15 business days to fully recover
- A signal that looks "wrong" at day 3 is often clearly "right" at day 15

**Target benchmarks (approximate):**

| Metric | Acceptable | Good | Great |
|---|---|---|---|
| 15d win rate | > 55% | > 60% | > 65% |
| 30d win rate | > 60% | > 65% | > 70% |
| Avg 15d return | > +0.3% | > +0.5% | > +0.8% |
| NO_BUY effectiveness | > 45% | > 55% | > 65% |
| Week 1 distribution | < 70% | < 55% | < 40% |

**Bucket win rates** tell you which part of the engine is working. If dividend bucket consistently outperforms opportunity bucket at 15d, the dividend cycle timing is sound. If extreme_override shows lower win rates, it may be catching falling knives.

### How to Run

```bash
# Manual trigger (HTTP)
curl https://us-central1-alfm-tracker.cloudfunctions.net/runBacktest

# Automatic: runs on the 1st and 15th of each month at 10:00 AM Manila
```

Results are written to:
- `config/backtest_summary` - summary stats (read by BacktestCard UI)
- `backtest_results/{date}` - per-day signal and return data

---

## Execution Note

All orders should be placed **before 2:00 PM Philippine time** on business days:
- Before 2 PM -> executes at **today's** NAVPU (preferred)
- After 2 PM or weekend -> executes at **next business day's** NAVPU

The signal engine runs at **9:00 AM PH time** daily, leaving 5 hours to act on the signal.

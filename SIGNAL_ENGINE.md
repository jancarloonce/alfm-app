# ALFM Signal Engine — How It Works

**File:** `functions/signalEngine.js`
**Last updated:** April 2026 (post-review fixes applied)
**Purpose:** Given today's NAVPU and context data, produce a buy signal with an exact peso amount.

---

## Overview

The signal engine is a **pure function** — it takes inputs, applies rules, and returns a signal. It has no side effects, no database calls. Every decision is traceable through the steps below.

```
Inputs → Step 1: Base Tier → Step 2: Dip Signals → Step 3: Trend Filter
       → Step 4: Dividend Cycle → Step 5: Monthly Cap → Output Signal
```

---

## Inputs

| Input | Description |
|---|---|
| `todayNavpu` | Latest published NAVPU (note: this is the *previous* business day's closing value — Philippine mutual funds publish NAV with a 1-day lag) |
| `yesterdayNavpu` | The business day before `todayNavpu` — used for daily change calculation |
| `twoDaysAgoNavpu` | Two business days ago — used for multi-day pattern detection |
| `last7Navpus` | Last 7 business-day NAVPU values (oldest → newest) — weekends stripped |
| `avgPrice` | Your current average purchase price (e.g. ₱45.48) |
| `monthlyBuyCount` | Effective buy count this month — stagger groups count as 1 (see Step 5) |
| `todayStr` | Today's date as `YYYY-MM-DD` |
| `recordDates` | Array of dividend record dates (e.g. `['2026-01-29', '2026-03-27']`) |
| `thresholds` | Dynamic tier boundaries computed from historical data (see Step 1) |

> **Important:** All NAVPU comparison arrays (yesterday, twoDaysAgo, last7) have weekends stripped before being passed in. This prevents comparing the same repeated weekend value as if it were a new trading day.

---

## Step 1 — Base Tier

The NAVPU is placed into one of six tiers. Tier boundaries are **dynamic** — computed from the percentile distribution of the last 90 business days of NAVPU data, so they evolve as more data accumulates.

### Dynamic Thresholds (percentile-based, rolling 90-day window)

| Percentile | Threshold | Tier |
|---|---|---|
| 75th | `noBuyThreshold` | NO_BUY if NAVPU ≥ this |
| 60th | `watchThreshold` | WATCH if NAVPU ≥ this |
| 45th | `buyThreshold` | BUY if NAVPU ≥ this |
| 30th | `buyMoreThreshold` | BUY_MORE if NAVPU ≥ this |
| Below 30th | — | AGGRESSIVE |
| Below avg price | — | PRIORITY_BUY (overrides all) |

> **Example with 91 days of data (Jan–Apr 2026):**
> 75th pct ≈ ₱46.80 → NO_BUY above ₱46.80
> 60th pct ≈ ₱46.35 → WATCH
> 45th pct ≈ ₱46.07 → BUY
> 30th pct ≈ ₱45.98 → BUY_MORE
> Below ₱45.98 → AGGRESSIVE
> Below ₱45.48 (avg price) → PRIORITY_BUY

### Threshold Stability Guard
If the fund enters a prolonged decline, percentile thresholds can drift downward, making genuinely cheap prices appear "normal." To prevent this:

- If **any** computed threshold falls more than **₱0.30 below the 90-day mean**, all thresholds revert to fixed baseline values:

| Tier | Baseline |
|---|---|
| NO_BUY | ≥ ₱46.50 |
| WATCH | ₱46.20 – ₱46.49 |
| BUY | ₱46.00 – ₱46.19 |
| BUY_MORE | ₱45.80 – ₱45.99 |
| AGGRESSIVE | ≤ ₱45.79 |

The signal output includes `usingBaseline: true` when this fallback is active.

**Fallback for insufficient data:** If fewer than 5 data points exist, hardcoded baseline thresholds are used.

### Position Sizing per Tier

| Tier | Default Amount |
|---|---|
| NO_BUY | ₱0 |
| WATCH | ₱1,000 (only if dip signal present, else skipped) |
| BUY | ₱2,500 |
| BUY_MORE | ₱3,500 |
| AGGRESSIVE | ₱5,000 |
| PRIORITY_BUY | ₱5,000 (reduced to ₱3,500 if downtrend active — see Step 3) |

---

## Step 2 — Dip Signals

Dip signals can upgrade the tier and increase the allocation. Two guards apply before any dip signal is considered:

### Noise Filter
If `|dailyChange| < ₱0.08`, the move is treated as noise and **all dip signal detection is skipped**. The base tier still applies but no upgrades occur.

### Single Strongest Signal Rule
Only **one** dip signal upgrades the tier per day — the strongest one detected, based on this priority:

1. **STRONG_DROP** (highest priority)
2. **CONFIRMED_WEAKNESS**
3. **DROP_STABILIZATION**

Maximum effect: **+1 tier level, +₱1,000 to amount** (capped at ₱5,000). Signals do not stack.

---

### Signal 1 — STRONG_DROP
- **Condition:** `dailyChange <= -₱0.30`
- **Effect:** Upgrade tier +1, amount +₱1,000
- **Rationale:** Historical data shows rebounds within 1–3 days (Jan 30 −₱0.35, Feb 5 −₱0.36, Mar 3 −₱0.49, Mar 24 −₱0.47 — all bounced).

### Signal 2 — CONFIRMED_WEAKNESS
- **Condition:** 2 consecutive red days (business days) AND total 2-day drop ≥ −₱0.20
- **Effect:** Upgrade tier +1
- **Rationale:** Filters one-day noise. Two consecutive down days with meaningful total decline is a more reliable entry signal. Buy on the open of the 3rd day.

### Signal 3 — DROP_STABILIZATION
- **Condition:** Previous business day's drop ≥ −₱0.30 AND today's change is within ±₱0.10 (flat/sideways)
- **Effect:** Upgrade tier +1
- **Rationale:** Selling pressure is easing. Historical example: Mar 3 dropped to ₱45.56 → Mar 4 bounced to ₱45.95.

### Signal 4 — EXTREME_DROP (stagger warning only)
- **Condition:** `dailyChange <= -₱0.50`
- **Effect:** Sets `staggerWarning = true` and `staggerEventDate = today` — does NOT upgrade tier
- **Action:** Split the buy into 2–3 smaller purchases over the next 2–3 days
- **Monthly cap note:** All stagger buys sharing the same `staggerEventDate` count as **1 buy** toward the monthly cap (see Step 5)
- **Rationale:** A drop this large may continue. Staggering reduces risk of catching a falling knife.

### Tier Upgrade Order
```
NO_BUY → WATCH → BUY → BUY_MORE → AGGRESSIVE
```
PRIORITY_BUY cannot be upgraded (already highest priority).

---

## Step 3 — Trend Filter (Risk Reduction)

After dip signal upgrades, two trend conditions apply.

### Downtrend Detection
A downtrend is detected if **either** condition is met:

- **Condition A (momentum):** 5 or more of the last 6 business-day NAVPU transitions are lower than the previous day
- **Condition B (magnitude):** Net NAVPU decline ≥ ₱0.40 over the last 7 business days

**Effect when downtrend detected:**
- Reduce amount by 35%, minimum ₱1,000
- Example: BUY_MORE ₱3,500 → ₱2,275 (effectively ₱2,000+)
- **PRIORITY_BUY exception:** Signal is preserved but amount is reduced to ₱3,500 instead of ₱5,000. You still buy — just smaller, because a downtrend may continue.

### Consecutive Green Days (momentum caution)
- **Condition:** Last 3 business days are all up AND no dip signals are present
- **Effect:** Adds `CONSECUTIVE_GREEN` to `trendWarning` — informational flag only, no amount change
- **Rationale:** Do not chase momentum. Wait for a pullback.

---

## Step 4 — Dividend Cycle Awareness

The fund pays monthly dividends. NAVPU behavior around record dates follows a predictable pattern.

### Post-Record Window (HIGH EDGE)
- **Condition:** Today is 1–3 days AFTER a dividend record date AND `dailyChange <= -₱0.25`
- **Effect:** Minimum tier forced to BUY_MORE (₱3,000–₱4,000) even if base tier was lower
- **Rationale:** NAVPU typically dips after the record date as it goes ex-dividend (Jan → dipped ₱0.35, Feb → dipped ₱0.28). Predictable buying opportunity.
- **Monthly cap note:** Also qualifies as Exception 3 for the 2nd buy (see Step 5).

### Pre-Record Caution
- **Condition:** Today is 1–7 days BEFORE an upcoming record date
- **Effect:** Adds `PRE_RECORD_CAUTION` flag — informational only, no amount change
- **Rationale:** NAVPU tends to be elevated before record dates as the dividend is priced in. Avoid buying at peak prices to capture the dividend.

### Known Record Dates (confirmed 2026)
January 29, February 26, March 27 — April ~28–30 (estimated)

---

## Step 5 — Monthly Cap & Exception Rules

### Monthly Cap Logic

| Buys this month | Action |
|---|---|
| 0 | Proceed normally |
| 1 | Block unless an exception applies (see below) |
| 2 | Hard cap — output `MONTHLY_CAP`, amount = ₱0, no exceptions |

### Stagger Group Counting (Fix 4)
All stagger buys from the same EXTREME_DROP event share a `staggerEventDate`. The monthly cap counts **the entire group as 1 buy**, not 1 per transaction. Example: 3 stagger buys over 3 days from a single −₱0.52 drop = 1 buy toward the cap.

### Exceptions for 2nd Buy (any ONE is sufficient)

| Exception | Condition |
|---|---|
| Exception 1 | `dailyChange <= -₱0.30` (strong dip signal) |
| Exception 2 | `NAVPU < avgPrice` (buying below your cost basis) |
| Exception 3 | Post-record window (days 1–3 after record date) AND `dailyChange <= -₱0.25` |

If 1 buy is done and **none** apply → output `NO_SECOND_BUY`, amount = ₱0.

---

## Output Signals

| Signal | Meaning | Amount |
|---|---|---|
| `NO_BUY` | NAVPU too high — hold | ₱0 |
| `WATCH` | Watch zone with dip signal — small entry | ₱1,000 |
| `WATCH_SKIP` | Watch zone but no dip signal — skip | ₱0 |
| `BUY` | Standard entry zone | ₱2,500 |
| `BUY_MORE` | Strong zone — increase position | ₱3,500 |
| `AGGRESSIVE` | Near period low — maximum accumulation | ₱5,000 |
| `PRIORITY_BUY` | Below your avg price — lower cost basis | ₱5,000 (₱3,500 in downtrend) |
| `NO_SECOND_BUY` | 1 buy done, no exception met — stand down | ₱0 |
| `MONTHLY_CAP` | 2 buys done — hard stop for this month | ₱0 |

---

## Full Decision Flow (Summary)

```
1. Calculate dailyChange = todayNavpu - yesterdayNavpu (business days only)

2. Determine base tier from NAVPU vs dynamic percentile thresholds (rolling 90-day)
   → Stability guard: if thresholds drift >₱0.30 below mean, use fixed baseline
   → Special override: if NAVPU < avgPrice → PRIORITY_BUY regardless

3. Noise filter: if |dailyChange| < ₱0.08 → skip all dip signal detection

4. Detect dip signals (STRONG_DROP, CONFIRMED_WEAKNESS, DROP_STABILIZATION)
   → Apply only the STRONGEST signal detected (no stacking)
   → +1 tier upgrade, +₱1,000 to amount (max ₱5,000)
   → EXTREME_DROP (≤ -₱0.50) sets stagger warning only (no tier upgrade)

5. Apply trend filter (downtrend = 5/6 days down OR net -₱0.40 over 7 days)
   → Reduce amount by 35%, min ₱1,000
   → PRIORITY_BUY during downtrend → ₱3,500 instead of ₱5,000

6. Apply dividend cycle rules
   → Post-record window + drop ≥ -₱0.25 → minimum BUY_MORE

7. WATCH tier with no dip signals → downgrade to WATCH_SKIP (₱0)

8. Apply monthly cap
   → 2 buys done → MONTHLY_CAP
   → 1 buy done → check exceptions (drop, below avg, post-record)
   → No exception → NO_SECOND_BUY
   → Stagger buys from same event count as 1 buy toward cap

9. Return signal, amount, recommendation text, and all flags
```

---

## Known Limitations

1. **`todayNavpu` is previous business day's closing price** — Philippine mutual funds publish NAV with a 1-day lag. The engine runs at 9 AM on the latest published value. When you buy before 2 PM, the executed price will be *today's* end-of-day NAV (unknown at signal time).

2. **No macro awareness** — USD/PHP exchange rate swings directly affect NAVPU since the underlying BlackRock fund is USD-denominated. Manual override recommended on known high-volatility event days (Fed decisions, BSP rate announcements).

3. **180-day lock-up not tracked** — The engine does not know which units are redeemable vs locked. Current redeemable: ~2,228.85 of 4,684.51 units. This does not affect buy signals but is worth monitoring separately.

4. **Dividend amount variability** — The engine estimates ~₱0.24/unit based on recent history. Actual dividend varies monthly. Update after each payout announcement.

5. **Threshold drift monitoring** — Log all computed thresholds daily to audit how they shift over time. The stability guard prevents acute drift but gradual long-term shifts should be reviewed quarterly.

---

## Execution Note

All orders should be placed **before 2:00 PM Philippine time** on business days:
- Before 2 PM → executes at **today's** NAVPU (preferred)
- After 2 PM or weekend → executes at **next business day's** NAVPU

The signal engine runs at **9:00 AM PH time** daily, leaving 5 hours to act on the signal.

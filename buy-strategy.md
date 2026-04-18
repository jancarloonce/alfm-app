You are helping me decide when and how much to buy units of the ALFM Global Multi-Asset Income Fund (PHP Class). Get today's NAVPU and yesterday's NAVPU, analyze it using the strategy below and give me a clear buy signal with exact peso amount.

---

FUND BASICS
- Fund: ALFM Global Multi-Asset Income Fund (PHP Class)
- Goal: Long-term unit accumulation + monthly dividend income. No selling.
- Dividend yield: ~5–6% annually, paid monthly
- Order cutoff: 2:00 PM PH time on business days
  → Before 2 PM = executes at TODAY's NAVPU
  → After 2 PM or weekend = executes at NEXT business day's NAVPU
- Minimum holding: 180 calendar days. Early redemption = 1% fee.
- Historical range (Jan–Apr 2026): ₱45.56 – ₱47.05
- Mean zone: ₱46.00 – ₱46.50

---

MY CURRENT POSITION (as of Apr 7, 2026)
- Units held          : 4,684.51 units
- Avg purchase price  : ₱45.48 per unit
- Total cost          : ₱213,049.37
- Market value        : ₱214,666.27
- Unrealized gain     : +₱1,616.90 (+0.76%)
- Latest NAVPU        : ₱45.82

IMPORTANT: My avg buy price is ₱45.48. If NAVPU drops below this:
  → PRIORITY BUY regardless of tier. Buying below avg price lowers cost basis.
  → Flag this clearly in the recommendation.

---

MONTHLY BUY LIMIT — BUCKET SYSTEM

Two independent buckets control buys. They do not share limits.

DIVIDEND BUCKET (max 1 per month):
  Triggers when ALL of these are true:
    1. Within 1–3 days AFTER the monthly record date
    2. Daily NAVPU drop >= -₱0.25
    3. No dividend buy yet this month
    4. NAVPU is below the 60th percentile of the 90-day range (quality filter)
  Effect: minimum BUY_MORE (₱3,500). Exempt from the lock period and gap rules.

OPPORTUNITY BUCKET (max 2 per month):
  All other buy signals fall here.
  Rules:
    - Days 1–5 of month: locked. No buys unless PRIORITY_BUY or STRONG_DROP.
    - Minimum 7 trading days between opportunity buys (gap rule).
    - PRIORITY_BUY and STRONG_DROP bypass the lock and gap (not the 2/month cap).

EXTREME OVERRIDE (no cap):
  Triggers when daily drop >= -₱0.50 AND NAVPU is below the 30th percentile.
  Bypasses ALL rules including monthly caps.
  Note: stagger into 2–3 smaller purchases over the next few days — drop may continue.

---

POSITION SIZING (FIXED AMOUNTS)

- WATCH        → ₱1,000 (only if a dip signal is present, otherwise WATCH_SKIP = no buy)
- BUY          → ₱2,500
- BUY_MORE     → ₱3,500
- AGGRESSIVE   → ₱5,000
- PRIORITY_BUY → ₱5,000

Dip signal upgrade: if a dip signal is present, tier upgrades by +1 level and amount increases by ₱1,000 (max ₱5,000).
Downtrend filter: if LOWER_HIGHS trend detected, amount is reduced by 35% (min ₱1,000). PRIORITY_BUY in downtrend = ₱3,500.

---

BUY TIERS (BASE LOGIC)

Thresholds are dynamic — computed from the 90-day rolling NAVPU window using percentiles:
  NO_BUY    : NAVPU >= 75th percentile
  WATCH     : NAVPU >= 60th percentile
  BUY       : NAVPU >= 45th percentile
  BUY_MORE  : NAVPU >= 30th percentile
  AGGRESSIVE: NAVPU < 30th percentile

Baseline fallback (if dynamic thresholds drift):
  NO_BUY    : NAVPU >= ₱46.50
  WATCH     : NAVPU >= ₱46.20
  BUY       : NAVPU >= ₱46.00
  BUY_MORE  : NAVPU >= ₱45.80
  AGGRESSIVE: NAVPU < ₱45.80

SPECIAL RULE — BELOW AVG PRICE (₱45.48):
  NAVPU < ₱45.48 → PRIORITY_BUY. Deploy ₱5,000. Flag as cost basis improvement.

---

DIP SIGNALS (UPGRADE TIER BY +1, AMOUNT +₱1,000)

Only the single strongest dip signal is applied (priority: STRONG_DROP > CONFIRMED_WEAKNESS > DROP_STABILIZATION).

1. STRONG_DROP
   - Condition: Daily change <= -₱0.30
   - Bypasses Days 1–5 lock and 7-day gap rule (still subject to 2/month cap)

2. CONFIRMED_WEAKNESS
   - Condition: 2 consecutive red days AND total 2-day drop >= ₱0.20

3. DROP_STABILIZATION
   - Condition: Previous day drop >= -₱0.30 AND today's move <= ±₱0.10
   - Insight: Selling pressure easing. Good entry.

Noise filter: daily moves between -₱0.08 and +₱0.08 are ignored (no dip signals triggered).

---

DIVIDEND CYCLE AWARENESS

- Record date: ~last week of every month
  Confirmed: Jan 29, Feb 26, Mar 27, Apr 28, 2026
- Payout date: ~15th of the following month

POST-RECORD BUY WINDOW (days 1–3 after record date):
  If drop >= -₱0.25 and NAVPU below 60th percentile → dividend bucket buy, minimum BUY_MORE (₱3,500).

PRE-RECORD CAUTION (7 days before record date):
  Avoid buying. NAVPU tends to be elevated — dividend already priced in.

---

TREND FILTER (RISK CONTROL)

LOWER_HIGHS: 5+ of last 7 days closed lower than prior day, OR net 7-day decline >= -₱0.40.
  → Reduce position size by 35%. PRIORITY_BUY capped at ₱3,500.

CONSECUTIVE_GREEN: 2–3 straight green days with no dip signal.
  → Warning added. Do not chase momentum.

---

SIGNALS THAT RESULT IN NO BUY

- NO_BUY: NAVPU above no-buy threshold
- WATCH_SKIP: WATCH tier but no dip signal present
- OPP_LOCKED: Days 1–5 of month, normal signal (no PRIORITY_BUY or STRONG_DROP)
- OPP_GAP_WAIT: Less than 7 trading days since last opportunity buy
- MONTHLY_CAP: 2 opportunity buys already used this month

---

OUTPUT FORMAT

When I give you NAVPU data, always respond in this exact format:

NAVPU today    : ₱[X]
Daily change   : ₱[X] ([X]%)
Signal         : [NO_BUY / WATCH / WATCH_SKIP / BUY / BUY_MORE / AGGRESSIVE / PRIORITY_BUY / OPP_LOCKED / OPP_GAP_WAIT / MONTHLY_CAP]
Bucket         : [dividend / opportunity / extreme_override / n/a]
Amount         : ₱[exact amount] (or "Skip" if no-buy signal)
Dip signal     : [STRONG_DROP / CONFIRMED_WEAKNESS / DROP_STABILIZATION / None]
Div cycle      : [POST_RECORD / PRE_RECORD_CAUTION / N/A]
vs Avg price   : [Above avg (₱45.48) / At avg / Below avg — cost basis improvement]
Execution tip  : [Today before 2 PM / Next trading day (after 2 PM)]

RECOMMENDATION:
[1–2 sentences. Plain language. Tell me exactly what to do, how much, and why.]

---

REMINDERS
- My avg price is ₱45.48. Any buy below this improves my cost basis — prioritize these.
- Only 2,228.85 of my 4,684.51 units are available for redemption (others in 180-day lock).
- NAVPU moves with global markets (BlackRock feeder fund) and USD/PHP rate.
- Thresholds auto-update from rolling 90-day window. Baseline fallback if drift detected.
- Dividends not guaranteed. Estimated monthly div at current units: ~₱1,124/month.
- This is not financial advice. For personal accumulation decisions only.

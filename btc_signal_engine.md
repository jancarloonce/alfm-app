# BTC Signal Engine — Drawdown Buy Strategy

**Version:** 3.0 — Drawdown Buy-Only (replaces v2 Swing Trade)
**Last updated:** Oct 19, 2026
**Exchange:** PDAX (PHP pairs)
**Budget:** ₱10,000/month, ₱500–₱1,000 per buy
**Schedule:** Hourly check, 24/7

---

## Core Philosophy

> Buy when BTC drops significantly from its recent high. History shows these drawdowns recover +8% within 30 days.

Buy-only engine. No sell signals — user manages exits independently.
**Backtest basis:** Drawdown-from-30d-high produces consistent 8%+ recovery within 30 days at the right thresholds.

---

## 1. Signal Logic

### Drawdown Calculation

Every hour, compute how far the current price has dropped from the **30-day high**:

```
drawdownPct = ((high30d - currentPrice) / high30d) * 100
```

### Drawdown Tiers

| Drawdown | Signal | Buy Amount |
|---|---|---|
| < 3% | `NO_BUY` | ₱0 |
| 3–5% | `BUY` | ₱500 |
| 5–10% | `BUY_MORE` | ₱750 |
| 10–15% | `AGGRESSIVE` | ₱1,000 |
| ≥ 15% | `PRIORITY_BUY` | ₱1,000 |

Average cost is displayed as context (email + UI) but does **not** override signal tiers. Drawdown is the sole primary driver.

### RSI Modifier (±1 tier)

| Condition | Effect |
|---|---|
| RSI < 30 (oversold) | Upgrade tier by +1 (e.g. BUY → BUY_MORE) |
| RSI > 70 (overbought) | Downgrade tier by -1 (e.g. BUY → NO_BUY) |

RSI modifiers shift the tier, which changes the amount to that tier's default.

### Fear & Greed Scaling (amount multiplier)

Fear & Greed does **not** change the tier — it scales the buy amount after tier selection:

| F&G Value | Label | Multiplier |
|---|---|---|
| ≤ 25 | Extreme Fear | 1.5× |
| 26–45 | Fear | 1.2× |
| 46–55 | Neutral | 1.0× |
| 56–75 | Greed | 0.8× |
| > 75 | Extreme Greed | 0.5× |

The scaled amount is rounded to the nearest ₱50, then clamped between ₱500 and ₱1,000.

---

## 2. Guards

### Monthly Budget Cap
Hard cap: ₱10,000/month. If `totalSpentThisMonth + amount > 10000`, signal becomes `BUDGET_CAP`.

### Minimum Gap
At least **1 hour** between actionable buy signals to prevent rapid-fire buys.

### Macro Drawdown Kill-Switch
If BTC is **≥ 25% below its 90-day high**, buy sizes are reduced to **60%** of normal amounts. AGGRESSIVE tier is also downgraded to BUY_MORE.

### Extreme Override
If price drops **≥ 4% in 1 hour** and fewer than 2 extreme overrides have fired in the last 24h, the signal is set to minimum `BUY_MORE` (if not already higher) with `bucket = 'extreme_override'`, bypassing the gap rule and budget cap. If 2 or more extreme overrides have already fired in 24h, the signal falls back to the normal opportunity bucket.

---

## 3. Signals

| Signal | Email? | Action |
|---|---|---|
| `NO_BUY` | No | Drawdown too small or downgraded by modifiers |
| `BUY` | Yes | Buy ₱500 on PDAX |
| `BUY_MORE` | Yes | Buy ₱750 on PDAX |
| `AGGRESSIVE` | Yes | Buy ₱1,000 on PDAX |
| `PRIORITY_BUY` | Yes | Buy ₱1,000 on PDAX — deep drawdown or below avg cost |
| `OPP_GAP_WAIT` | No | Actionable signal but too soon after last buy |
| `BUDGET_CAP` | No | Monthly ₱10k limit reached |

Email is only sent for actionable buy signals. No daily digest.

### Email Contents
- Signal name and recommended PHP amount
- BTC price in USD and PHP (using hardcoded rate ₱57.5/USD)
- Drawdown percentage from 30-day high
- RSI value and label
- Fear & Greed index and label
- Recommendation text

---

## 4. Backtest

The backtest validates the drawdown strategy over historical data.

### Key Metrics
- **8% Recovery Rate (30d):** What percentage of buy signals saw BTC reach +8% from entry within 30 days
- **Avg Max Return (30d):** Average peak return within 30 days of each buy signal
- **Drawdown Analysis:** Recovery rates grouped by drawdown bucket (0-3%, 3-5%, 5-10%, 10-15%, 15-20%, 20%+)
- **Win rates** at 1h, 3h, 6h, 12h, 24h, 72h, 30d horizons

### Schedule
Backtest runs automatically on the 1st and 15th of each month. Can be triggered manually:
```bash
curl https://us-central1-alfm-tracker.cloudfunctions.net/runBtcBacktest?days=395
```

---

## 5. Firestore Structure

### `btc_position/current`

```
totalUnits          BTC accumulated
totalCostUsd        total USD spent
avgCostUsd          weighted average cost
lastBuyTimestamp    ISO
```

### `btc_signals/{YYYY-MM-DDTHH}`
One doc per hourly run. Includes: signal, amount, drawdownPct, drawdownHigh, rsi, fearGreedIndex, currentPrice, phpPerUsd, recommendation.

### `btc_buys`
One doc per buy execution. Includes: date, amountPhp, btcPriceUsd, phpPerUsd, unitsBought, signalName, bucket, avgCostAfterUsd.

### `btc_config/btc_backtest_summary`
Backtest results: simulation, drawdown analysis, win rates, equity curve, Sharpe ratio, signal breakdown.

---

## 6. UI

### BTC Tab Components
- **Signal Card** — Latest signal with drawdown, RSI, Fear & Greed, volume, avg cost context
- **Position Card** — Current holdings, avg cost, unrealized P&L
- **Buy Log** — Chronological list of all recorded buys
- **Sell Log** — Chronological list of all recorded sells with realized P&L
- **Backtest Card** — Overview (equity curve, simulation, risk metrics, win rates, 8% recovery rate, drawdown analysis), Win Rates (by horizon and bucket), Signals (distribution, best/worst)

### Overview Page
BTC is included in the portfolio overview: portfolio summary totals, today's signals, positions table, and allocation pie chart.

### Floating Buttons
**₿ I Sold** (green) + **₿ I Bought** (orange) — opens sell/buy modal to log transactions.

---

## 7. Deployment

```bash
npm run build && firebase deploy
```

### Required Firestore Index
`btc_buys` collection needs composite index: `bucket` (ASC) + `timestamp` (ASC).
Defined in `firestore.indexes.json`.

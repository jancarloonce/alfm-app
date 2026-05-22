# BTC Signal Engine — Swing Trade Strategy

**Version:** 2.0 — Swing Trade (replaces v1 DCA engine)
**Last updated:** Apr 23, 2026
**Exchange:** PDAX (PHP pairs, 0.5% taker fee)
**Starting balance:** ₱15,000 (grows compounding each cycle)
**Schedule:** Hourly check, 24/7

---

## Core Philosophy

> Buy short-term weakness. Hold 2–5 days. Exit into bounce strength.

Not prediction. Structured mean reversion.
**Backtest basis:** 72h win rate = 73.2% with avg +1.376% return — the clearest edge in the data.

---

## State Machine

```
FLAT → BUILDING → FULL → FLAT (repeat)
```

| State | Meaning |
|---|---|
| `FLAT` | No position. Engine scanning for Entry 1. |
| `BUILDING` | 1–2 entries placed. Watching for additional entries or exits. |
| `FULL` | All 3 entries placed. Watching exits only. |

---

## 1. Market Context Filter (Macro)

Checked every hour before any entry logic.

| Condition | Action |
|---|---|
| 7-day drop ≤ -10% | **KILL SWITCH** — pause all new entries for 24h |
| Price below 200-day MA | **REDUCED** — entry size cut 50% |
| Price above 200-day MA | **NORMAL** — full entry size |

The 200-day MA is fetched from Binance daily candles (200 periods).

---

## 2. Entry Setup

### Entry 1 — All conditions must be true

| Condition | Threshold | Why |
|---|---|---|
| 24h price drop | -3% to -8% | Short-term panic window. Below -8% = flush risk. |
| RSI (1h, period 14) | < 35 | Oversold — selling exhaustion present |
| Stabilization | Green candle OR body ≤ 0.3% | Avoids catching exact knife |
| Volume | ≥ 1.2× 30-day avg | Confirms real selling pressure, not illiquid wick |
| Bounce from 24h low | ≤ 2% | Don't chase — must be near the low |

### Entry 2 — Triggered automatically
Price drops **-2% from Entry 1** price while BUILDING.

### Entry 3 — Triggered automatically
Price drops **-2% from Entry 2** price while BUILDING with 2 entries.

### Position sizing

| Macro mode | Per entry | Total max |
|---|---|---|
| NORMAL | balance ÷ 3 (~₱5,000) | ₱15,000 |
| REDUCED (below 200 MA) | balance ÷ 6 (~₱2,500) | ₱7,500 |

Balance grows each cycle. Entry amounts scale automatically.

---

## 3. Exit Strategy

Exit levels computed from **average entry price** across all entries.

### Scaled Take Profits

| Target | Price trigger | Action | Net after PDAX fees (~) |
|---|---|---|---|
| TP1 | avg entry × 1.02 (+2%) | Sell 30% of BTC | ~+1.0% net |
| TP2 | avg entry × 1.04 (+4%) | Sell 40% of remaining | ~+3.0% net |
| TP3 | avg entry × 1.06 (+6%) | Sell remaining 30% | ~+5.0% net |

### Stop Loss

| Trigger | Action |
|---|---|
| Price ≤ avg entry × 0.92 (-8%) | Sell ALL immediately |

### Time-Based Exit

| Trigger | Action |
|---|---|
| 120 hours (5 days) from first entry | Exit at market regardless of price |

**Why 120h?** Capital discipline — prevents indefinite lock-up in sideways markets. The 72h window is where the edge is; beyond 120h the edge decays.

**Minimum hold:** 24h before TP1 triggers (prevents shaking out on normal volatility).

---

## 4. Kill Switch

If BTC drops **-10% or more in the past 7 days** → engine pauses ALL new entries for 24 hours.

Protects against entering during a macro flush when mean reversion timing is unreliable.

---

## 5. Signals

| Signal | State | Email? | Action required |
|---|---|---|---|
| `SCAN` | FLAT | No | Watching — conditions not met |
| `KILL_SWITCH` | Any | No | Entries paused 24h |
| `ENTRY_1` | FLAT | Yes | Buy ₱5,000 on PDAX, log via I Bought |
| `ADD_ENTRY` | BUILDING | Yes | Add next ₱5,000 tranche on PDAX |
| `HOLDING` | BUILDING/FULL | Daily 9AM | In position — waiting |
| `TP1_HIT` | BUILDING/FULL | Yes | Sell 30% on PDAX, log via I Sold |
| `TP2_HIT` | BUILDING/FULL | Yes | Sell 40% of remaining on PDAX |
| `TP3_HIT` | BUILDING/FULL | Yes | Sell remaining 30% on PDAX |
| `TIME_EXIT` | Any | Yes | 120h limit — exit at market on PDAX |
| `STOP_LOSS` | Any | Yes | -8% hit — sell ALL immediately on PDAX |

---

## 6. Compounding

Each completed cycle the balance grows:

```
Cycle 1:  ₱15,000 invested → +profit → new balance
Cycle 2:  new balance ÷ 3 per entry → ...
```

Entry amounts always = `currentBalancePhp ÷ 3` (or ÷ 6 when REDUCED).

---

## 7. Firestore Structure

### `btc_position/current`

```
state               'FLAT' | 'BUILDING' | 'FULL'
currentBalancePhp   grows with profits
entryCount          0–3
entries             [{ priceUsd, amountPhp, timestamp }]
avgEntryPriceUsd    weighted average of all entry prices
totalDeployedPhp    sum of all entry PHP amounts
firstEntryTimestamp ISO — start of 120h timer
stopLossUsd         avgEntry × 0.92
tp1Usd              avgEntry × 1.02
tp2Usd              avgEntry × 1.04
tp3Usd              avgEntry × 1.06
hardExitTimestamp   firstEntry + 120h
tp1Triggered        boolean
tp2Triggered        boolean
macroMode           'NORMAL' | 'REDUCED' | 'PAUSED'
killSwitchUntil     ISO or null
```

### `btc_signals/{YYYY-MM-DDTHH}`
One doc per hourly run. Full signal output including all entry/exit context.

### `btc_trades`
One doc per completed trade cycle (TP3, TIME_EXIT, STOP_LOSS, or manual sell).

### `btc_buys`
One doc per individual entry execution (ENTRY_1 and ADD_ENTRY events).

---

## 8. vs Previous DCA Engine (v1)

| Aspect | v1 DCA Engine | v2 Swing Engine |
|---|---|---|
| Frequency | Every actionable hourly signal | 1–3 entries per setup |
| Entry gate | Buy zone + dip signal | Drop + RSI + stabilization + volume |
| Position size | ₱500–₱1,000 per buy | ₱5,000 × 3 entries |
| Exit | Single price target (7%) | Scaled TP1/TP2/TP3 + time + SL |
| Stop loss | None | -8% hard stop |
| Hold clarity | Implicit | Explicit 24–120h |
| Edge alignment | Partial | Direct (72h mean reversion) |
| Capital risk | Spread small buys | Concentrated, managed with SL |

---

## 9. PDAX Fee Impact

PDAX taker fee: **0.5% per side** = **1.0% round-trip per sell**.

| Gross move | Net after fees |
|---|---|
| +2% (TP1) | ~+1.0% |
| +4% (TP2) | ~+3.0% |
| +6% (TP3) | ~+5.0% |
| -8% (SL) | ~-9.0% |

Blended net per full cycle (30%×TP1 + 40%×TP2 + 30%×TP3): **~+2.8% net**.

---

## 10. Deployment

```bash
# Build and deploy everything
npm run build && firebase deploy

# Initialize position state (run once after first deploy or reset)
curl https://us-central1-alfm-tracker.cloudfunctions.net/initBtcPosition
```

### Required Firestore Index
`btc_buys` collection needs composite index: `bucket` (ASC) + `timestamp` (ASC).
Already defined in `firestore.indexes.json`.

---

## 11. UI Reference

| State | Floating button |
|---|---|
| FLAT | None (no position to sell) |
| BUILDING / FULL | **I Sold** (green) — opens sell modal |

The position card shows staggered entries, avg entry price, TP levels with prices, stop loss, hold time, and hard exit countdown.

The signal card shows entry conditions met/unmet in real time so you can see how close BTC is to triggering an entry.

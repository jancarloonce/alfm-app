# ALFM Fund Tracker

Personal investment tracker for **ALFM Global Multi-Asset Income Fund (PHP)**:a BlackRock-backed mutual fund distributed by BPI in the Philippines.

## What it does

- Scrapes the latest NAVPU every morning at **9:00 AM Asia/Manila**
- Runs a rule-based signal engine to produce a daily buy recommendation
- Sends a signal email with the recommended action and peso amount
- Tracks your position, buy history, and unrealized gain/loss in real time
- Displays monthly dividend history and estimates future payouts
- Backtests the signal strategy against historical NAVPU data (runs on the 1st and 15th of each month)

## Stack

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Firebase Cloud Functions v2 (Node.js)
- **Database:** Firestore (real-time listeners)
- **Hosting:** Firebase Hosting
- **Email:** Nodemailer via Gmail SMTP
- **Scraping:** Puppeteer (headless Chrome)

## Project structure

```
alfm-app/
  src/
    components/
      SignalCard.jsx       # Daily buy signal + NAVPU display
      PositionCard.jsx     # Portfolio position summary
      NavpuCard.jsx        # NAVPU stats (90-day high/low/mean)
      NavChart.jsx         # 90-day NAVPU chart with buy markers
      DividendCard.jsx     # Dividend history and upcoming payouts
      BuyLog.jsx           # Buy transaction history
      BuyModal.jsx         # Log a new buy
      BacktestCard.jsx     # Strategy backtest results
    lib/
      firebase.js          # Firestore + Functions client init
    App.jsx
  functions/
    index.js               # Cloud Function exports
    signalEngine.js        # Pure signal logic (no Firebase)
    backtest.js            # Backtest engine
    emailer.js             # HTML email builder + sender
    scraper.js             # Puppeteer NAVPU scraper
    historical_navpu_data.js  # 1,121 NAVPU entries (2021-2026)
  SIGNAL_ENGINE.md         # Full signal engine documentation
```

## Signal engine

The signal engine is a pure function that takes today's NAVPU and context data and returns one of:

| Signal | Meaning | Amount |
|---|---|---|
| NO_BUY | NAVPU too high | 0 |
| WATCH / SKIP | Watch zone, no dip signal | 0 |
| WATCH | Watch zone with dip signal | 1,000 |
| BUY | Standard entry | 2,500 |
| BUY_MORE | Strong dip | 3,500 |
| AGGRESSIVE | Near period low | 5,000 |
| PRIORITY_BUY | Below your avg price | 5,000 |
| NO_SECOND_BUY | 1 buy done, no exception | 0 |
| MONTHLY_CAP | 2 buys done this month | 0 |

Tier boundaries are **dynamic**:computed from the 75th/60th/45th/30th percentiles of the rolling 90-day NAVPU window. See `SIGNAL_ENGINE.md` for full documentation.

## Cloud Functions

| Function | Trigger | Description |
|---|---|---|
| `dailyNavpuCheck` | 9:00 AM daily (Asia/Manila) | Scrapes NAVPU, generates signal, detects dividends, sends email |
| `recordBuy` | onCall | Logs a buy and updates position |
| `scheduledBacktest` | 1st and 15th of month, 10:00 AM | Re-runs backtest and updates Firestore |
| `runBacktest` | HTTP GET/POST | Manual backtest trigger |
| `seedHistoricalNavpu` | HTTP GET/POST | One-time seed of 1,121 historical NAVPU entries |
| `seedDividends` | HTTP GET/POST | One-time seed of 20 historical dividend records |
| `seedInitialData` | HTTP GET/POST | One-time seed of initial position and config |

## Setup

### 1. Install dependencies

```bash
npm install
cd functions && npm install
```

### 2. Configure Firebase

```bash
firebase login
firebase use alfm-tracker
```

### 3. Set Gmail secrets

```bash
firebase functions:secrets:set GMAIL_USER
firebase functions:secrets:set GMAIL_PASS
```

### 4. Deploy

```bash
firebase deploy
```

### 5. Seed historical data (one-time)

```bash
curl https://us-central1-alfm-tracker.cloudfunctions.net/seedHistoricalNavpu
curl https://us-central1-alfm-tracker.cloudfunctions.net/seedDividends
curl https://us-central1-alfm-tracker.cloudfunctions.net/runBacktest
```

### 6. Local development

```bash
npm run dev
```

## Firestore collections

| Collection | Description |
|---|---|
| `navpu_history/{date}` | Daily NAVPU records |
| `signals/{date}` | Daily signal output |
| `position/current` | Current portfolio position |
| `buys/{id}` | Buy transaction log |
| `dividends/{record_date}` | Dividend history (auto-detected + seeded) |
| `config/thresholds` | Dynamic tier thresholds |
| `config/backtest_summary` | Latest backtest summary stats |
| `backtest_results/{date}` | Per-day backtest results |

## Notes

- NAVPU is published with a **1-day lag** by BPI. The 9 AM signal uses the previous business day's closing NAVPU.
- Orders placed **before 2:00 PM** execute at today's NAVPU. After 2 PM executes at next business day's NAVPU.
- The fund has a **180-day lock-up** on new units.
- Monthly dividend record dates are approximately the last business day of each month.
- Dividend docs are auto-detected from the NAVPU ex-dividend drop the morning after each record date.

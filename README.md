# ALFM Fund Tracker

Multi-fund investment tracker for Philippine UITFs and BTC. Tracks **ALFM**, **MGPIFF**, **BPI Bond (BPIBGIF)**, **MREIT**, **ATRAM Nasdaq**, and **BTC** with daily buy signals, email alerts, dividend tracking, and backtesting.

Live at [alfm-tracker.web.app](https://alfm-tracker.web.app)

## What it does

- Scrapes the latest NAVPU daily at **4:00 PM Asia/Manila** (ALFM, MGPIFF, BPIBGIF)
- Runs a rule-based signal engine per fund to produce daily buy recommendations
- Sends a consolidated signal email with recommended actions and peso amounts
- Tracks positions, buy history, and unrealized gain/loss per fund in real time
- Displays monthly dividend history and estimates future payouts per fund
- Backtests each fund's signal strategy against historical NAVPU data (1st and 15th of each month)
- Monitors BTC price hourly with drawdown-based buy signals

## Funds tracked

| Tab | Fund | Source | Signal Type |
|-----|------|--------|-------------|
| Overview | All funds combined | — | Portfolio summary, allocation chart |
| ALFMGMP | ALFM Global Multi-Asset Income Fund (PHP) | alfmmutualfunds.com + BPI fallback | Percentile-based tiers |
| MGPIFF | Manulife Global Preferred Income Feeder Fund | uitf.com.ph (fund_id=357) | Percentile-based tiers |
| BPIBGIF | BPI Global Bond Income Fund (PHP) | uitf.com.ph (fund_id=558) | Percentile-based tiers |
| MREIT | Manulife Global REIT Feeder Fund (PHP Unhedged) | uitf.com.ph | Percentile-based tiers |
| ATRAM | ATRAM Nasdaq Equity Income Feeder Fund | Manual / TBD | Percentile-based tiers |
| BTC | Bitcoin | External price APIs | Drawdown from 30d high |

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS + Recharts
- **Backend:** Firebase Cloud Functions v2 (Node.js 20)
- **Database:** Firestore (real-time listeners)
- **Hosting:** Firebase Hosting
- **Email:** Nodemailer via Gmail SMTP
- **Scraping:** Puppeteer (ALFM), uitf.com.ph JSON API (MGPIFF, BPIBGIF, MREIT), manual entry (ATRAM)
- **Design:** Vercel/Linear-inspired dark UI — solid surfaces, subtle borders, no decorative effects

## Project structure

```
alfm-app/
  src/
    components/
      PortfolioDashboard.jsx  # Overview: all funds combined
      SignalCard.jsx           # UITF daily buy signal
      PositionCard.jsx         # UITF portfolio position
      NavpuCard.jsx            # NAVPU stats (90-day high/low/mean)
      NavChart.jsx             # 90-day NAVPU chart with buy markers
      DividendCard.jsx         # ALFM dividend history
      MgpiffDividendCard.jsx   # MGPIFF dividend history
      BpibondDividendCard.jsx  # BPIBGIF dividend history
      MreitDividendCard.jsx    # MREIT dividend history
      AtramDividendCard.jsx    # ATRAM Nasdaq dividend history
      BuyLog.jsx               # UITF buy transaction history
      BuyModal.jsx             # ALFM buy modal
      MgpiffBuyModal.jsx       # MGPIFF buy modal
      BpibondBuyModal.jsx      # BPIBGIF buy modal
      MreitBuyModal.jsx        # MREIT buy modal
      AtramBuyModal.jsx        # ATRAM Nasdaq buy modal
      BacktestCard.jsx         # Shared backtest results (parameterized)
      BtcSignalCard.jsx        # BTC signal display
      BtcPositionCard.jsx      # BTC position + P&L
      BtcBuyLog.jsx            # BTC buy history
      BtcSellLog.jsx           # BTC sell history
      BtcBuyModal.jsx          # BTC buy modal
      BtcSellModal.jsx         # BTC sell modal
      BtcBacktestCard.jsx      # BTC backtest results
      BtcPriceChart.jsx        # BTC price chart
    lib/
      firebase.js              # Firestore + Functions client init
    App.jsx
  functions/
    index.js                   # Cloud Function exports
    signalEngine.js            # ALFM signal logic
    mgpiffSignalEngine.js      # MGPIFF signal logic
    bpibondSignalEngine.js     # BPIBGIF signal logic
    mreitSignalEngine.js       # MREIT signal logic
    atramSignalEngine.js       # ATRAM Nasdaq signal logic
    btcSignalEngine.js         # BTC drawdown signal logic
    backtest.js                # ALFM backtest engine
    mgpiffBacktest.js          # MGPIFF backtest engine
    bpibondBacktest.js         # BPIBGIF backtest engine
    mreitBacktest.js           # MREIT backtest engine
    atramBacktest.js           # ATRAM Nasdaq backtest engine
    btcBacktest.js             # BTC backtest engine
    emailer.js                 # HTML email builder + sender
    scraper.js                 # Puppeteer NAVPU scraper (ALFM)
    mgpiffScraper.js           # MGPIFF NAVPU scraper
    bpibondScraper.js          # BPIBGIF NAVPU scraper
    mreitScraper.js            # MREIT NAVPU scraper
    atramScraper.js            # ATRAM Nasdaq NAVPU scraper (placeholder)
    historical_navpu_data.js   # ALFM historical NAVPU entries
  SIGNAL_ENGINE.md             # ALFM signal engine documentation
  btc_signal_engine.md         # BTC signal engine documentation
  buy-strategy.md              # ALFM buy strategy reference
  SETUP.md                     # Setup guide
```

## Signal engine (UITFs)

Each UITF fund uses a percentile-based signal engine with dynamic thresholds computed from the 90-day rolling NAVPU window.

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

Bucket system: dividend bucket (1/month), opportunity bucket (2/month), extreme_override. See `SIGNAL_ENGINE.md` for full documentation.

## BTC signal engine

Drawdown-based buy-only strategy. See `btc_signal_engine.md` for full documentation.

| Drawdown from 30d high | Signal | Amount |
|---|---|---|
| < 3% | NO_BUY | ₱0 |
| 3–5% | BUY | ₱500 |
| 5–10% | BUY_MORE | ₱750 |
| 10–15% | AGGRESSIVE | ₱1,000 |
| ≥ 15% | PRIORITY_BUY | ₱1,000 |

## Cloud Functions

### Per UITF fund (ALFM, MGPIFF, BPIBGIF, MREIT, ATRAM)

| Function | Trigger | Description |
|---|---|---|
| `daily[Fund]Check` | 4:00 PM daily (Asia/Manila) | Scrapes NAVPU, generates signal, detects dividends, sends email |
| `record[Fund]Buy` | onCall | Logs a buy and updates position (supports pending buys) |
| `confirmPendingBuy` | onCall | Confirms a pending buy with actual NAVPU |
| `recalc[Fund]Position` | HTTP | Rebuilds position from all buys |
| `run[Fund]Backtest` | HTTP | Manual backtest trigger |
| `scheduled[Fund]Backtest` | 1st/15th of month, 11:00 AM | Scheduled backtest |
| `seed[Fund]Data` | HTTP | One-time data seed |

### BTC

| Function | Trigger | Description |
|---|---|---|
| `btcHourlySignalCheck` | Hourly | Checks BTC price, generates drawdown signal, sends email on buy |
| `recordBtcBuy` / `recordBtcSell` | onCall | Logs BTC transactions |
| `runBtcBacktest` | HTTP | Manual BTC backtest trigger |
| `scheduledBtcBacktest` | 1st/15th of month | Scheduled BTC backtest |

## Setup

See `SETUP.md` for the full setup guide.

```bash
npm install && cd functions && npm install && cd ..
firebase login && firebase use alfm-tracker
firebase functions:secrets:set GMAIL_USER
firebase functions:secrets:set GMAIL_PASS
npm run build && firebase deploy
```

## Firestore collections

Each fund uses prefixed collections (`mgpiff_`, `bpibond_`, `mreit_`, `atram_`, `btc_`). ALFM uses unprefixed names.

| Collection | Description |
|---|---|
| `[prefix]navpu_history/{date}` | Daily NAVPU records |
| `[prefix]signals/{date}` | Daily signal output |
| `[prefix]position/current` | Current portfolio position |
| `[prefix]buys/{id}` | Buy transaction log |
| `[prefix]dividends/{record_date}` | Dividend history |
| `[prefix]config/thresholds` | Dynamic tier thresholds |
| `[prefix]config/backtest_summary` | Latest backtest summary |

## Notes

- NAVPU is published with a **1-day lag** by BPI. The 4 PM signal uses the previous business day's closing NAVPU.
- Orders placed **before 2:00 PM** execute at today's NAVPU. After 2 PM executes at next business day's NAVPU.
- ALFM has a **180-day lock-up** on new units. Early redemption = 1% fee.
- Dividend record dates vary per fund: ALFM last business day, MGPIFF 7th trading day, BPIBGIF last business day, MREIT 7th trading day, ATRAM 7th trading day (est.).
- ATRAM Nasdaq orders must be placed before **10:00 AM** via DragonFi. No minimum holding period, no early exit fee. 7 business day redemption. NAVPU source is manual until automated scraping is set up.
- BTC signals check hourly with a 1-hour minimum gap between actionable signals and ₱10k/month budget cap.

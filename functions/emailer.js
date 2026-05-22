'use strict'

const nodemailer = require('nodemailer')

const TO_EMAIL = 'jancarloonce11@gmail.com'

/**
 * Format a peso amount with ₱ prefix and comma separators.
 */
function fmtPeso(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return (
    '₱' +
    Number(n).toLocaleString('en-PH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}

function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return Number(n).toFixed(d)
}

/**
 * Build the HTML email body.
 */
function buildEmailHtml(signal, todayStr, { isStaleNavpu = false, navpuDate = null, expectedNavpuDate = null } = {}) {
  const {
    signal: signalName,
    amount,
    dailyChange,
    dailyChangePct,
    todayNavpu,
    avgPrice,
    vsAvg,
    dipSignals,
    divCycle,
    trendWarning,
    staggerWarning,
    recommendation,
    isActionable,
  } = signal

  const isUp = dailyChange > 0
  const isDown = dailyChange < 0
  const changeSign = isUp ? '+' : ''
  const changeColor = isUp ? '#22c55e' : isDown ? '#ef4444' : '#94a3b8'

  const signalColors = {
    NO_BUY: '#64748b',
    WATCH: '#eab308',
    WATCH_SKIP: '#ca8a04',
    BUY: '#3b82f6',
    BUY_MORE: '#22c55e',
    AGGRESSIVE: '#10b981',
    PRIORITY_BUY: '#6ee7b7',
    NO_SECOND_BUY: '#f97316',
    MONTHLY_CAP: '#ef4444',
  }

  const signalColor = signalColors[signalName] || '#94a3b8'

  const vsAvgText =
    vsAvg === 'BELOW_AVG'
      ? `Below ₱${fmt(avgPrice, 2)} ↓ Good entry!`
      : vsAvg === 'ABOVE_AVG'
      ? `Above ₱${fmt(avgPrice, 2)} ↑`
      : `At ₱${fmt(avgPrice, 2)}`

  const exceptionText = (() => {
    if (signalName === 'MONTHLY_CAP') return 'N/A (monthly cap)'
    if (signalName === 'NO_SECOND_BUY') return 'No (no exception applies)'
    if (isActionable) {
      if (dailyChange <= -0.30) return 'Yes (Exception 1: drop <= -0.30)'
      if (todayNavpu < avgPrice) return 'Yes (Exception 2: below avg price)'
      if (divCycle === 'POST_RECORD' && dailyChange <= -0.25) return 'Yes (Exception 3: post-record dip)'
    }
    return 'N/A'
  })()

  const dipText =
    dipSignals && dipSignals.length > 0
      ? `Yes: ${dipSignals.map((d) => d.replace(/_/g, ' ')).join(', ')}`
      : 'No'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ALFM Daily Signal</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
  .container { max-width: 580px; margin: 0 auto; padding: 24px 16px; }
  .header { background: #1e293b; border-radius: 12px 12px 0 0; padding: 24px; border-bottom: 2px solid #334155; }
  .header h1 { margin: 0; font-size: 20px; color: #f1f5f9; }
  .header p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
  .body { background: #1e293b; padding: 24px; border-radius: 0 0 12px 12px; }
  .signal-badge { display: inline-block; padding: 8px 20px; border-radius: 999px; font-weight: 700; font-size: 18px; margin-bottom: 16px; }
  .amount { font-size: 28px; font-weight: 800; color: #f1f5f9; margin-bottom: 20px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; }
  .row:last-child { border-bottom: none; }
  .label { color: #94a3b8; font-size: 13px; }
  .value { color: #f1f5f9; font-size: 13px; font-weight: 600; text-align: right; }
  .recommendation { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin: 20px 0; color: #cbd5e1; font-size: 14px; line-height: 1.6; }
  .warning { background: #451a03; border: 1px solid #92400e; border-radius: 8px; padding: 12px 16px; margin: 12px 0; color: #fcd34d; font-size: 13px; }
  .tip { color: #475569; font-size: 12px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #334155; }
  .footer { text-align: center; color: #334155; font-size: 11px; margin-top: 16px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>ALFM Daily Signal</h1>
    <p>${todayStr} &middot; Asia/Manila</p>
  </div>
  <div class="body">
    ${isStaleNavpu ? `
    <div class="warning">
      ⚠️ STALE DATA: Website not yet updated. NAVPU shown (₱${fmt(todayNavpu, 2)}) is from ${navpuDate}, expected ${expectedNavpuDate || todayStr}. Signal may be inaccurate — verify before acting.
    </div>` : ''}
    <div class="signal-badge" style="background-color: ${signalColor}22; color: ${signalColor}; border: 1px solid ${signalColor}55;">
      ${signalName.replace(/_/g, ' ')}
    </div>
    ${amount > 0 ? `<div class="amount">${fmtPeso(amount, 0)}</div>` : ''}

    <div style="margin-bottom: 16px;">
      <div class="row">
        <span class="label">NAVPU ${isStaleNavpu ? `(${navpuDate})` : 'Today'}</span>
        <span class="value">₱${fmt(todayNavpu, 2)}${isStaleNavpu ? ' ⚠️' : ''}</span>
      </div>
      <div class="row">
        <span class="label">Daily Change</span>
        <span class="value" style="color: ${changeColor};">
          ${changeSign}${fmt(dailyChange, 4)} (${changeSign}${fmt(dailyChangePct, 2)}%)
        </span>
      </div>
      <div class="row">
        <span class="label">vs Avg Price</span>
        <span class="value">${vsAvgText}</span>
      </div>
      <div class="row">
        <span class="label">Dip Signal</span>
        <span class="value">${dipText}</span>
      </div>
      <div class="row">
        <span class="label">Exception Rule</span>
        <span class="value">${exceptionText}</span>
      </div>
      <div class="row">
        <span class="label">Dividend Cycle</span>
        <span class="value">${divCycle || 'N/A'}</span>
      </div>
      ${trendWarning ? `
      <div class="row">
        <span class="label">Trend Warning</span>
        <span class="value" style="color: #fb923c;">${String(trendWarning).replace(/_/g, ' ')}</span>
      </div>` : ''}
    </div>

    ${staggerWarning ? `
    <div class="warning">
      ⚠️ STAGGER WARNING: Extreme drop detected (&le; -0.50). Consider splitting into 2&ndash;3 smaller buys over the next few trading days. Each purchase counts toward your monthly cap.
    </div>` : ''}

    <div class="recommendation">
      <strong style="color: #f1f5f9; display: block; margin-bottom: 8px;">Recommendation</strong>
      ${recommendation}
    </div>

    <div class="tip">
      ⏰ <strong>Execution tip:</strong> Place your order <strong>before 2:00 PM PH time</strong>. Latest published NAVPU is ₱${fmt(todayNavpu, 2)} (T-1). Your actual execution price will be today's closing NAVPU.
    </div>
  </div>
  <div class="footer">
    ALFM Fund Tracker &middot; Automated daily signal &middot; ${todayStr}<br>
    <a href="https://alfm-tracker.web.app" style="color: #475569; text-decoration: none;">alfm-tracker.web.app</a>
  </div>
</div>
</body>
</html>
`
}

/**
 * Send the daily signal email.
 *
 * @param {object} signal - result from analyzeSignal()
 * @param {string} todayStr - 'YYYY-MM-DD'
 * @param {string} gmailUser - Gmail address
 * @param {string} gmailPass - Gmail app password
 */
async function sendSignalEmail(signal, todayStr, gmailUser, gmailPass, navpuMeta = {}) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // STARTTLS
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  })

  const { signal: signalName, amount, todayNavpu } = signal
  const { isStaleNavpu = false } = navpuMeta
  const subject = `ALFM Signal: ${signalName.replace(/_/g, ' ')} ${
    amount > 0 ? fmtPeso(amount, 0) : ''
  } | NAVPU ₱${fmt(todayNavpu, 2)}${isStaleNavpu ? ' ⚠️ STALE' : ''}`

  const html = buildEmailHtml(signal, todayStr, navpuMeta)

  const info = await transporter.sendMail({
    from: `"ALFM Tracker" <${gmailUser}>`,
    to: TO_EMAIL,
    subject,
    html,
  })

  console.log('[emailer] Email sent:', info.messageId)
  return info
}

// ─────────────────────────────────────────────────────────────────────────────
// BTC Signal Email
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a USD price with $ prefix and comma separators.
 * @param {number} n
 * @param {number} [decimals=2]
 */
function fmtUsd(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '-'
  return (
    '$' +
    Number(n).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  )
}

/**
 * Map a signal name to a display color hex string.
 * Shared across both ALFM and BTC email renderers.
 */
const SIGNAL_COLORS = {
  NO_BUY:        '#64748b',
  WATCH:         '#eab308',
  WATCH_SKIP:    '#ca8a04',
  BUY:           '#3b82f6',
  BUY_MORE:      '#22c55e',
  AGGRESSIVE:    '#10b981',
  PRIORITY_BUY:  '#6ee7b7',
  OPP_GAP_WAIT:  '#f97316',
  MONTHLY_CAP:   '#ef4444',
}

/**
 * Build the HTML email body for a BTC hourly signal.
 *
 * Layout mirrors the ALFM email (dark theme, same card structure) but
 * swaps NAVPU-specific fields for BTC-specific ones:
 *   - Price shown in USD
 *   - Buy amount shown in PHP
 *   - Hourly change instead of daily change
 *   - RSI label, Fear & Greed label, volume warning
 *   - No dividend cycle row (irrelevant for BTC)
 *
 * @param {object} signal   Result from btcSignalEngine.analyzeSignal()
 * @param {string} nowIso   ISO timestamp string of the check (e.g. "2026-04-23T08:00:00.000Z")
 * @returns {string}        Full HTML string ready to send
 */
function buildBtcEmailHtml(signal, nowIso) {
  const {
    signal:         signalName,
    amount,
    currentPrice,
    avgCost,
    vsAvg,
    hourlyChange,
    hourlyChangePct,
    dipSignals,
    trendWarning,
    staggerWarning,
    volumeWarning,
    rsiLabel,
    fearGreedIndex,
    fearGreedLabel,
    recommendation,
    isActionable,
    bucket,
  } = signal

  // Format the check time in PH timezone for the email header
  const phTime = new Date(nowIso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const isUp   = hourlyChange > 0
  const isDown = hourlyChange < 0
  const changeSign  = isUp ? '+' : ''
  const changeColor = isUp ? '#22c55e' : isDown ? '#ef4444' : '#94a3b8'

  const signalColor = SIGNAL_COLORS[signalName] || '#94a3b8'

  const vsAvgText =
    vsAvg === 'BELOW_AVG' ? `Below ${fmtUsd(avgCost)} ↓ Good entry!` :
    vsAvg === 'ABOVE_AVG' ? `Above ${fmtUsd(avgCost)} ↑` :
                            `At ${fmtUsd(avgCost)}`

  const dipText =
    dipSignals && dipSignals.length > 0
      ? `Yes: ${dipSignals.map((d) => d.replace(/_/g, ' ')).join(', ')}`
      : 'None'

  const fearGreedText = fearGreedIndex != null
    ? `${fearGreedIndex} — ${(fearGreedLabel || 'N/A').replace(/_/g, ' ')}`
    : 'N/A'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BTC Signal</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
  .container { max-width: 580px; margin: 0 auto; padding: 24px 16px; }
  .header { background: #1e293b; border-radius: 12px 12px 0 0; padding: 24px; border-bottom: 2px solid #334155; }
  .header h1 { margin: 0; font-size: 20px; color: #f1f5f9; }
  .header p  { margin: 4px 0 0; color: #64748b; font-size: 13px; }
  .body { background: #1e293b; padding: 24px; border-radius: 0 0 12px 12px; }
  .signal-badge { display: inline-block; padding: 8px 20px; border-radius: 999px; font-weight: 700; font-size: 18px; margin-bottom: 16px; }
  .amount { font-size: 28px; font-weight: 800; color: #f1f5f9; margin-bottom: 20px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; }
  .row:last-child { border-bottom: none; }
  .label { color: #94a3b8; font-size: 13px; }
  .value { color: #f1f5f9; font-size: 13px; font-weight: 600; text-align: right; }
  .recommendation { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin: 20px 0; color: #cbd5e1; font-size: 14px; line-height: 1.6; }
  .warning { background: #451a03; border: 1px solid #92400e; border-radius: 8px; padding: 12px 16px; margin: 12px 0; color: #fcd34d; font-size: 13px; }
  .info { background: #0c1a2e; border: 1px solid #1e3a5f; border-radius: 8px; padding: 12px 16px; margin: 12px 0; color: #93c5fd; font-size: 13px; }
  .footer { text-align: center; color: #334155; font-size: 11px; margin-top: 16px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>&#8383; BTC Signal</h1>
    <p>${phTime} &middot; Asia/Manila &middot; Hourly check</p>
  </div>
  <div class="body">

    <div class="signal-badge" style="background-color: ${signalColor}22; color: ${signalColor}; border: 1px solid ${signalColor}55;">
      ${signalName.replace(/_/g, ' ')}
    </div>

    ${amount > 0 ? `<div class="amount">₱${amount.toLocaleString()}</div>` : ''}

    <div style="margin-bottom: 16px;">
      <div class="row">
        <span class="label">BTC Price</span>
        <span class="value">${fmtUsd(currentPrice, 2)}</span>
      </div>
      <div class="row">
        <span class="label">Hourly Change</span>
        <span class="value" style="color: ${changeColor};">
          ${changeSign}${fmtUsd(hourlyChange, 2)} (${changeSign}${fmt(hourlyChangePct, 3)}%)
        </span>
      </div>
      <div class="row">
        <span class="label">vs Avg Cost</span>
        <span class="value">${vsAvgText}</span>
      </div>
      <div class="row">
        <span class="label">Dip Signal</span>
        <span class="value">${dipText}</span>
      </div>
      <div class="row">
        <span class="label">RSI (14)</span>
        <span class="value" style="color: ${rsiLabel === 'OVERSOLD' ? '#22c55e' : rsiLabel === 'OVERBOUGHT' ? '#ef4444' : '#f1f5f9'};">
          ${rsiLabel || 'N/A'}
        </span>
      </div>
      <div class="row">
        <span class="label">Fear &amp; Greed</span>
        <span class="value">${fearGreedText}</span>
      </div>
      ${trendWarning ? `
      <div class="row">
        <span class="label">Trend Warning</span>
        <span class="value" style="color: #fb923c;">${String(trendWarning).replace(/_/g, ' ')}</span>
      </div>` : ''}
      <div class="row">
        <span class="label">Bucket</span>
        <span class="value">${bucket || 'N/A'}</span>
      </div>
    </div>

    ${staggerWarning ? `
    <div class="warning">
      &#9888; STAGGER WARNING: Extreme hourly drop (&le; -4%). Consider splitting into 2&ndash;3 smaller buys over the next few hours instead of deploying the full amount at once.
    </div>` : ''}

    ${volumeWarning ? `
    <div class="warning">
      &#9888; VOLUME WARNING: STRONG_DROP removed &mdash; this hour's volume is below 80% of the 30-day average. Likely a low-conviction wick, not genuine selling pressure.
    </div>` : ''}

    ${fearGreedLabel === 'EXTREME_FEAR' ? `
    <div class="info">
      &#128560; Extreme Fear detected &mdash; buy amount scaled up to 150%. Market panic often creates opportunity.
    </div>` : ''}

    ${fearGreedLabel === 'EXTREME_GREED' ? `
    <div class="warning">
      &#128165; Extreme Greed detected &mdash; buy amount scaled down to 50%. Be cautious of chasing local tops.
    </div>` : ''}

    <div class="recommendation">
      <strong style="color: #f1f5f9; display: block; margin-bottom: 8px;">Recommendation</strong>
      ${recommendation}
    </div>

    <div class="footer">
      BTC Tracker &middot; Automated hourly signal &middot; ${phTime}<br>
      <a href="https://alfm-tracker.web.app" style="color: #334155; text-decoration: none;">alfm-tracker.web.app</a>
    </div>
  </div>
</div>
</body>
</html>
`
}

/**
 * Send a BTC hourly signal email.
 *
 * Only called when signal.isActionable === true to avoid flooding the inbox
 * on non-actionable checks (NO_BUY, WATCH_SKIP, OPP_GAP_WAIT, MONTHLY_CAP).
 *
 * Subject format: "BTC Signal: {SIGNAL} ₱{amount} | ${price}"
 * Example:        "BTC Signal: BUY MORE ₱2,500 | $84,200"
 *
 * @param {object} signal      Result from btcSignalEngine.analyzeSignal()
 * @param {string} nowIso      ISO timestamp of this check run
 * @param {string} gmailUser   Gmail sender address (from Firebase secret)
 * @param {string} gmailPass   Gmail app password (from Firebase secret)
 * @returns {Promise<object>}  Nodemailer send result
 */
async function sendBtcSignalEmail(signal, nowIso, gmailUser, gmailPass) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailPass },
  })

  const { signal: signalName, amount, currentPrice } = signal

  const subject = `BTC Signal: ${signalName.replace(/_/g, ' ')}${
    amount > 0 ? ` ₱${amount.toLocaleString()}` : ''
  } | $${currentPrice.toLocaleString()}`

  const html = buildBtcEmailHtml(signal, nowIso)

  const info = await transporter.sendMail({
    from: `"BTC Tracker" <${gmailUser}>`,
    to: TO_EMAIL,
    subject,
    html,
  })

  console.log('[emailer] BTC email sent:', info.messageId)
  return info
}

/**
 * Build the HTML email for a SELL signal.
 */
function buildBtcSellEmailHtml(signal, nowIso) {
  const { entryPriceUsd, currentPrice, entryPhp, profitPhp, newBalancePhp, holdHours, recommendation } = signal
  const phTime = new Date(nowIso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
  const holdText = holdHours != null ? (holdHours < 24 ? `${holdHours.toFixed(1)}h` : `${(holdHours / 24).toFixed(1)}d`) : '—'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BTC Sell Signal</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
  .container { max-width: 580px; margin: 0 auto; padding: 24px 16px; }
  .header { background: #052e16; border-radius: 12px 12px 0 0; padding: 24px; border-bottom: 2px solid #16a34a; }
  .header h1 { margin: 0; font-size: 20px; color: #4ade80; }
  .header p  { margin: 4px 0 0; color: #166534; font-size: 13px; }
  .body { background: #1e293b; padding: 24px; border-radius: 0 0 12px 12px; }
  .profit-box { background: #052e16; border: 1px solid #16a34a; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px; }
  .profit-label { color: #4ade80; font-size: 13px; margin-bottom: 4px; }
  .profit-amount { color: #4ade80; font-size: 36px; font-weight: 800; }
  .new-balance { color: #86efac; font-size: 14px; margin-top: 4px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; }
  .row:last-child { border-bottom: none; }
  .label { color: #94a3b8; font-size: 13px; }
  .value { color: #f1f5f9; font-size: 13px; font-weight: 600; text-align: right; }
  .recommendation { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin: 20px 0; color: #cbd5e1; font-size: 14px; line-height: 1.6; }
  .footer { text-align: center; color: #334155; font-size: 11px; margin-top: 16px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>&#8383; SELL TARGET HIT</h1>
    <p>${phTime} &middot; Asia/Manila</p>
  </div>
  <div class="body">
    <div class="profit-box">
      <div class="profit-label">Net Profit (+5% after fees)</div>
      <div class="profit-amount">+${fmtPeso(profitPhp, 0)}</div>
      <div class="new-balance">New balance: ${fmtPeso(newBalancePhp, 0)}</div>
    </div>
    <div style="margin-bottom: 16px;">
      <div class="row">
        <span class="label">Entry Price (USD)</span>
        <span class="value">${fmtUsd(entryPriceUsd, 2)}</span>
      </div>
      <div class="row">
        <span class="label">Exit Price (USD)</span>
        <span class="value" style="color: #4ade80;">${fmtUsd(currentPrice, 2)}</span>
      </div>
      <div class="row">
        <span class="label">Price Move</span>
        <span class="value" style="color: #4ade80;">+${fmt((((currentPrice - entryPriceUsd) / entryPriceUsd) * 100), 2)}%</span>
      </div>
      <div class="row">
        <span class="label">PHP Deployed</span>
        <span class="value">${fmtPeso(entryPhp, 0)}</span>
      </div>
      <div class="row">
        <span class="label">Hold Duration</span>
        <span class="value">${holdText}</span>
      </div>
    </div>
    <div class="recommendation">
      <strong style="color: #4ade80; display: block; margin-bottom: 8px;">Action Required</strong>
      ${recommendation}
    </div>
    <div class="footer">
      BTC Tracker &middot; Swing Trade &middot; ${phTime}<br>
      <a href="https://alfm-tracker.web.app" style="color: #334155; text-decoration: none;">alfm-tracker.web.app</a>
    </div>
  </div>
</div>
</body>
</html>`
}

async function sendBtcSellEmail(signal, nowIso, gmailUser, gmailPass) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailPass },
  })
  const { currentPrice, profitPhp } = signal
  const subject = `BTC SELL NOW — +${fmtPeso(profitPhp, 0)} profit | $${currentPrice.toLocaleString()}`
  const info = await transporter.sendMail({
    from: `"BTC Tracker" <${gmailUser}>`,
    to: TO_EMAIL,
    subject,
    html: buildBtcSellEmailHtml(signal, nowIso),
  })
  console.log('[emailer] BTC sell email sent:', info.messageId)
  return info
}

// ─────────────────────────────────────────────────────────────────────────────
// MGPIFF Signal Email
// ─────────────────────────────────────────────────────────────────────────────

function buildMgpiffEmailHtml(signal, todayStr) {
  const {
    signal: signalName,
    amount,
    dailyChange,
    dailyChangePct,
    todayNavpu,
    avgPrice,
    vsAvg,
    dipSignals,
    divCycle,
    trendWarning,
    staggerWarning,
    recommendation,
    isActionable,
  } = signal

  const isUp = dailyChange > 0
  const isDown = dailyChange < 0
  const changeSign = isUp ? '+' : ''
  const changeColor = isUp ? '#22c55e' : isDown ? '#ef4444' : '#94a3b8'
  const signalColor = SIGNAL_COLORS[signalName] || '#94a3b8'

  const vsAvgText = avgPrice && avgPrice > 0
    ? vsAvg === 'BELOW_AVG'
      ? `Below ₱${fmt(avgPrice, 2)} ↓ Good entry!`
      : vsAvg === 'ABOVE_AVG'
      ? `Above ₱${fmt(avgPrice, 2)} ↑`
      : `At ₱${fmt(avgPrice, 2)}`
    : 'No position yet'

  const dipText = dipSignals && dipSignals.length > 0
    ? `Yes: ${dipSignals.map((d) => d.replace(/_/g, ' ')).join(', ')}`
    : 'No'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MGPIFF Daily Signal</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
  .container { max-width: 580px; margin: 0 auto; padding: 24px 16px; }
  .header { background: #1e293b; border-radius: 12px 12px 0 0; padding: 24px; border-bottom: 2px solid #1d4ed8; }
  .header h1 { margin: 0; font-size: 20px; color: #f1f5f9; }
  .header p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
  .body { background: #1e293b; padding: 24px; border-radius: 0 0 12px 12px; }
  .signal-badge { display: inline-block; padding: 8px 20px; border-radius: 999px; font-weight: 700; font-size: 18px; margin-bottom: 16px; }
  .amount { font-size: 28px; font-weight: 800; color: #f1f5f9; margin-bottom: 20px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; }
  .row:last-child { border-bottom: none; }
  .label { color: #94a3b8; font-size: 13px; }
  .value { color: #f1f5f9; font-size: 13px; font-weight: 600; text-align: right; }
  .recommendation { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin: 20px 0; color: #cbd5e1; font-size: 14px; line-height: 1.6; }
  .warning { background: #451a03; border: 1px solid #92400e; border-radius: 8px; padding: 12px 16px; margin: 12px 0; color: #fcd34d; font-size: 13px; }
  .tip { color: #475569; font-size: 12px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #334155; }
  .footer { text-align: center; color: #334155; font-size: 11px; margin-top: 16px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>MGPIFF Daily Signal</h1>
    <p>Manulife Global Preferred Income Feeder Fund &middot; ${todayStr} &middot; Asia/Manila</p>
  </div>
  <div class="body">
    <div class="signal-badge" style="background-color: ${signalColor}22; color: ${signalColor}; border: 1px solid ${signalColor}55;">
      ${signalName.replace(/_/g, ' ')}
    </div>
    ${amount > 0 ? `<div class="amount">${fmtPeso(amount, 0)}</div>` : ''}

    <div style="margin-bottom: 16px;">
      <div class="row">
        <span class="label">NAVPU Today</span>
        <span class="value">₱${fmt(todayNavpu, 4)}</span>
      </div>
      <div class="row">
        <span class="label">Daily Change</span>
        <span class="value" style="color: ${changeColor};">
          ${changeSign}${fmt(dailyChange, 4)} (${changeSign}${fmt(dailyChangePct, 2)}%)
        </span>
      </div>
      <div class="row">
        <span class="label">vs Avg Price</span>
        <span class="value">${vsAvgText}</span>
      </div>
      <div class="row">
        <span class="label">Dip Signal</span>
        <span class="value">${dipText}</span>
      </div>
      <div class="row">
        <span class="label">Dividend Cycle</span>
        <span class="value">${divCycle || 'N/A'}</span>
      </div>
      ${trendWarning ? `
      <div class="row">
        <span class="label">Trend Warning</span>
        <span class="value" style="color: #fb923c;">${String(trendWarning).replace(/_/g, ' ')}</span>
      </div>` : ''}
    </div>

    ${staggerWarning ? `
    <div class="warning">
      ⚠️ STAGGER WARNING: Extreme drop detected. Consider splitting into 2–3 smaller buys over the next few trading days.
    </div>` : ''}

    <div class="recommendation">
      <strong style="color: #f1f5f9; display: block; margin-bottom: 8px;">Recommendation</strong>
      ${recommendation}
    </div>

    <div class="tip">
      📱 <strong>Execution tip:</strong> Place your order via <strong>GCash GFunds</strong> before the fund cut-off. Latest NAVPU is ₱${fmt(todayNavpu, 4)} (T-1). Your actual execution price will be today's closing NAVPU.
    </div>
  </div>
  <div class="footer">
    MGPIFF Tracker &middot; Automated daily signal &middot; ${todayStr}<br>
    <a href="https://alfm-tracker.web.app" style="color: #475569; text-decoration: none;">alfm-tracker.web.app</a>
  </div>
</div>
</body>
</html>
`
}

async function sendMgpiffSignalEmail(signal, todayStr, gmailUser, gmailPass) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailPass },
  })

  const { signal: signalName, amount, todayNavpu } = signal
  const subject = `MGPIFF Signal: ${signalName.replace(/_/g, ' ')} ${
    amount > 0 ? fmtPeso(amount, 0) : ''
  } | NAVPU ₱${fmt(todayNavpu, 4)}`

  const info = await transporter.sendMail({
    from: `"MGPIFF Tracker" <${gmailUser}>`,
    to: TO_EMAIL,
    subject,
    html: buildMgpiffEmailHtml(signal, todayStr),
  })

  console.log('[emailer] MGPIFF email sent:', info.messageId)
  return info
}

module.exports = { sendSignalEmail, sendBtcSignalEmail, sendBtcSellEmail, sendMgpiffSignalEmail }

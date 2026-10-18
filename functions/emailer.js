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
<title>ALFMGMP Daily Signal</title>
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
    <h1>ALFMGMP Daily Signal</h1>
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
    ALFMGMP Tracker &middot; Automated daily signal &middot; ${todayStr}<br>
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
  const subject = `ALFMGMP Signal: ${signalName.replace(/_/g, ' ')} ${
    amount > 0 ? fmtPeso(amount, 0) : ''
  } | NAVPU ₱${fmt(todayNavpu, 2)}${isStaleNavpu ? ' ⚠️ STALE' : ''}`

  const html = buildEmailHtml(signal, todayStr, navpuMeta)

  const info = await transporter.sendMail({
    from: `"ALFMGMP Tracker" <${gmailUser}>`,
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
function buildBtcEmailHtml(signal, nowIso, phpPerUsd = 57.5) {
  const {
    signal:         signalName,
    amount,
    currentPrice,
    avgCost,
    vsAvg,
    hourlyChange,
    hourlyChangePct,
    drawdownPct,
    drawdownHigh,
    rsiLabel,
    fearGreedIndex,
    fearGreedLabel,
    recommendation,
    bucket,
    macroDrawdownActive,
  } = signal

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

  const pricePhp = currentPrice * phpPerUsd
  const phpPriceStr = fmtPeso(pricePhp, 0)

  const sellTargetUsd = currentPrice * 1.20
  const sellTargetPhp = sellTargetUsd * phpPerUsd

  const vsAvgText =
    vsAvg === 'BELOW_AVG' ? `Below ${fmtUsd(avgCost)} ↓ Good entry!` :
    vsAvg === 'ABOVE_AVG' ? `Above ${fmtUsd(avgCost)} ↑` :
                            `At ${fmtUsd(avgCost)}`

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
    <p>${phTime} &middot; Asia/Manila &middot; Drawdown-based buy engine</p>
  </div>
  <div class="body">

    <div class="signal-badge" style="background-color: ${signalColor}22; color: ${signalColor}; border: 1px solid ${signalColor}55;">
      ${signalName.replace(/_/g, ' ')}
    </div>

    ${amount > 0 ? `<div class="amount">${fmtPeso(amount, 0)}</div>` : ''}

    <div style="margin-bottom: 16px;">
      <div class="row">
        <span class="label">BTC Price (USD)</span>
        <span class="value">${fmtUsd(currentPrice, 2)}</span>
      </div>
      <div class="row">
        <span class="label">BTC Price (PHP)</span>
        <span class="value">${phpPriceStr}</span>
      </div>
      <div class="row">
        <span class="label">Drawdown from 30d High</span>
        <span class="value" style="color: ${drawdownPct >= 5 ? '#ef4444' : drawdownPct >= 3 ? '#fb923c' : '#94a3b8'};">
          -${fmt(drawdownPct, 1)}% (high: ${fmtUsd(drawdownHigh, 0)})
        </span>
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
        <span class="label">RSI (14)</span>
        <span class="value" style="color: ${rsiLabel === 'OVERSOLD' ? '#22c55e' : rsiLabel === 'OVERBOUGHT' ? '#ef4444' : '#f1f5f9'};">
          ${rsiLabel || 'N/A'}
        </span>
      </div>
      <div class="row">
        <span class="label">Fear &amp; Greed</span>
        <span class="value">${fearGreedText}</span>
      </div>
      <div class="row">
        <span class="label">Bucket</span>
        <span class="value">${bucket || 'N/A'}</span>
      </div>
    </div>

    <div style="background: #064e3b; border: 1px solid #059669; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <strong style="color: #6ee7b7; display: block; margin-bottom: 10px; font-size: 14px;">Sell Target (+20% from buy price)</strong>
      <div style="display: flex; justify-content: space-between; padding: 6px 0;">
        <span style="color: #a7f3d0; font-size: 13px;">Target (USD)</span>
        <span style="color: #f1f5f9; font-size: 15px; font-weight: 700;">${fmtUsd(sellTargetUsd, 0)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 6px 0;">
        <span style="color: #a7f3d0; font-size: 13px;">Target (PHP)</span>
        <span style="color: #f1f5f9; font-size: 15px; font-weight: 700;">${fmtPeso(sellTargetPhp, 0)}</span>
      </div>
      <div style="color: #6ee7b7; font-size: 11px; margin-top: 8px;">
        Sell when BTC hits this price to lock in at least 20% profit from this entry.
      </div>
    </div>

    ${macroDrawdownActive ? `
    <div class="warning">
      &#9888; MACRO DRAWDOWN: BTC is &gt;25% below 90d high. Buy sizes reduced to 60%.
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
      BTC Tracker &middot; Drawdown buy signal &middot; ${phTime}<br>
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
async function sendBtcSignalEmail(signal, nowIso, gmailUser, gmailPass, phpPerUsd = 57.5) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailPass },
  })

  const { signal: signalName, amount, currentPrice } = signal
  const phpPrice = Math.round(currentPrice * phpPerUsd).toLocaleString()

  const subject = `BTC Signal: ${signalName.replace(/_/g, ' ')}${
    amount > 0 ? ` ₱${amount.toLocaleString()}` : ''
  } | $${currentPrice.toLocaleString()} (₱${phpPrice})`

  const html = buildBtcEmailHtml(signal, nowIso, phpPerUsd)

  const info = await transporter.sendMail({
    from: `"BTC Tracker" <${gmailUser}>`,
    to: TO_EMAIL,
    subject,
    html,
  })

  console.log('[emailer] BTC email sent:', info.messageId)
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

// ─────────────────────────────────────────────────────────────────────────────
// BPIBGIF Signal Email
// ─────────────────────────────────────────────────────────────────────────────

function buildBpibondEmailHtml(signal, todayStr, { isRspDay = false, rspBuyDone = false } = {}) {
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
<title>BPIBGIF Daily Signal</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
  .container { max-width: 580px; margin: 0 auto; padding: 24px 16px; }
  .header { background: #1e293b; border-radius: 12px 12px 0 0; padding: 24px; border-bottom: 2px solid #7c3aed; }
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
    <h1>BPIBGIF Daily Signal</h1>
    <p>BPI Global Bond Income Fund &middot; ${todayStr} &middot; Asia/Manila</p>
  </div>
  <div class="body">
    <div class="signal-badge" style="background-color: ${signalColor}22; color: ${signalColor}; border: 1px solid ${signalColor}55;">
      ${signalName.replace(/_/g, ' ')}
    </div>
    ${amount > 0 ? `<div class="amount">${fmtPeso(amount, 0)}</div>` : ''}

    <div style="margin-bottom: 16px;">
      <div class="row">
        <span class="label">NAVPU Today</span>
        <span class="value">₱${fmt(todayNavpu, 2)}</span>
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

    ${isRspDay && !rspBuyDone ? `
    <div style="background: #1e1b4b; border: 1px solid #6366f1; border-radius: 8px; padding: 16px; margin: 12px 0;">
      <strong style="color: #a5b4fc; display: block; margin-bottom: 8px; font-size: 14px;">📅 RSP Due Today — ₱1,000</strong>
      <div style="color: #c7d2fe; font-size: 13px; line-height: 1.5;">
        Your monthly RSP contribution of <strong style="color: #f1f5f9;">₱1,000</strong> is due today.
        Place the order via the <strong>BPI app</strong> alongside any signal-based buy.
      </div>
    </div>` : ''}

    <div class="recommendation">
      <strong style="color: #f1f5f9; display: block; margin-bottom: 8px;">Recommendation</strong>
      ${recommendation}
    </div>

    <div class="tip">
      📱 <strong>Execution tip:</strong> Place your order via <strong>BPI app</strong> before the fund cut-off. Latest NAVPU is ₱${fmt(todayNavpu, 2)} (T-1). Your actual execution price will be today's closing NAVPU.
    </div>
  </div>
  <div class="footer">
    BPIBGIF Tracker &middot; Automated daily signal &middot; ${todayStr}<br>
    <a href="https://alfm-tracker.web.app" style="color: #475569; text-decoration: none;">alfm-tracker.web.app</a>
  </div>
</div>
</body>
</html>
`
}

async function sendBpibondSignalEmail(signal, todayStr, gmailUser, gmailPass, rspMeta = {}) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailPass },
  })

  const { signal: signalName, amount, todayNavpu } = signal
  const { isRspDay = false, rspBuyDone = false } = rspMeta
  const rspTag = isRspDay && !rspBuyDone ? ' 📅 RSP ₱1,000' : ''
  const subject = `BPIBGIF Signal: ${signalName.replace(/_/g, ' ')} ${
    amount > 0 ? fmtPeso(amount, 0) : ''
  } | NAVPU ₱${fmt(todayNavpu, 2)}${rspTag}`

  const info = await transporter.sendMail({
    from: `"BPIBGIF Tracker" <${gmailUser}>`,
    to: TO_EMAIL,
    subject,
    html: buildBpibondEmailHtml(signal, todayStr, rspMeta),
  })

  console.log('[emailer] BPIBGIF email sent:', info.messageId)
  return info
}

// ─────────────────────────────────────────────────────────────────────────────
// MREIT Signal Email
// ─────────────────────────────────────────────────────────────────────────────

function buildMreitEmailHtml(signal, todayStr) {
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
<title>MREIT Daily Signal</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
  .container { max-width: 580px; margin: 0 auto; padding: 24px 16px; }
  .header { background: #1e293b; border-radius: 12px 12px 0 0; padding: 24px; border-bottom: 2px solid #d97706; }
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
    <h1>MREIT Daily Signal</h1>
    <p>Manulife Global REIT Feeder Fund PhP-Unhedged &middot; ${todayStr} &middot; Asia/Manila</p>
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
    MREIT Tracker &middot; Automated daily signal &middot; ${todayStr}<br>
    <a href="https://alfm-tracker.web.app" style="color: #475569; text-decoration: none;">alfm-tracker.web.app</a>
  </div>
</div>
</body>
</html>
`
}

async function sendMreitSignalEmail(signal, todayStr, gmailUser, gmailPass) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailPass },
  })

  const { signal: signalName, amount, todayNavpu } = signal
  const subject = `MREIT Signal: ${signalName.replace(/_/g, ' ')} ${
    amount > 0 ? fmtPeso(amount, 0) : ''
  } | NAVPU ₱${fmt(todayNavpu, 4)}`

  const info = await transporter.sendMail({
    from: `"MREIT Tracker" <${gmailUser}>`,
    to: TO_EMAIL,
    subject,
    html: buildMreitEmailHtml(signal, todayStr),
  })

  console.log('[emailer] MREIT email sent:', info.messageId)
  return info
}

module.exports = { sendSignalEmail, sendBtcSignalEmail, sendMgpiffSignalEmail, sendBpibondSignalEmail, sendMreitSignalEmail }

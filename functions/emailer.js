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
    ALFM Fund Tracker &middot; Automated daily signal &middot; ${todayStr}
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

module.exports = { sendSignalEmail }

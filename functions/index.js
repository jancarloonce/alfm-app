'use strict'

const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall } = require('firebase-functions/v2/https')
const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')

admin.initializeApp()
const db = admin.firestore()

const { scrapeNavpu } = require('./scraper')
const { analyzeSignal, computeThresholds } = require('./signalEngine')
const { sendSignalEmail } = require('./emailer')
const { HISTORICAL_NAVPU } = require('./historical_navpu_data')
const { runBacktest } = require('./backtest')

// Secrets:set via: firebase functions:config:set gmail.user="..." gmail.pass="..."
// In v2, use defineSecret for proper secret management
const gmailUser = defineSecret('GMAIL_USER')
const gmailPass = defineSecret('GMAIL_PASS')

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get today's date string in PH timezone (Asia/Manila).
 */
function getTodayPH() {
  const now = new Date()
  const ph = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
  const y = ph.getFullYear()
  const m = String(ph.getMonth() + 1).padStart(2, '0')
  const d = String(ph.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Get a date string offset by N days from a base date string.
 */
function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Get YYYY-MM month string in PH time.
 */
function getMonthPH() {
  const now = new Date()
  const ph = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
  const y = ph.getFullYear()
  const m = String(ph.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * Fetch navpu for a specific date from Firestore.
 */
async function getNavpuForDate(dateStr) {
  const snap = await db.collection('navpu_history').doc(dateStr).get()
  if (!snap.exists) return null
  return snap.data().navpu || null
}

/**
 * Fetch the last N navpu entries before a given date (sorted ascending).
 */
async function getRecentNavpus(beforeDateStr, count) {
  const snap = await db
    .collection('navpu_history')
    .where('date', '<', beforeDateStr)
    .orderBy('date', 'desc')
    .limit(count)
    .get()

  const docs = snap.docs.map((d) => d.data())
  return docs.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Count effective buys in the current month.
 * Fix 4: All stagger buys from the same EXTREME_DROP event (same staggerEventDate)
 * count as 1 buy toward the monthly cap, not 1 per transaction.
 */
async function countMonthlyBuys(monthYear) {
  const snap = await db.collection('buys').where('monthYear', '==', monthYear).get()
  const docs = snap.docs.map((d) => d.data())

  const staggerGroups = new Set()
  let count = 0
  for (const buy of docs) {
    if (buy.staggerEventDate) {
      staggerGroups.add(buy.staggerEventDate)
    } else {
      count++
    }
  }
  return count + staggerGroups.size
}

/**
 * Check if a date string falls on a weekend (Sat/Sun).
 */
function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.getDay() === 0 || d.getDay() === 6
}

/**
 * Philippine public holidays — days the PSE is closed and BPI orders cannot be placed.
 * Update this list each year as proclamations are released.
 */
const PH_HOLIDAYS = new Set([
  // 2026 Regular Holidays
  '2026-01-01', // New Year's Day
  '2026-04-02', // Maundy Thursday
  '2026-04-03', // Good Friday
  '2026-04-09', // Araw ng Kagitingan (Day of Valor)
  '2026-05-01', // Labor Day
  '2026-06-12', // Independence Day
  '2026-08-31', // National Heroes Day
  '2026-11-30', // Bonifacio Day
  '2026-12-25', // Christmas Day
  '2026-12-30', // Rizal Day
  // 2026 Special Non-Working Holidays
  '2026-04-04', // Black Saturday
  '2026-08-21', // Ninoy Aquino Day
  '2026-11-01', // All Saints Day
  '2026-11-02', // All Souls Day
  '2026-12-08', // Feast of the Immaculate Conception
  '2026-12-24', // Christmas Eve
  '2026-12-31', // New Year's Eve
])

/**
 * Returns true if the given date is a Philippine public holiday.
 */
function isPhHoliday(dateStr) {
  return PH_HOLIDAYS.has(dateStr)
}

/**
 * Returns true if the given date is a non-trading day (weekend or PH holiday).
 */
function isNonTradingDay(dateStr) {
  return isWeekend(dateStr) || isPhHoliday(dateStr)
}

/**
 * Returns the most recent trading day (Mon-Fri, non-PH-holiday) before a given date string.
 * e.g. Monday after a holiday → last Friday before the holiday
 */
function lastBusinessDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  do {
    d.setDate(d.getDate() - 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const s = `${y}-${m}-${dd}`
    if (!isNonTradingDay(s)) return s
  } while (true)
}

/**
 * Auto-detect monthly dividends from NAVPU drop on ex-dividend date.
 * Runs daily. Handles three cases:
 *
 * 1. No doc exists + clear drop detected (>= 0.15) → write confirmed doc
 * 2. No doc exists + no clear drop + 5+ business days past record → write estimated doc
 *    using previous confirmed month's div/unit (estimated: true)
 * 3. Doc exists with estimated: true → keep re-checking NAVPU for actual drop
 *    and update to confirmed if found
 */
async function autoDetectDividend(db, todayStr) {
  // Add new record dates here as they are announced
  const KNOWN_RECORD_DATES = [
    '2026-03-27', '2026-04-28', '2026-05-28', '2026-06-26',
  ]

  for (const recordDate of KNOWN_RECORD_DATES) {
    if (recordDate >= todayStr) continue

    const existing = await db.collection('dividends').doc(recordDate).get()
    const isEstimated = existing.exists && existing.data().estimated === true
    if (existing.exists && !isEstimated) continue // confirmed doc, skip

    // NAVPU on record date
    const recordSnap = await db.collection('navpu_history').doc(recordDate).get()
    if (!recordSnap.exists || !recordSnap.data().navpu) continue
    const recordNavpu = recordSnap.data().navpu

    // Check next 5 business days for a drop >= 0.15
    const nextSnap = await db.collection('navpu_history')
      .where('date', '>', recordDate)
      .orderBy('date', 'asc')
      .limit(5)
      .get()
    if (nextSnap.empty) continue

    let detectedDivPerUnit = null
    for (const doc of nextSnap.docs) {
      const candidate = parseFloat((recordNavpu - doc.data().navpu).toFixed(4))
      if (candidate >= 0.15) {
        detectedDivPerUnit = candidate
        break
      }
    }

    // Helper: build the doc fields shared by both confirmed and estimated writes
    async function buildDividendFields(divPerUnit, isEst) {
      const buysSnap = await db.collection('buys')
        .where('date', '<=', recordDate)
        .orderBy('date', 'desc')
        .limit(1)
        .get()
      if (buysSnap.empty) return null
      const units = buysSnap.docs[0].data().totalUnitsAfter

      const rd = new Date(recordDate + 'T00:00:00')
      rd.setMonth(rd.getMonth() + 1)
      const month = rd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

      const cr = new Date(recordDate + 'T00:00:00')
      cr.setDate(cr.getDate() + 15)
      const credited = [
        cr.getFullYear(),
        String(cr.getMonth() + 1).padStart(2, '0'),
        String(cr.getDate()).padStart(2, '0'),
      ].join('-')

      return {
        month,
        date: recordDate,
        units,
        divPerUnit,
        earned: parseFloat((units * divPerUnit).toFixed(4)),
        credited,
        autoDetected: true,
        estimated: isEst,
        detectedAt: new Date().toISOString(),
      }
    }

    if (detectedDivPerUnit !== null) {
      // Confirmed drop found — write or update to confirmed
      const fields = await buildDividendFields(detectedDivPerUnit, false)
      if (!fields) continue
      await db.collection('dividends').doc(recordDate).set(fields)
      console.log(`[autoDetectDividend] ${recordDate}: confirmed ₱${detectedDivPerUnit}/unit x ${fields.units} units = ₱${fields.earned}`)

    } else if (!existing.exists) {
      // No drop detected yet — only write estimate if 5+ business days have passed
      const daysPast = nextSnap.docs.length
      if (daysPast < 5) {
        console.log(`[autoDetectDividend] ${recordDate}: no drop yet, only ${daysPast} days past — waiting`)
        continue
      }

      // Get previous confirmed month's div/unit as estimate
      const prevSnap = await db.collection('dividends')
        .where('date', '<', recordDate)
        .where('estimated', '!=', true)
        .orderBy('date', 'desc')
        .limit(1)
        .get()
      if (prevSnap.empty) {
        console.log(`[autoDetectDividend] ${recordDate}: no prior confirmed dividend to estimate from`)
        continue
      }
      const estimatedDivPerUnit = prevSnap.docs[0].data().divPerUnit

      const fields = await buildDividendFields(estimatedDivPerUnit, true)
      if (!fields) continue
      await db.collection('dividends').doc(recordDate).set(fields)
      console.log(`[autoDetectDividend] ${recordDate}: estimated ₱${estimatedDivPerUnit}/unit (from prev month) — marked estimated`)

    } else {
      // Doc is estimated and still no drop found — keep waiting
      console.log(`[autoDetectDividend] ${recordDate}: estimated doc exists, no confirmed drop yet — will retry tomorrow`)
    }
  }
}

// ── 1. dailyNavpuCheck ────────────────────────────────────────────────────────

exports.dailyNavpuCheck = onSchedule(
  {
    schedule: '0 16 * * *', // 4:00 PM Asia/Manila
    timeZone: 'Asia/Manila',
    memory: '1GiB',
    timeoutSeconds: 180,
    secrets: [gmailUser, gmailPass],
  },
  async (event) => {
    const todayStr = getTodayPH()
    const monthYear = getMonthPH()

    console.log(`[dailyNavpuCheck] Running for ${todayStr}`)

    // Skip on weekends and PH public holidays — no orders can be placed on those days
    if (isNonTradingDay(todayStr)) {
      const reason = isWeekend(todayStr) ? 'weekend' : 'PH public holiday'
      console.log(`[dailyNavpuCheck] Skipping — ${todayStr} is a ${reason}. No signal sent.`)
      return
    }

    // 1. Scrape latest NAVPU
    const { navpu: scrapedNavpu, effectiveDate: scrapedDate, source, error: scrapeError } = await scrapeNavpu()

    if (scrapeError || scrapedNavpu === null) {
      console.error('[dailyNavpuCheck] Scraping failed:', scrapeError)
      await db.collection('navpu_history').doc(todayStr).set({
        date: todayStr,
        navpu: null,
        scrapeError: scrapeError || 'Unknown error',
        createdAt: FieldValue.serverTimestamp(),
      })
      return
    }

    // Use the date extracted from the page (e.g. Apr 6), falling back to yesterday
    const yesterday = offsetDate(todayStr, -1)
    const navpuDate = scrapedDate || yesterday
    // Stale = navpuDate is older than the last business day (T-1 is normal for mutual funds)
    const expectedNavpuDate = lastBusinessDay(todayStr)
    const isStaleNavpu = navpuDate < expectedNavpuDate
    console.log(`[dailyNavpuCheck] Scraped NAVPU: ${scrapedNavpu} from ${source} (effective date: ${navpuDate}, expected: ${expectedNavpuDate})${isStaleNavpu ? ' ⚠️ STALE' : ' ✓'}`)

    // 2. Get historical navpus for signal analysis
    // Strip weekends to avoid comparing the same NAVPU value across Sat/Sun/Mon
    const recentDocs = await getRecentNavpus(todayStr, 14) // fetch more, filter down
    const recentNavpus = recentDocs
      .filter((d) => !isWeekend(d.date))
      .map((d) => d.navpu)
      .filter((n) => n !== null)

    const yesterdayNavpu = recentNavpus.length > 0 ? recentNavpus[recentNavpus.length - 1] : null
    const twoDaysAgoNavpu = recentNavpus.length > 1 ? recentNavpus[recentNavpus.length - 2] : null
    const last7Navpus = [...recentNavpus.slice(-6), scrapedNavpu]

    // 3. Get position data
    const positionSnap = await db.collection('position').doc('current').get()
    const position = positionSnap.exists ? positionSnap.data() : {}
    const avgPrice = position.avgPrice || 45.48

    // 4. Compute bucket state variables for signal engine
    const buysSnap = await db.collection('buys').where('monthYear', '==', monthYear).get()
    const monthBuys = buysSnap.docs.map((d) => d.data())

    const dividendBuyDoneThisMonth = monthBuys.some((b) => b.isDividendBuy === true)

    const oppBuys = monthBuys.filter((b) => !b.isDividendBuy && b.bucket !== 'extreme_override')
    const staggerGroupsSeen = new Set()
    let opportunityBuyCountThisMonth = 0
    for (const buy of oppBuys) {
      if (buy.staggerEventDate) {
        if (!staggerGroupsSeen.has(buy.staggerEventDate)) {
          staggerGroupsSeen.add(buy.staggerEventDate)
          opportunityBuyCountThisMonth++
        }
      } else {
        opportunityBuyCountThisMonth++
      }
    }
    const oppDates = oppBuys.map((b) => b.date).sort()
    const lastOpportunityBuyDate = oppDates.length > 0 ? oppDates[oppDates.length - 1] : null

    // 5. Get record dates from dividends collection (single source of truth, shared with backtest)
    const divConfigSnap = await db.collection('dividends').get()
    const recordDates = divConfigSnap.docs.map((d) => d.data().date || d.id).filter(Boolean).sort()

    // 6. Compute dynamic thresholds from historical NAVPU data
    // Fix 2: pass values sorted chronologically (oldest→newest) so computeThresholds
    // can take the last 90 correctly. Strip weekends for clean business-day data.
    const allNavpuSnap = await db.collection('navpu_history').orderBy('date', 'asc').get()
    const allNavpuValues = allNavpuSnap.docs
      .filter((d) => !isWeekend(d.data().date))
      .map((d) => d.data().navpu)
      .filter((v) => v != null && !isNaN(v))
    const thresholds = computeThresholds(allNavpuValues)

    if (thresholds) {
      await db.collection('config').doc('thresholds').set(thresholds)
      console.log(`[dailyNavpuCheck] Thresholds computed from ${thresholds.dataPoints} data points`)
    }

    // 7. Run signal analysis with dynamic thresholds
    const signal = analyzeSignal({
      todayNavpu: scrapedNavpu,
      yesterdayNavpu,
      twoDaysAgoNavpu,
      last7Navpus,
      avgPrice,
      dividendBuyDoneThisMonth,
      opportunityBuyCountThisMonth,
      lastOpportunityBuyDate,
      todayStr,
      recordDates,
      thresholds,
    })

    console.log(`[dailyNavpuCheck] Signal: ${signal.signal} amount=${signal.amount}`)

    // 7. Compute simple ROI metrics
    const yearStart = `${todayStr.slice(0, 4)}-01-01`
    const yearStartSnap = await db.collection('navpu_history').doc(yearStart).get()
    const yearStartNavpu = yearStartSnap.exists ? yearStartSnap.data().navpu : null

    const roiYtd =
      yearStartNavpu && scrapedNavpu
        ? parseFloat((((scrapedNavpu - yearStartNavpu) / yearStartNavpu) * 100).toFixed(4))
        : null

    // 8. Store NAVPU history under its actual effective date
    await db.collection('navpu_history').doc(navpuDate).set({
      date: navpuDate,
      navpu: scrapedNavpu,
      source,
      roiYtd,
      dailyChange: signal.dailyChange,
      createdAt: FieldValue.serverTimestamp(),
    })

    // 9. Store signal
    await db.collection('signals').doc(todayStr).set({
      ...signal,
      navpu: scrapedNavpu,
      monthYear,
      createdAt: FieldValue.serverTimestamp(),
    })

    // 10. Update market value on position
    if (position.units) {
      const marketValue = position.units * scrapedNavpu
      const unrealizedGain = marketValue - (position.totalCost || 0)
      const unrealizedGainPct =
        position.totalCost > 0
          ? parseFloat(((unrealizedGain / position.totalCost) * 100).toFixed(4))
          : 0

      await db.collection('position').doc('current').update({
        marketValue: parseFloat(marketValue.toFixed(2)),
        unrealizedGain: parseFloat(unrealizedGain.toFixed(2)),
        unrealizedGainPct,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    // 11. Auto-detect dividend from NAVPU drop
    try {
      await autoDetectDividend(db, todayStr)
    } catch (divErr) {
      console.error('[dailyNavpuCheck] autoDetectDividend error (non-fatal):', divErr.message)
    }

    // 12. Send email
    try {
      const user = gmailUser.value()
      const pass = gmailPass.value()
      if (user && pass) {
        await sendSignalEmail(signal, todayStr, user, pass, { isStaleNavpu, navpuDate, expectedNavpuDate })
        console.log('[dailyNavpuCheck] Email sent successfully.')
      } else {
        console.warn('[dailyNavpuCheck] Gmail credentials not configured:skipping email.')
      }
    } catch (emailErr) {
      console.error('[dailyNavpuCheck] Email error (non-fatal):', emailErr.message)
    }

    console.log('[dailyNavpuCheck] Done.')
  }
)

// ── 2. recordBuy ──────────────────────────────────────────────────────────────

exports.recordBuy = onCall(
  {
    region: 'us-central1',
  },
  async (request) => {
    const {
      amount,
      navpu,
      unitsOverride,
      newAvgPriceOverride,
      totalUnitsOverride,
      totalCostOverride,
      staggerEventDate = null,
      isDividendBuy = false,
      bucket = null,
    } = request.data

    if (!amount || !navpu || amount <= 0 || navpu <= 0) {
      throw new Error('Invalid amount or navpu')
    }

    const todayStr = getTodayPH()
    const monthYear = getMonthPH()

    // Get current position
    const positionSnap = await db.collection('position').doc('current').get()
    const position = positionSnap.exists
      ? positionSnap.data()
      : { units: 0, avgPrice: 0, totalCost: 0 }

    const currentUnits = position.units || 0
    const currentCost = position.totalCost || 0

    // Calculate units bought
    const unitsBought = unitsOverride != null ? unitsOverride : amount / navpu

    // Calculate new position
    const newTotalUnits = totalUnitsOverride != null ? totalUnitsOverride : currentUnits + unitsBought
    const newTotalCost = totalCostOverride != null ? totalCostOverride : currentCost + amount
    const newAvgPrice =
      newAvgPriceOverride != null
        ? newAvgPriceOverride
        : newTotalUnits > 0
        ? newTotalCost / newTotalUnits
        : 0
    const newMarketValue = newTotalUnits * navpu
    const newUnrealizedGain = newMarketValue - newTotalCost
    const newUnrealizedGainPct =
      newTotalCost > 0 ? (newUnrealizedGain / newTotalCost) * 100 : 0

    // Write buy record
    const buyRef = await db.collection('buys').add({
      date: todayStr,
      amount: parseFloat(amount.toFixed(2)),
      navpu: parseFloat(parseFloat(navpu).toFixed(4)),
      unitsBought: parseFloat(unitsBought.toFixed(4)),
      newAvgPrice: parseFloat(newAvgPrice.toFixed(4)),
      totalUnitsAfter: parseFloat(newTotalUnits.toFixed(4)),
      totalCostAfter: parseFloat(newTotalCost.toFixed(2)),
      monthYear,
      staggerEventDate: staggerEventDate || null,
      isDividendBuy: isDividendBuy || false,
      bucket: bucket || null,
      createdAt: FieldValue.serverTimestamp(),
    })

    // Update position
    const updatedPosition = {
      units: parseFloat(newTotalUnits.toFixed(4)),
      avgPrice: parseFloat(newAvgPrice.toFixed(4)),
      totalCost: parseFloat(newTotalCost.toFixed(2)),
      marketValue: parseFloat(newMarketValue.toFixed(2)),
      unrealizedGain: parseFloat(newUnrealizedGain.toFixed(2)),
      unrealizedGainPct: parseFloat(newUnrealizedGainPct.toFixed(4)),
      updatedAt: FieldValue.serverTimestamp(),
    }

    await db.collection('position').doc('current').set(updatedPosition, { merge: true })

    console.log(`[recordBuy] Recorded ₱${amount} at ₱${navpu}:${unitsBought.toFixed(4)} units`)

    return {
      success: true,
      buyId: buyRef.id,
      position: {
        ...updatedPosition,
        updatedAt: new Date().toISOString(),
      },
    }
  }
)

// ── 3. seedInitialData ────────────────────────────────────────────────────────

exports.seedInitialData = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (req, res) => {
    // Only allow POST or GET from trusted sources
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).send('Method not allowed')
      return
    }

    console.log('[seedInitialData] Starting seed...')

    const results = {
      navpuSeeded: 0,
      navpuSkipped: 0,
      positionSeeded: false,
      configSeeded: false,
      errors: [],
    }

    // ── Seed NAVPU History ──────────────────────────────────────────────────
    const NAVPU_DATA = {
      '2026-01-07': 46.78,
      '2026-01-08': 46.59,
      '2026-01-09': 46.74,
      '2026-01-10': 46.74,
      '2026-01-11': 46.74,
      '2026-01-12': 46.80,
      '2026-01-13': 46.86,
      '2026-01-14': 46.94,
      '2026-01-15': 47.05,
      '2026-01-16': 46.91,
      '2026-01-17': 46.91,
      '2026-01-18': 46.91,
      '2026-01-19': 47.03,
      '2026-01-20': 46.79,
      '2026-01-21': 46.74,
      '2026-01-22': 46.80,
      '2026-01-23': 46.75,
      '2026-01-24': 46.75,
      '2026-01-25': 46.75,
      '2026-01-26': 46.84,
      '2026-01-27': 46.93,
      '2026-01-28': 46.65,
      '2026-01-29': 46.76,
      '2026-01-30': 46.41,
      '2026-01-31': 46.41,
      '2026-02-01': 46.41,
      '2026-02-02': 46.44,
      '2026-02-03': 46.53,
      '2026-02-04': 46.63,
      '2026-02-05': 46.27,
      '2026-02-06': 46.33,
      '2026-02-07': 46.33,
      '2026-02-08': 46.33,
      '2026-02-09': 46.37,
      '2026-02-10': 46.62,
      '2026-02-11': 46.43,
      '2026-02-12': 46.34,
      '2026-02-13': 46.07,
      '2026-02-14': 46.07,
      '2026-02-15': 46.07,
      '2026-02-16': 46.18,
      '2026-02-17': 46.18,
      '2026-02-18': 46.13,
      '2026-02-19': 46.19,
      '2026-02-20': 46.35,
      '2026-02-21': 46.35,
      '2026-02-22': 46.35,
      '2026-02-23': 45.99,
      '2026-02-24': 46.04,
      '2026-02-25': 45.98,
      '2026-02-26': 46.10,
      '2026-02-27': 45.82,
      '2026-02-28': 45.82,
      '2026-03-01': 45.82,
      '2026-03-02': 46.05,
      '2026-03-03': 45.56,
      '2026-03-04': 45.95,
      '2026-03-05': 46.00,
      '2026-03-06': 45.80,
      '2026-03-07': 45.80,
      '2026-03-08': 45.80,
      '2026-03-09': 46.08,
      '2026-03-10': 46.05,
      '2026-03-11': 46.07,
      '2026-03-12': 45.99,
      '2026-03-13': 46.11,
      '2026-03-14': 46.11,
      '2026-03-15': 46.11,
      '2026-03-16': 46.31,
      '2026-03-17': 46.40,
      '2026-03-18': 45.99,
      '2026-03-19': 46.13,
      '2026-03-20': 46.13,
      '2026-03-21': 46.13,
      '2026-03-22': 46.13,
      '2026-03-23': 46.33,
      '2026-03-24': 45.86,
      '2026-03-25': 46.17,
      '2026-03-26': 46.12,
      '2026-03-27': 46.01,
      '2026-03-28': 46.01,
      '2026-03-29': 46.01,
      '2026-03-30': 46.11,
      '2026-03-31': 46.07,
      '2026-04-01': 46.02,
      '2026-04-02': 46.02,
      '2026-04-03': 46.02,
      '2026-04-04': 46.02,
      '2026-04-05': 46.02,
      '2026-04-06': 45.82,
    }

    // Check if navpu_history is already seeded
    const existingSnap = await db.collection('navpu_history').limit(1).get()
    if (!existingSnap.empty) {
      console.log('[seedInitialData] navpu_history already has data:skipping NAVPU seed.')
      results.navpuSkipped = Object.keys(NAVPU_DATA).length
    } else {
      // Seed in batches of 400 (Firestore batch limit is 500)
      const entries = Object.entries(NAVPU_DATA)
      const sortedEntries = entries.sort((a, b) => a[0].localeCompare(b[0]))

      let batch = db.batch()
      let count = 0

      for (let i = 0; i < sortedEntries.length; i++) {
        const [date, navpu] = sortedEntries[i]
        const prev = i > 0 ? sortedEntries[i - 1][1] : null
        const dailyChange = prev !== null ? parseFloat((navpu - prev).toFixed(4)) : 0

        const docRef = db.collection('navpu_history').doc(date)
        batch.set(docRef, {
          date,
          navpu,
          dailyChange,
          createdAt: FieldValue.serverTimestamp(),
        })
        count++

        // Commit every 400 docs
        if (count % 400 === 0) {
          await batch.commit()
          batch = db.batch()
        }
      }

      // Commit remaining
      if (count % 400 !== 0) {
        await batch.commit()
      }

      results.navpuSeeded = count
      console.log(`[seedInitialData] Seeded ${count} NAVPU records.`)
    }

    // ── Seed Position ─────────────────────────────────────────────────────────
    const positionSnap = await db.collection('position').doc('current').get()
    if (!positionSnap.exists) {
      await db.collection('position').doc('current').set({
        units: 4684.51,
        avgPrice: 45.48,
        totalCost: 213049.37,
        marketValue: 214666.27,
        unrealizedGain: 1616.90,
        unrealizedGainPct: 0.76,
        updatedAt: FieldValue.serverTimestamp(),
      })
      results.positionSeeded = true
      console.log('[seedInitialData] Position seeded.')
    } else {
      console.log('[seedInitialData] Position already exists:skipping.')
    }

    // ── Seed Config ───────────────────────────────────────────────────────────
    const configSnap = await db.collection('config').doc('app').get()
    if (!configSnap.exists) {
      await db.collection('config').doc('app').set({
        recordDates: ['2026-01-29', '2026-02-26', '2026-03-27', '2026-04-28'],
        createdAt: FieldValue.serverTimestamp(),
      })
      results.configSeeded = true
      console.log('[seedInitialData] Config seeded.')
    } else {
      console.log('[seedInitialData] Config already exists:skipping.')
    }

    console.log('[seedInitialData] Complete.', results)
    res.status(200).json({
      message: 'Seed complete',
      ...results,
    })
  }
)

// ── 4. seedHistoricalNavpu ────────────────────────────────────────────────────

exports.seedHistoricalNavpu = onRequest(
  { region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).send('Method not allowed')
      return
    }
    console.log('[seedHistoricalNavpu] Seeding', HISTORICAL_NAVPU.length, 'entries...')
    try {
      const batchSize = 400
      let written = 0
      for (let i = 0; i < HISTORICAL_NAVPU.length; i += batchSize) {
        const batch = db.batch()
        const chunk = HISTORICAL_NAVPU.slice(i, i + batchSize)
        for (const entry of chunk) {
          const ref = db.collection('navpu_history').doc(entry.date)
          batch.set(ref, {
            date: entry.date,
            navpu: entry.navpu,
            dailyChange: entry.dailyChange,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true })
        }
        await batch.commit()
        written += chunk.length
        console.log('[seedHistoricalNavpu] Written', written, '/', HISTORICAL_NAVPU.length)
      }
      res.status(200).json({ message: 'Seed complete', written })
    } catch (err) {
      console.error('[seedHistoricalNavpu] Error:', err)
      res.status(500).json({ error: err.message })
    }
  }
)

// ── 5. seedDividends ──────────────────────────────────────────────────────────

const DIVIDEND_HISTORY = [
  { month: 'Aug 2024', date: '2024-07-31', units: 114.94,    divPerUnit: 0.2179, credited: '2024-09-16' },
  { month: 'Sep 2024', date: '2024-08-29', units: 114.94,    divPerUnit: 0.2179, credited: '2024-09-16' },
  { month: 'Oct 2024', date: '2024-09-27', units: 114.94,    divPerUnit: 0.2194, credited: '2024-10-15' },
  { month: 'Nov 2024', date: '2024-10-30', units: 114.94,    divPerUnit: 0.2257, credited: '2024-11-18' },
  { month: 'Dec 2024', date: '2024-11-28', units: 223.45,    divPerUnit: 0.2289, credited: '2024-12-16' },
  { month: 'Jan 2025', date: '2024-12-27', units: 330.47,    divPerUnit: 0.2286, credited: '2025-01-16' },
  { month: 'Feb 2025', date: '2025-01-30', units: 888.05,    divPerUnit: 0.2277, credited: '2025-02-17' },
  { month: 'Mar 2025', date: '2025-02-27', units: 1327.40,   divPerUnit: 0.2282, credited: '2025-03-17' },
  { month: 'Apr 2025', date: '2025-03-28', units: 1327.40,   divPerUnit: 0.2258, credited: '2025-04-21' },
  { month: 'May 2025', date: '2025-04-29', units: 1327.40,   divPerUnit: 0.2134, credited: '2025-05-21' },
  { month: 'Jun 2025', date: '2025-05-29', units: 1327.40,   divPerUnit: 0.2240, credited: '2025-06-17' },
  { month: 'Jul 2025', date: '2025-06-27', units: 1327.40,   divPerUnit: 0.2264, credited: '2025-07-15' },
  { month: 'Aug 2025', date: '2025-07-31', units: 1327.40,   divPerUnit: 0.2260, credited: '2025-08-15' },
  { month: 'Sep 2025', date: '2025-08-29', units: 1416.91,   divPerUnit: 0.2345, credited: '2025-09-17' },
  { month: 'Oct 2025', date: '2025-09-29', units: 1838.19,   divPerUnit: 0.2292, credited: '2025-10-15' },
  { month: 'Nov 2025', date: '2025-10-30', units: 2056.29,   divPerUnit: 0.2323, credited: '2025-11-18' },
  { month: 'Dec 2025', date: '2025-11-27', units: 2594.39,   divPerUnit: 0.2359, credited: '2025-12-16' },
  { month: 'Jan 2026', date: '2025-12-29', units: 3135.19,   divPerUnit: 0.2362, credited: '2026-01-16' },
  { month: 'Feb 2026', date: '2026-01-29', units: 3341.574,  divPerUnit: 0.2338, credited: '2026-02-16' },
  { month: 'Mar 2026', date: '2026-02-26', units: 3771.7523, divPerUnit: 0.2291, credited: '2026-03-16' },
]

exports.seedDividends = onRequest(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).send('Method not allowed')
      return
    }
    try {
      const batch = db.batch()
      for (const r of DIVIDEND_HISTORY) {
        const ref = db.collection('dividends').doc(r.date)
        batch.set(ref, {
          ...r,
          earned: parseFloat((r.units * r.divPerUnit).toFixed(4)),
        }, { merge: true })
      }
      await batch.commit()
      res.status(200).json({ message: 'Dividends seeded', count: DIVIDEND_HISTORY.length })
    } catch (err) {
      console.error('[seedDividends] Error:', err)
      res.status(500).json({ error: err.message })
    }
  }
)

// ── 6. runBacktest ────────────────────────────────────────────────────────────

exports.runBacktest = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).send('Method not allowed')
      return
    }
    console.log('[runBacktest] Starting backtest...')

    try {
      const { results, summary } = await runBacktest(db)

      // Store summary
      await db.collection('config').doc('backtest_summary').set(summary)

      // Store individual results in Firestore batches (max 400 per batch)
      const batchSize = 400
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = db.batch()
        const chunk = results.slice(i, i + batchSize)
        for (const r of chunk) {
          const ref = db.collection('backtest_results').doc(r.date)
          batch.set(ref, r)
        }
        await batch.commit()
      }

      console.log('[runBacktest] Complete.', summary)
      res.status(200).json({ message: 'Backtest complete', summary })
    } catch (err) {
      console.error('[runBacktest] Error:', err)
      res.status(500).json({ error: err.message })
    }
  }
)

// ── 7. scheduledBacktest ──────────────────────────────────────────────────────

exports.scheduledBacktest = onSchedule(
  {
    schedule: '0 10 1,15 * *', // 10:00 AM Asia/Manila on the 1st and 15th
    timeZone: 'Asia/Manila',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    console.log('[scheduledBacktest] Starting...')
    try {
      const { results, summary } = await runBacktest(db)
      await db.collection('config').doc('backtest_summary').set(summary)
      const batchSize = 400
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = db.batch()
        for (const r of results.slice(i, i + batchSize)) {
          batch.set(db.collection('backtest_results').doc(r.date), r)
        }
        await batch.commit()
      }
      console.log('[scheduledBacktest] Done.', summary)
    } catch (err) {
      console.error('[scheduledBacktest] Error:', err)
    }
  }
)

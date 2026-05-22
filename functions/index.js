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
const { analyzeSignal: analyzeBtcSignal, computeThresholds: computeBtcThresholds, analyzeSwingSignal, swingExitLevels, SWING } = require('./btcSignalEngine')
const { sendSignalEmail, sendBtcSignalEmail, sendBtcSellEmail, sendMgpiffSignalEmail } = require('./emailer')
const { scrapeMgpiffNavpu } = require('./mgpiffScraper')
const { analyzeSignal: analyzeMgpiffSignal, computeMgpiffThresholds, MGPIFF_INITIAL_THRESHOLDS } = require('./mgpiffSignalEngine')
const { HISTORICAL_NAVPU } = require('./historical_navpu_data')
const { runBacktest } = require('./backtest')
const { runBtcBacktest } = require('./btcBacktest')
const { runMgpiffBacktest } = require('./mgpiffBacktest')

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
 * Parse a human-readable date string like "March 30, 2026" or "26 February 2026"
 * into a YYYY-MM-DD ISO string. Returns null if unparseable.
 */
function parseDateToISO(str) {
  const months = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  }
  const parts = str.trim().match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(202\d)/) ||
    str.trim().match(/(\d{1,2})\s+([A-Za-z]+)\s+(202\d)/)
  if (!parts) return null
  const monthName = isNaN(parts[1]) ? parts[1] : parts[2]
  const day = isNaN(parts[1]) ? parts[2] : parts[1]
  const year = parts[3]
  const mm = months[monthName.toLowerCase()]
  return mm ? `${year}-${mm}-${String(parseInt(day)).padStart(2, '0')}` : null
}

/**
 * Scrape ALFM dividend declarations from BPI's monthly announcement page.
 * URL pattern: bpi.com.ph/group/bpiwealth/news/dividend-declaration-alfm-global-multi-asset-income-fund-{month}-{year}
 * Stores confirmed record into the dividends collection.
 * Replaces the old NAVPU-drop-based autoDetectDividend approach.
 */
async function scrapeAndStoreAlfmDividend(db, todayStr) {
  const now = new Date(todayStr + 'T00:00:00')
  // Try current month and previous month (declaration may be up for both)
  const targets = []
  for (let i = -1; i <= 0; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    targets.push({
      name: d.toLocaleString('en-US', { month: 'long' }).toLowerCase(),
      year: d.getFullYear(),
    })
  }

  for (const { name, year } of targets) {
    const url = `https://www.bpi.com.ph/group/bpiwealth/news/dividend-declaration-alfm-global-multi-asset-income-fund-${name}-${year}`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ALFM-Tracker/1.0; +https://alfm-tracker.web.app)' },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        console.log(`[scrapeAlfmDividend] No page for ${name} ${year} (HTTP ${res.status})`)
        continue
      }

      const html = await res.text()
      // Strip HTML tags for easier text parsing
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

      // Record date
      const rdMatch = text.match(/Record\s+Date[:\s]+([\w\s,]+202\d)/i)
      if (!rdMatch) { console.log(`[scrapeAlfmDividend] No record date found for ${name} ${year}`); continue }
      const recordDate = parseDateToISO(rdMatch[1].trim())
      if (!recordDate) continue

      // Check if already confirmed
      const existing = await db.collection('dividends').doc(recordDate).get()
      if (existing.exists && existing.data().confirmed === true) {
        console.log(`[scrapeAlfmDividend] ${recordDate} already confirmed — skipping`)
        continue
      }

      // Extract all PHP Class numeric values; pick by magnitude
      const phpMatches = [...text.matchAll(/PHP\s+Class[:\s]*(?:PHP\s+|₱)?([\d.]+)/gi)]
      const phpValues = phpMatches.map((m) => parseFloat(m[1])).filter((v) => !isNaN(v))
      const unitIncome = phpValues.find((v) => v > 0 && v < 0.1) ?? null      // 0.004x
      const navpuAtRecord = phpValues.find((v) => v > 40 && v < 60) ?? null   // 46.xx

      const divPerUnit = unitIncome && navpuAtRecord
        ? parseFloat((unitIncome * navpuAtRecord).toFixed(4))
        : null

      // Credited date
      const crMatch = text.match(/[Cc]redited[^.]*?([\w\s,]+202\d)/i) ||
        text.match(/[Cc]rediting[^.]*?([\w\s,]+202\d)/i)
      const credited = crMatch ? parseDateToISO(crMatch[1].trim()) : null

      // Units at record date from buys
      const buysSnap = await db.collection('buys')
        .where('date', '<=', recordDate)
        .orderBy('date', 'desc')
        .limit(1)
        .get()
      const units = !buysSnap.empty ? (buysSnap.docs[0].data().totalUnitsAfter ?? null) : null

      // Payout month label
      const rd = new Date(recordDate + 'T00:00:00')
      rd.setMonth(rd.getMonth() + 1)
      const month = rd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

      const payload = {
        date: recordDate,
        month,
        units,
        unitIncome,
        navpuAtRecord,
        divPerUnit,
        earned: units && divPerUnit ? parseFloat((units * divPerUnit).toFixed(4)) : null,
        credited,
        confirmed: true,
        autoDetected: true,
        estimated: false,
        source: 'bpi.com.ph',
        scrapedAt: new Date().toISOString(),
      }

      await db.collection('dividends').doc(recordDate).set(payload)
      console.log(`[scrapeAlfmDividend] Stored: ${recordDate} unitIncome=${unitIncome} navpu=${navpuAtRecord} divPerUnit=${divPerUnit}`)
    } catch (err) {
      console.error(`[scrapeAlfmDividend] Error for ${name} ${year}:`, err.message)
    }
  }
}

/**
 * Return the Nth trading day (Mon–Fri, non-PH-holiday) within a calendar month.
 * month is 0-indexed (0 = January).
 */
function nthTradingDayOfMonth(year, month, n) {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month, day)
    if (d.getMonth() !== month) break
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (!isNonTradingDay(dateStr)) {
      count++
      if (count === n) return dateStr
    }
  }
  return null
}

/**
 * Compute MGPIFF distribution dates (7th trading day of each month)
 * for a window of months centered on todayStr. Used as recordDates
 * input to analyzeSignal so divCycle detection works correctly.
 */
function getMgpiffDistributionDates(todayStr) {
  const dates = []
  const now = new Date(todayStr + 'T00:00:00')
  for (let i = -2; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const date = nthTradingDayOfMonth(d.getFullYear(), d.getMonth(), 7)
    if (date) dates.push(date)
  }
  return dates
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
      await db.collection('scrape_errors').doc(todayStr).set({
        date: todayStr,
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

    // 11. Scrape ALFM dividend declaration from BPI monthly announcement page
    try {
      await scrapeAndStoreAlfmDividend(db, todayStr)
    } catch (divErr) {
      console.error('[dailyNavpuCheck] scrapeAndStoreAlfmDividend error (non-fatal):', divErr.message)
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
    cors: true,
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
      date: dateOverride = null,
    } = request.data

    if (!amount || !navpu || amount <= 0 || navpu <= 0) {
      throw new Error('Invalid amount or navpu')
    }

    const todayStr = dateOverride || getTodayPH()
    const monthYear = todayStr.substring(0, 7)

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

// ── 3. correctBuyNavpu ───────────────────────────────────────────────────────

exports.correctBuyNavpu = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    const { buyId, newNavpu } = request.data
    if (!buyId || !newNavpu || newNavpu <= 0) throw new Error('Invalid buyId or newNavpu')

    const buyRef = db.collection('buys').doc(buyId)
    const buySnap = await buyRef.get()
    if (!buySnap.exists) throw new Error('Buy document not found')

    const buy = buySnap.data()
    const newUnitsBought = parseFloat((buy.amount / newNavpu).toFixed(4))
    const delta = newUnitsBought - buy.unitsBought
    const newTotalUnitsAfter = parseFloat((buy.totalUnitsAfter + delta).toFixed(4))
    const newAvgPrice = parseFloat((buy.totalCostAfter / newTotalUnitsAfter).toFixed(4))

    await buyRef.update({
      navpu: parseFloat(parseFloat(newNavpu).toFixed(4)),
      unitsBought: newUnitsBought,
      totalUnitsAfter: newTotalUnitsAfter,
      newAvgPrice: newAvgPrice,
    })

    // Adjust position by the same unit delta
    const posSnap = await db.collection('position').doc('current').get()
    if (posSnap.exists) {
      const pos = posSnap.data()
      const newPosUnits = parseFloat((pos.units + delta).toFixed(4))
      const newPosAvgPrice = parseFloat((pos.totalCost / newPosUnits).toFixed(4))
      const newMarketValue = parseFloat((newPosUnits * newNavpu).toFixed(2))
      const newUnrealizedGain = parseFloat((newMarketValue - pos.totalCost).toFixed(2))
      const newUnrealizedGainPct = parseFloat(((newUnrealizedGain / pos.totalCost) * 100).toFixed(4))
      await db.collection('position').doc('current').update({
        units: newPosUnits,
        avgPrice: newPosAvgPrice,
        marketValue: newMarketValue,
        unrealizedGain: newUnrealizedGain,
        unrealizedGainPct: newUnrealizedGainPct,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    return { success: true, newUnitsBought, newAvgPrice }
  }
)

// ── 4. seedInitialData ────────────────────────────────────────────────────────

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

// ── 3a. restoreBtcPosition ────────────────────────────────────────────────────
// One-time call to restore a manually logged BTC buy that the engine wiped.
// DELETE this function after calling it.
exports.restoreBtcPosition = onRequest({ region: 'us-central1' }, async (req, res) => {
  const amountPhp      = 15384
  const btcPriceUsd    = 80008
  const phpPerUsd      = 62.59
  const unitsBought    = parseFloat((amountPhp / (btcPriceUsd * phpPerUsd)).toFixed(8))
  const stopLossUsd    = parseFloat((btcPriceUsd * 0.92).toFixed(2))
  const tpUsd          = parseFloat((btcPriceUsd * 1.06).toFixed(2))
  const entryTimestamp = '2026-05-13T00:00:00.000Z'

  await db.collection('btc_position').doc('current').set({
    state:               'BUILDING',
    units:               unitsBought,
    avgCost:             btcPriceUsd,
    avgEntryPriceUsd:    btcPriceUsd,
    totalCostPhp:        amountPhp,
    totalDeployedPhp:    amountPhp,
    currentBalancePhp:   0,
    entryCount:          1,
    entries:             [{ priceUsd: btcPriceUsd, amountPhp, timestamp: entryTimestamp }],
    firstEntryTimestamp: entryTimestamp,
    lastEntryTimestamp:  entryTimestamp,
    stopLossUsd,
    tpUsd,
    hardExitTimestamp:   null,
    exitSignal:          null,
    exitSignalAt:        null,
    updatedAt:           FieldValue.serverTimestamp(),
  })

  res.status(200).json({
    message: 'BTC position restored',
    units: unitsBought,
    avgEntryPriceUsd: btcPriceUsd,
    stopLossUsd,
    tpUsd,
    totalDeployedPhp: amountPhp,
  })
})

// ── 3b. initBtcPosition ───────────────────────────────────────────────────────
// One-time HTTP call to set the initial BTC swing trade position.
// Call once after deploy: curl https://.../initBtcPosition
exports.initBtcPosition = onRequest({ region: 'us-central1' }, async (req, res) => {
  const existing = await db.collection('btc_position').doc('current').get()
  if (existing.exists && existing.data().state) {
    return res.status(200).json({ message: 'Already initialized', data: existing.data() })
  }
  await db.collection('btc_position').doc('current').set({
    state: 'FLAT',
    currentBalancePhp: 15000,
    entryCount: 0,
    entries: [],
    avgEntryPriceUsd: null,
    totalDeployedPhp: 0,
    firstEntryTimestamp: null,
    lastEntryTimestamp: null,
    stopLossUsd: null,
    tpUsd: null,
    hardExitTimestamp: null,
    macroMode: 'NORMAL',
    killSwitchUntil: null,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return res.status(200).json({ message: 'BTC position initialized — FLAT, ₱15,000 balance, swing trade strategy.' })
})

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

// ── 8. recordBtcBuy ───────────────────────────────────────────────────────────

/**
 * Record a BTC purchase and update the user's BTC position in Firestore.
 *
 * Called from BtcBuyModal when the user confirms a buy.
 *
 * Writes to:
 *   btc_buys/{auto-id}       — individual transaction record
 *   btc_position/current     — updated position (units, avgCost, totalCostPhp)
 *
 * Position calculations:
 *   newTotalUnits   = currentUnits + unitsBought
 *   newAvgCostUsd   = weighted average: (currentUnits * currentAvgCost + unitsBought * btcPriceUsd) / newTotalUnits
 *   newTotalCostPhp = currentTotalCostPhp + amountPhp
 *
 * @param {number}      data.amountPhp              PHP spent on this purchase
 * @param {number}      data.btcPriceUsd             BTC price in USD at purchase time
 * @param {number}      data.phpPerUsd               Exchange rate used (PHP per 1 USD)
 * @param {number}      data.unitsBought             BTC units received (from exchange or calculated)
 * @param {string|null} data.bucket                  Signal bucket ('opportunity', 'extreme_override', null)
 * @param {string|null} data.signalName              Signal tier at time of buy (e.g. 'BUY_MORE')
 * @param {string}      data.monthYear               'YYYY-MM' in PH timezone
 * @param {string|null} data.staggerEventTimestamp   ISO timestamp if this is part of a stagger event
 */
exports.recordBtcBuy = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    const {
      amountPhp,
      btcPriceUsd,
      phpPerUsd,
      unitsBought,
      bucket             = null,
      signalName         = null,
      monthYear,
      staggerEventTimestamp = null,
    } = request.data

    if (!amountPhp || amountPhp <= 0)   throw new Error('amountPhp must be > 0')
    if (!btcPriceUsd || btcPriceUsd <= 0) throw new Error('btcPriceUsd must be > 0')
    if (!unitsBought || unitsBought <= 0) throw new Error('unitsBought must be > 0')

    const nowIso    = new Date().toISOString()
    const todayStr  = getTodayPH()
    const month     = monthYear || getMonthPH()

    // Read current position (may not exist on first buy)
    const posSnap = await db.collection('btc_position').doc('current').get()
    const pos     = posSnap.exists ? posSnap.data() : {}

    const currentUnits      = pos.units        ?? 0
    const currentAvgCost    = pos.avgCost      ?? 0   // USD
    const currentCostPhp    = pos.totalCostPhp ?? 0   // PHP
    const existingEntries   = pos.entries      ?? []
    const existingEntryCount = pos.entryCount  ?? 0

    // New position values
    const newTotalUnits   = currentUnits + unitsBought
    const newAvgCostUsd   = newTotalUnits > 0
      ? (currentUnits * currentAvgCost + unitsBought * btcPriceUsd) / newTotalUnits
      : btcPriceUsd
    const newTotalCostPhp = currentCostPhp + amountPhp

    // Market value snapshot at time of buy
    const marketValuePhp  = newTotalUnits * btcPriceUsd * phpPerUsd
    const unrealizedPhp   = marketValuePhp - newTotalCostPhp

    // Swing position tracking
    const INITIAL_BALANCE   = 15000
    const newEntryCount     = existingEntryCount + 1
    const newEntries        = [...existingEntries, { priceUsd: btcPriceUsd, amountPhp, timestamp: nowIso }]
    const newState          = newEntryCount >= 3 ? 'FULL' : 'BUILDING'
    const firstEntryTs      = pos.firstEntryTimestamp || nowIso
    const hardExitTs        = pos.hardExitTimestamp   || new Date(new Date(firstEntryTs).getTime() + 120 * 3600000).toISOString()
    const currentBalancePhp = Math.max(0, INITIAL_BALANCE - newTotalCostPhp)

    // Recalculate TP/SL based on new avg entry
    const stopLossUsd = parseFloat((newAvgCostUsd * 0.92).toFixed(2))
    const tpUsd       = parseFloat((newAvgCostUsd * 1.06).toFixed(2))

    // Write buy record
    const buyRef = await db.collection('btc_buys').add({
      timestamp:            nowIso,
      date:                 todayStr,
      monthYear:            month,
      amountPhp:            parseFloat(amountPhp.toFixed(2)),
      btcPriceUsd:          parseFloat(btcPriceUsd.toFixed(2)),
      phpPerUsd:            parseFloat(phpPerUsd.toFixed(4)),
      unitsBought:          parseFloat(unitsBought.toFixed(8)),
      avgCostAfterUsd:      parseFloat(newAvgCostUsd.toFixed(2)),
      totalUnitsAfter:      parseFloat(newTotalUnits.toFixed(8)),
      totalCostPhpAfter:    parseFloat(newTotalCostPhp.toFixed(2)),
      bucket,
      signalName,
      staggerEventTimestamp: staggerEventTimestamp || null,
      createdAt:            FieldValue.serverTimestamp(),
    })

    // Update position — includes state + all fields the UI needs
    await db.collection('btc_position').doc('current').set({
      state:                newState,
      units:                parseFloat(newTotalUnits.toFixed(8)),
      avgCost:              parseFloat(newAvgCostUsd.toFixed(2)),
      avgEntryPriceUsd:     parseFloat(newAvgCostUsd.toFixed(2)),
      totalCostPhp:         parseFloat(newTotalCostPhp.toFixed(2)),
      totalDeployedPhp:     parseFloat(newTotalCostPhp.toFixed(2)),
      marketValuePhp:       parseFloat(marketValuePhp.toFixed(2)),
      unrealizedPhp:        parseFloat(unrealizedPhp.toFixed(2)),
      entries:              newEntries,
      entryCount:           newEntryCount,
      lastEntryPriceUsd:    parseFloat(btcPriceUsd.toFixed(2)),
      firstEntryTimestamp:  firstEntryTs,
      hardExitTimestamp:    hardExitTs,
      currentBalancePhp:    parseFloat(currentBalancePhp.toFixed(2)),
      stopLossUsd,
      tpUsd,
      lastBuyDate:          todayStr,
      updatedAt:            FieldValue.serverTimestamp(),
    }, { merge: true })

    console.log(`[recordBtcBuy] ₱${amountPhp} → ₿${unitsBought.toFixed(8)} @ $${btcPriceUsd}`)

    return {
      success: true,
      buyId:   buyRef.id,
      position: {
        units:        parseFloat(newTotalUnits.toFixed(8)),
        avgCost:      parseFloat(newAvgCostUsd.toFixed(2)),
        totalCostPhp: parseFloat(newTotalCostPhp.toFixed(2)),
      },
    }
  }
)

// ── BTC helpers ───────────────────────────────────────────────────────────────

/**
 * recordBtcSell — manually log a sell executed on PDAX.
 * Transitions position HOLDING → FLAT, writes trade to btc_trades.
 */
exports.recordBtcSell = onCall({ region: 'us-central1', cors: true }, async (request) => {
  const { exitPriceUsd } = request.data
  if (!exitPriceUsd || exitPriceUsd <= 0) throw new Error('exitPriceUsd is required')

  const posSnap = await db.collection('btc_position').doc('current').get()
  if (!posSnap.exists) throw new Error('No position document found')

  const pos = posSnap.data()
  if (pos.state === 'FLAT') throw new Error('No open position to sell')

  const { avgEntryPriceUsd, totalDeployedPhp, firstEntryTimestamp, currentBalancePhp, entries } = pos
  const PDAX_FEE  = 0.005
  const grossPct  = avgEntryPriceUsd ? (exitPriceUsd - avgEntryPriceUsd) / avgEntryPriceUsd : 0
  const netPct    = grossPct - 2 * PDAX_FEE
  const deployed  = totalDeployedPhp || currentBalancePhp || 0
  const profitPhp = parseFloat((deployed * netPct).toFixed(2))
  const newBalance = parseFloat((currentBalancePhp + profitPhp).toFixed(2))
  const nowIso    = new Date().toISOString()
  const holdHours = firstEntryTimestamp
    ? parseFloat(((Date.now() - new Date(firstEntryTimestamp).getTime()) / 3600000).toFixed(1))
    : null

  const tradesSnap = await db.collection('btc_trades').get()
  await db.collection('btc_trades').add({
    tradeNumber:          tradesSnap.size + 1,
    entries:              entries || [],
    avgEntryPriceUsd,
    exitPriceUsd,
    totalDeployedPhp:     deployed,
    estimatedProfitPhp:   profitPhp,
    exitBalancePhp:       newBalance,
    firstEntryTimestamp,
    exitTimestamp:        nowIso,
    holdHours,
    exitType:             'MANUAL',
    manualSell:           true,
    createdAt:            FieldValue.serverTimestamp(),
  })

  await db.collection('btc_position').doc('current').set({
    state: 'FLAT', currentBalancePhp: newBalance,
    entryCount: 0, entries: [], avgEntryPriceUsd: null,
    totalDeployedPhp: 0, firstEntryTimestamp: null, lastEntryTimestamp: null,
    stopLossUsd: null, tpUsd: null, hardExitTimestamp: null,
    exitSignal: null, exitSignalAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return { profitPhp, newBalancePhp: newBalance, holdHours, netPct }
})

/**
 * Return the current UTC time as an ISO 8601 string.
 * Used as the canonical timestamp for BTC signal runs.
 * @returns {string}  e.g. "2026-04-23T08:00:00.000Z"
 */
function getBtcNowIso() {
  return new Date().toISOString()
}

/**
 * Return the current calendar month in PH timezone as a "YYYY-MM" string.
 * Matches the format used by the ALFM monthYear field so the same
 * query pattern works across both btc_buys and buys collections.
 * @returns {string}  e.g. "2026-04"
 */
function getBtcMonthPH() {
  const now = new Date()
  const ph  = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
  return `${ph.getFullYear()}-${String(ph.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Fetch the last `limit` hourly OHLCV candles for BTC/USDT from Binance.
 *
 * Uses the public Klines endpoint — no API key required.
 * Each returned object contains { openTime, open, high, low, close, volume, closeTime }.
 *
 * Throws on network errors or non-200 HTTP status so the caller can handle
 * the failure gracefully (log and skip email rather than crash the function).
 *
 * @param {number} [limit=720]   Number of candles to fetch (max 1000, default 720 = 30 days).
 * @returns {Promise<Array<{openTime:number, open:number, high:number, low:number, close:number, volume:number, closeTime:number}>>}
 */
async function fetchBtcCandles(limit = 720) {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=${limit}`
  const res  = await fetch(url, { signal: AbortSignal.timeout(12000) })

  if (!res.ok) throw new Error(`Binance API HTTP ${res.status}`)

  const raw = await res.json()

  // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
  return raw.map((k) => ({
    openTime:  k[0],
    open:      parseFloat(k[1]),
    high:      parseFloat(k[2]),
    low:       parseFloat(k[3]),
    close:     parseFloat(k[4]),
    volume:    parseFloat(k[5]),
    closeTime: k[6],
  }))
}

/**
 * Fetch the current Crypto Fear & Greed Index from alternative.me.
 *
 * The index is updated once per day. Returns null on any error so
 * the signal engine falls back to its no-fearGreed path gracefully.
 *
 * @returns {Promise<{value:number, classification:string}|null>}
 */
async function fetchFearGreed() {
  try {
    const res  = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json()
    const entry = data?.data?.[0]
    if (!entry) return null
    return {
      value:          parseInt(entry.value, 10),
      classification: entry.value_classification,
    }
  } catch {
    return null
  }
}

/**
 * Calculate RSI using Wilder's smoothing method.
 *
 * Requires at least `period + 1` values. Returns null when there is
 * insufficient data rather than returning a misleading result.
 *
 * @param {number[]} closes  Chronological array of close prices.
 * @param {number}   [period=14]
 * @returns {number|null}    RSI value 0–100, rounded to 2 decimal places.
 */
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null

  const changes = closes.slice(1).map((c, i) => c - closes[i])

  // Seed: simple average of first `period` gains and losses
  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else                 avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period

  // Wilder smoothing for the rest of the series
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i]           : 0
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2))
}

/**
 * Sum total PHP spent on BTC this calendar month and find the last buy timestamp.
 *
 * Used to enforce the ₱10,000 monthly budget cap and the 1-hour gap rule.
 * extreme_override buys (EXTREME_DROP) still count toward monthly spend —
 * they bypass the cap check in the engine but are recorded here for accuracy.
 *
 * @param {string} monthYear  "YYYY-MM" string in PH timezone.
 * @returns {Promise<{totalSpent:number, lastTimestamp:string|null}>}
 */
async function sumBtcMonthlySpend(monthYear) {
  const snap = await db.collection('btc_buys').where('monthYear', '==', monthYear).get()
  const docs  = snap.docs.map((d) => d.data())

  const totalSpent = docs.reduce((sum, b) => sum + (b.amountPhp || 0), 0)

  const sorted      = [...docs].sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1))
  const lastTimestamp = sorted.length > 0 ? sorted[sorted.length - 1].timestamp : null

  return { totalSpent, lastTimestamp }
}

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

// ── 8. runBtcBacktest (HTTP) ──────────────────────────────────────────────────

exports.runBtcBacktest = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).send('Method not allowed')
      return
    }
    const lookbackDays = parseInt(req.query.days || req.body?.days || '365', 10)
    console.log(`[runBtcBacktest] Starting backtest (${lookbackDays}d)...`)
    try {
      const { results, summary } = await runBtcBacktest(db, lookbackDays)

      // Persist summary and per-hour results
      await db.collection('btc_config').doc('btc_backtest_summary').set(summary)

      const batchSize = 400
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = db.batch()
        for (const r of results.slice(i, i + batchSize)) {
          batch.set(db.collection('btc_backtest_results').doc(r.hour), r)
        }
        await batch.commit()
      }

      console.log('[runBtcBacktest] Done.', summary.simulation)
      res.status(200).json({ message: 'BTC backtest complete', summary })
    } catch (err) {
      console.error('[runBtcBacktest] Error:', err)
      res.status(500).json({ error: err.message })
    }
  }
)

// ── 9. scheduledBtcBacktest ───────────────────────────────────────────────────

exports.scheduledBtcBacktest = onSchedule(
  {
    schedule: '0 2 1,15 * *',  // 2:00 AM Manila on the 1st and 15th
    timeZone: 'Asia/Manila',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    console.log('[scheduledBtcBacktest] Starting...')
    try {
      const { results, summary } = await runBtcBacktest(db, 365)
      await db.collection('btc_config').doc('btc_backtest_summary').set(summary)
      const batchSize = 400
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = db.batch()
        for (const r of results.slice(i, i + batchSize)) {
          batch.set(db.collection('btc_backtest_results').doc(r.hour), r)
        }
        await batch.commit()
      }
      console.log('[scheduledBtcBacktest] Done.', summary.simulation)
    } catch (err) {
      console.error('[scheduledBtcBacktest] Error:', err)
    }
  }
)

// ── 10. btcHourlySignalCheck ──────────────────────────────────────────────────

/**
 * BTC hourly signal check — swing trade strategy.
 *
 * Strategy: buy short-term weakness (24h drop -3 to -8%, RSI<35, stabilization),
 * hold into mean reversion, exit ALL at +6% TP (~+5% net) or time/stop limit.
 *
 * Signals: SCAN | KILL_SWITCH | ENTRY_1 | ADD_ENTRY | HOLDING |
 *          TP_HIT | TIME_EXIT | STOP_LOSS
 *
 * Position structure (btc_position/current):
 *   state              FLAT | BUILDING | FULL
 *   currentBalancePhp  grows with each profitable cycle
 *   entryCount         0–3
 *   entries            [{ priceUsd, amountPhp, timestamp }]
 *   avgEntryPriceUsd   weighted avg of entries
 *   stopLossUsd        avgEntry × 0.92
 *   tpUsd              +6% from avg entry — sell ALL
 *   hardExitTimestamp  firstEntry + 120h
 *   killSwitchUntil    ISO — active when 7d drop ≤ -10%
 */
exports.btcHourlySignalCheck = onSchedule(
  {
    schedule:       '0 * * * *',    // every hour, on the hour
    timeZone:       'Asia/Manila',
    memory:         '256MiB',
    timeoutSeconds: 60,
    secrets:        [gmailUser, gmailPass],
  },
  async () => {
    const nowIso   = getBtcNowIso()
    const monthYear = getBtcMonthPH()

    console.log(`[btcHourlySignalCheck] Running at ${nowIso}`)

    // ── 1. Fetch hourly candles (168h = 7d for min data, 720h for volume/RSI) ──
    let candles
    try {
      candles = await fetchBtcCandles(720)
    } catch (err) {
      console.error('[btcHourlySignalCheck] Binance hourly fetch failed:', err.message)
      return
    }
    if (candles.length < 25) { console.error('[btcHourlySignalCheck] Too few candles'); return }

    // ── 2. Fetch 200-day MA from daily candles ────────────────────────────────
    let ma200 = null
    try {
      const dailyRes = await fetch(
        'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200',
        { signal: AbortSignal.timeout(12000) }
      )
      if (dailyRes.ok) {
        const daily = await dailyRes.json()
        const dailyCloses = daily.map((k) => parseFloat(k[4]))
        if (dailyCloses.length >= 20) {
          ma200 = parseFloat((dailyCloses.reduce((a, b) => a + b) / dailyCloses.length).toFixed(2))
        }
      }
    } catch { /* non-fatal */ }
    console.log(`[btcHourlySignalCheck] 200d MA: $${ma200 ?? 'unavailable'}`)

    // ── 3. Derive price inputs ────────────────────────────────────────────────
    const closes  = candles.map((c) => c.close)
    const volumes = candles.map((c) => c.volume)
    const n       = closes.length

    const currentPrice  = closes[n - 1]
    const prevHourPrice = closes[n - 2]
    const currentOpen   = candles[n - 1].open
    const price24hAgo   = n >= 25 ? closes[n - 25] : null
    const price7dAgo    = n >= 169 ? closes[n - 169] : null
    const low24h        = Math.min(...closes.slice(-24))

    const rsi         = calculateRSI(closes.slice(-30), 14)
    const avgVol      = volumes.slice(0, -1).reduce((a, b) => a + b) / (volumes.length - 1) // exclude current open candle
    const volumeRatio = avgVol > 0 ? parseFloat((volumes[n - 2] / avgVol).toFixed(3)) : null

    console.log(`[btcHourlySignalCheck] Price: $${currentPrice} | RSI: ${rsi ?? 'N/A'} | Vol: ${volumeRatio ?? 'N/A'}x | 24hAgo: $${price24hAgo ?? '?'}`)

    // ── 4. Read position state ────────────────────────────────────────────────
    const posSnap = await db.collection('btc_position').doc('current').get()
    const pos     = posSnap.exists ? posSnap.data() : {}

    const positionState       = pos.state || 'FLAT'
    const currentBalancePhp   = pos.currentBalancePhp || 15000
    const entryCount          = pos.entryCount || 0
    const entries             = pos.entries || []
    const avgEntryPriceUsd    = pos.avgEntryPriceUsd || null
    const lastEntryPriceUsd   = entries.length > 0 ? entries[entries.length - 1].priceUsd : null
    const firstEntryTimestamp = pos.firstEntryTimestamp || null
    const totalDeployedPhp    = pos.totalDeployedPhp || 0
    const stopLossUsd         = pos.stopLossUsd || null
    const tpUsd               = pos.tpUsd || null
    const hardExitTimestamp   = pos.hardExitTimestamp || null
    const killSwitchUntil     = pos.killSwitchUntil || null

    console.log(`[btcHourlySignalCheck] State: ${positionState} | Entries: ${entryCount}/3 | Balance: ₱${currentBalancePhp}`)

    // ── 5. Run swing signal engine ────────────────────────────────────────────
    const signal = analyzeSwingSignal({
      currentPrice, prevHourPrice, currentOpen,
      price24hAgo, price7dAgo, low24h,
      rsi, volumeRatio, ma200,
      positionState, entryCount, entries,
      avgEntryPriceUsd, lastEntryPriceUsd, firstEntryTimestamp,
      currentBalancePhp, totalDeployedPhp,
      stopLossUsd, tpUsd,
      hardExitTimestamp, killSwitchUntil,
      nowIso,
    })

    console.log(`[btcHourlySignalCheck] Signal: ${signal.signal} | Actionable: ${signal.isActionable}`)

    // ── 6. Update position state in Firestore ────────────────────────────────
    if (signal.newKillSwitchUntil !== killSwitchUntil) {
      await db.collection('btc_position').doc('current').update({
        killSwitchUntil: signal.newKillSwitchUntil,
        macroMode: signal.macroMode,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    if (signal.signal === 'ENTRY_1') {
      const newEntry = { priceUsd: currentPrice, amountPhp: signal.amount, timestamp: nowIso }
      const levels   = swingExitLevels(currentPrice)
      await db.collection('btc_position').doc('current').set({
        state: 'BUILDING',
        currentBalancePhp,
        entryCount: 1,
        entries: [newEntry],
        avgEntryPriceUsd: currentPrice,
        totalDeployedPhp: signal.amount,
        firstEntryTimestamp: nowIso,
        lastEntryTimestamp: nowIso,
        ...levels,
        hardExitTimestamp: signal.hardExitTimestamp,
        macroMode: signal.macroMode,
        killSwitchUntil: signal.newKillSwitchUntil,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: false })
      await db.collection('btc_buys').add({ priceUsd: currentPrice, amountPhp: signal.amount, entryNumber: 1, timestamp: nowIso, monthYear, createdAt: FieldValue.serverTimestamp() })
      console.log(`[btcHourlySignalCheck] ENTRY_1 at $${currentPrice} — ₱${signal.amount}`)

    } else if (signal.signal === 'ADD_ENTRY') {
      const newEntry   = { priceUsd: currentPrice, amountPhp: signal.amount, timestamp: nowIso }
      const allEntries = [...entries, newEntry]
      const newCount   = allEntries.length
      const newAvg     = parseFloat((allEntries.reduce((s, e) => s + e.priceUsd, 0) / newCount).toFixed(2))
      const levels     = swingExitLevels(newAvg)
      const newState   = newCount >= SWING.MAX_ENTRIES ? 'FULL' : 'BUILDING'
      const totalPhp   = allEntries.reduce((s, e) => s + e.amountPhp, 0)
      await db.collection('btc_position').doc('current').set({
        state: newState,
        entryCount: newCount,
        entries: allEntries,
        avgEntryPriceUsd: newAvg,
        totalDeployedPhp: totalPhp,
        lastEntryTimestamp: nowIso,
        ...levels,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      await db.collection('btc_buys').add({ priceUsd: currentPrice, amountPhp: signal.amount, entryNumber: newCount, timestamp: nowIso, monthYear, createdAt: FieldValue.serverTimestamp() })
      console.log(`[btcHourlySignalCheck] ADD_ENTRY ${newCount}/3 at $${currentPrice} — new avg $${newAvg}`)

    } else if (['TP_HIT', 'TIME_EXIT', 'STOP_LOSS'].includes(signal.signal)) {
      // Flag the exit signal — do NOT auto-close the position.
      // The user must physically sell on PDAX first, then confirm via Log Sell.
      // Only recordBtcSell resets state to FLAT and writes to btc_trades.
      const alreadyFlagged = pos.exitSignal === signal.signal
      if (!alreadyFlagged) {
        await db.collection('btc_position').doc('current').update({
          exitSignal: signal.signal,
          exitSignalAt: nowIso,
          updatedAt: FieldValue.serverTimestamp(),
        })
        console.log(`[btcHourlySignalCheck] ${signal.signal} flagged — waiting for manual sell confirmation`)
      } else {
        console.log(`[btcHourlySignalCheck] ${signal.signal} already flagged — skipping duplicate`)
      }
    }

    // ── 7. Persist signal doc ─────────────────────────────────────────────────
    const signalDocId = nowIso.slice(0, 13)
    await db.collection('btc_signals').doc(signalDocId).set({
      ...signal,
      monthYear,
      timestamp: nowIso,
      createdAt: FieldValue.serverTimestamp(),
    })

    // ── 8. Send email ─────────────────────────────────────────────────────────
    const manilaHour      = new Date(nowIso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false })
    const isDailyDigestHour = parseInt(manilaHour, 10) === 9
    const shouldEmail     = signal.isActionable || isDailyDigestHour

    if (shouldEmail) {
      try {
        const user = gmailUser.value()
        const pass = gmailPass.value()
        if (user && pass) {
          const exitSignals = ['TP_HIT', 'TIME_EXIT', 'STOP_LOSS']
          if (exitSignals.includes(signal.signal)) {
            await sendBtcSellEmail(signal, nowIso, user, pass)
          } else {
            await sendBtcSignalEmail(signal, nowIso, user, pass)
          }
          console.log(`[btcHourlySignalCheck] Email sent (${signal.signal})`)
        }
      } catch (emailErr) {
        console.error('[btcHourlySignalCheck] Email error (non-fatal):', emailErr.message)
      }
    }

    console.log('[btcHourlySignalCheck] Done.')
  }
)

// ── 11. dailyMgpiffCheck ──────────────────────────────────────────────────────

exports.dailyMgpiffCheck = onSchedule(
  {
    schedule: '0 16 * * *', // 4:00 PM Asia/Manila — same window as ALFM
    timeZone: 'Asia/Manila',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: [gmailUser, gmailPass],
  },
  async () => {
    const todayStr = getTodayPH()
    const monthYear = getMonthPH()

    console.log(`[dailyMgpiffCheck] Running for ${todayStr}`)

    if (isNonTradingDay(todayStr)) {
      const reason = isWeekend(todayStr) ? 'weekend' : 'PH public holiday'
      console.log(`[dailyMgpiffCheck] Skipping — ${reason}`)
      return
    }

    // 1. Scrape MGPIFF NAVPU from uitf.com.ph
    const yesterday = offsetDate(todayStr, -1)
    const { navpu: scrapedNavpu, effectiveDate: scrapedDate, source, error: scrapeError } = await scrapeMgpiffNavpu(yesterday)

    if (scrapeError || scrapedNavpu === null) {
      console.error('[dailyMgpiffCheck] Scraping failed:', scrapeError)
      await db.collection('mgpiff_scrape_errors').doc(todayStr).set({
        date: todayStr, scrapeError: scrapeError || 'Unknown', createdAt: FieldValue.serverTimestamp(),
      })
      return
    }

    const navpuDate = scrapedDate || yesterday
    console.log(`[dailyMgpiffCheck] Scraped NAVPU: ${scrapedNavpu} from ${source} (date: ${navpuDate})`)

    // 2. Get recent MGPIFF NAVPU history for signal analysis
    const recentDocs = await db.collection('mgpiff_navpu_history')
      .where('date', '<', todayStr)
      .orderBy('date', 'desc')
      .limit(14)
      .get()
    const recentNavpus = recentDocs.docs
      .map((d) => d.data())
      .filter((d) => !isWeekend(d.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => d.navpu)
      .filter((n) => n !== null)

    const yesterdayNavpu = recentNavpus.length > 0 ? recentNavpus[recentNavpus.length - 1] : null
    const twoDaysAgoNavpu = recentNavpus.length > 1 ? recentNavpus[recentNavpus.length - 2] : null
    const last7Navpus = [...recentNavpus.slice(-6), scrapedNavpu]

    // 3. Get MGPIFF position
    const positionSnap = await db.collection('mgpiff_position').doc('current').get()
    const position = positionSnap.exists ? positionSnap.data() : {}
    const avgPrice = position.avgPrice && position.avgPrice > 0 ? position.avgPrice : null

    // 4. Compute bucket state from mgpiff_buys
    const buysSnap = await db.collection('mgpiff_buys').where('monthYear', '==', monthYear).get()
    const monthBuys = buysSnap.docs.map((d) => d.data())
    const dividendBuyDoneThisMonth = monthBuys.some((b) => b.isDividendBuy === true)
    const oppBuys = monthBuys.filter((b) => !b.isDividendBuy && b.bucket !== 'extreme_override')
    const staggerSeen = new Set()
    let opportunityBuyCountThisMonth = 0
    for (const buy of oppBuys) {
      if (buy.staggerEventDate) {
        if (!staggerSeen.has(buy.staggerEventDate)) { staggerSeen.add(buy.staggerEventDate); opportunityBuyCountThisMonth++ }
      } else {
        opportunityBuyCountThisMonth++
      }
    }
    const oppDates = oppBuys.map((b) => b.date).sort()
    const lastOpportunityBuyDate = oppDates.length > 0 ? oppDates[oppDates.length - 1] : null

    // 5. Build MGPIFF distribution dates (7th trading day of each month)
    const recordDates = getMgpiffDistributionDates(todayStr)

    // 6. Compute dynamic thresholds from MGPIFF NAVPU history
    const allNavpuSnap = await db.collection('mgpiff_navpu_history').orderBy('date', 'asc').get()
    const allNavpuValues = allNavpuSnap.docs
      .filter((d) => !isWeekend(d.data().date))
      .map((d) => d.data().navpu)
      .filter((v) => v != null && !isNaN(v))
    const thresholds = computeMgpiffThresholds(allNavpuValues)

    await db.collection('mgpiff_config').doc('thresholds').set(thresholds)

    // 7. Run signal analysis
    const signal = analyzeMgpiffSignal({
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

    console.log(`[dailyMgpiffCheck] Signal: ${signal.signal} amount=${signal.amount}`)

    // 8. Store NAVPU
    await db.collection('mgpiff_navpu_history').doc(navpuDate).set({
      date: navpuDate,
      navpu: scrapedNavpu,
      source,
      dailyChange: signal.dailyChange,
      createdAt: FieldValue.serverTimestamp(),
    })

    // 9. Store signal
    await db.collection('mgpiff_signals').doc(todayStr).set({
      ...signal,
      navpu: scrapedNavpu,
      monthYear,
      createdAt: FieldValue.serverTimestamp(),
    })

    // 10. Update MGPIFF position market value
    if (position.units && position.units > 0) {
      const marketValue = position.units * scrapedNavpu
      const unrealizedGain = marketValue - (position.totalCost || 0)
      const unrealizedGainPct = position.totalCost > 0
        ? parseFloat(((unrealizedGain / position.totalCost) * 100).toFixed(4)) : 0
      await db.collection('mgpiff_position').doc('current').update({
        marketValue: parseFloat(marketValue.toFixed(2)),
        unrealizedGain: parseFloat(unrealizedGain.toFixed(2)),
        unrealizedGainPct,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    // 11. Send email
    try {
      const user = gmailUser.value()
      const pass = gmailPass.value()
      if (user && pass) {
        await sendMgpiffSignalEmail(signal, todayStr, user, pass)
        console.log('[dailyMgpiffCheck] Email sent.')
      }
    } catch (emailErr) {
      console.error('[dailyMgpiffCheck] Email error (non-fatal):', emailErr.message)
    }

    console.log('[dailyMgpiffCheck] Done.')
  }
)

// ── 12. recordMgpiffBuy ───────────────────────────────────────────────────────

exports.recordMgpiffBuy = onCall(
  { region: 'us-central1', cors: true },
  async (request) => {
    const {
      amount,
      navpu,
      unitsOverride = null,
      isDividendBuy = false,
      bucket = null,
      staggerEventDate = null,
      date: dateOverride = null,
    } = request.data

    if (!amount || !navpu || amount <= 0 || navpu <= 0) throw new Error('Invalid amount or navpu')

    const todayStr = dateOverride || getTodayPH()
    const monthYear = todayStr.substring(0, 7)

    const positionSnap = await db.collection('mgpiff_position').doc('current').get()
    const position = positionSnap.exists
      ? positionSnap.data()
      : { units: 0, avgPrice: 0, totalCost: 0 }

    const currentUnits = position.units || 0
    const currentCost = position.totalCost || 0
    const unitsBought = unitsOverride != null ? unitsOverride : amount / navpu
    const newTotalUnits = currentUnits + unitsBought
    const newTotalCost = currentCost + amount
    const newAvgPrice = newTotalUnits > 0 ? newTotalCost / newTotalUnits : 0
    const newMarketValue = newTotalUnits * navpu
    const newUnrealizedGain = newMarketValue - newTotalCost
    const newUnrealizedGainPct = newTotalCost > 0 ? (newUnrealizedGain / newTotalCost) * 100 : 0

    const buyRef = await db.collection('mgpiff_buys').add({
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

    await db.collection('mgpiff_position').doc('current').set({
      units: parseFloat(newTotalUnits.toFixed(4)),
      avgPrice: parseFloat(newAvgPrice.toFixed(4)),
      totalCost: parseFloat(newTotalCost.toFixed(2)),
      marketValue: parseFloat(newMarketValue.toFixed(2)),
      unrealizedGain: parseFloat(newUnrealizedGain.toFixed(2)),
      unrealizedGainPct: parseFloat(newUnrealizedGainPct.toFixed(4)),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    console.log(`[recordMgpiffBuy] ₱${amount} @ ₱${navpu} = ${unitsBought.toFixed(4)} units`)
    return { success: true, buyId: buyRef.id }
  }
)

// ── 13. seedMgpiffData ────────────────────────────────────────────────────────

exports.seedMgpiffData = onRequest(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).send('Method not allowed'); return }

    console.log('[seedMgpiffData] Starting...')
    const results = { positionSeeded: false, dividendsSeeded: 0, skipped: 0 }

    // Seed empty position
    const posSnap = await db.collection('mgpiff_position').doc('current').get()
    if (!posSnap.exists) {
      await db.collection('mgpiff_position').doc('current').set({
        units: 0, avgPrice: 0, totalCost: 0,
        marketValue: 0, unrealizedGain: 0, unrealizedGainPct: 0,
        updatedAt: FieldValue.serverTimestamp(),
      })
      results.positionSeeded = true
    }

    // Seed 12 months of confirmed MGPIFF distribution history
    // Data from Manulife's income-paying funds page (USD class distribution dates;
    // PHP class shares the same dates). unitIncome is the ratio (multiply by NAVPU × units).
    const MGPIFF_DISTRIBUTION_HISTORY = [
      { date: '2025-04-11', paymentDate: '2025-04-23', month: 'Apr 2025', unitIncome: 0.0048 },
      { date: '2025-05-13', paymentDate: '2025-05-21', month: 'May 2025', unitIncome: 0.0049 },
      { date: '2025-06-11', paymentDate: '2025-06-20', month: 'Jun 2025', unitIncome: 0.0046 },
      { date: '2025-07-09', paymentDate: '2025-07-17', month: 'Jul 2025', unitIncome: 0.0045 },
      { date: '2025-08-11', paymentDate: '2025-08-19', month: 'Aug 2025', unitIncome: 0.0044 },
      { date: '2025-09-09', paymentDate: '2025-09-17', month: 'Sep 2025', unitIncome: 0.0044 },
      { date: '2025-10-09', paymentDate: '2025-10-17', month: 'Oct 2025', unitIncome: 0.0042 },
      { date: '2025-11-11', paymentDate: '2025-11-19', month: 'Nov 2025', unitIncome: 0.0041 },
      { date: '2025-12-10', paymentDate: '2025-12-18', month: 'Dec 2025', unitIncome: 0.0044 },
      { date: '2026-01-12', paymentDate: '2026-01-20', month: 'Jan 2026', unitIncome: 0.0045 },
      { date: '2026-02-10', paymentDate: '2026-02-19', month: 'Feb 2026', unitIncome: 0.0045 },
      { date: '2026-03-10', paymentDate: '2026-03-18', month: 'Mar 2026', unitIncome: 0.0046 },
    ]

    const batch = db.batch()
    for (const r of MGPIFF_DISTRIBUTION_HISTORY) {
      const ref = db.collection('mgpiff_dividends').doc(r.date)
      const existing = await ref.get()
      if (existing.exists) { results.skipped++; continue }
      batch.set(ref, { ...r, confirmed: false, earned: null, units: null, autoDetected: false })
      results.dividendsSeeded++
    }
    await batch.commit()

    console.log('[seedMgpiffData] Done.', results)
    res.status(200).json({ message: 'MGPIFF seed complete', ...results })
  }
)

// ── 14. seedMgpiffNavpu ───────────────────────────────────────────────────────
// Fetches MGPIFF NAVPU history directly from uitf.com.ph JSON API and seeds Firestore.
// Safe to re-run — skips existing docs.
// Usage: GET https://.../seedMgpiffNavpu?from=2019-03-25&to=2026-05-22

const { fetchNavpuRange, labelToDate: uitfLabelToDate } = require('./mgpiffScraper')

exports.seedMgpiffNavpu = onRequest(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).send('GET or POST only'); return }

    const fromDate = req.query.from || '2019-03-25' // fund inception date
    const toDate   = req.query.to   || getTodayPH()

    console.log(`[seedMgpiffNavpu] Fetching ${fromDate} → ${toDate}`)

    let rawPoints
    try {
      rawPoints = await fetchNavpuRange(fromDate, toDate)
    } catch (err) {
      res.status(500).json({ error: `uitf.com.ph fetch failed: ${err.message}` })
      return
    }

    if (!rawPoints.length) {
      res.status(200).json({ message: 'No data returned from uitf.com.ph', written: 0, skipped: 0 })
      return
    }

    // Parse + sort chronologically
    const parsed = rawPoints
      .map((p) => ({ date: uitfLabelToDate(p.label), navpu: parseFloat(p.y) }))
      .filter((p) => p.date && !isNaN(p.navpu) && p.navpu >= 40 && p.navpu <= 70)
      .sort((a, b) => a.date.localeCompare(b.date))

    let written = 0, skipped = 0
    const BATCH_SIZE = 400

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = db.batch()
      const chunk = parsed.slice(i, i + BATCH_SIZE)
      for (let j = 0; j < chunk.length; j++) {
        const { date, navpu } = chunk[j]
        const ref = db.collection('mgpiff_navpu_history').doc(date)
        const existing = await ref.get()
        if (existing.exists) { skipped++; continue }
        const prevNavpu = j > 0 ? chunk[j - 1].navpu : (i > 0 ? parsed[i - 1].navpu : null)
        const dailyChange = prevNavpu !== null ? parseFloat((navpu - prevNavpu).toFixed(4)) : 0
        batch.set(ref, {
          date, navpu, dailyChange,
          source: 'uitf.com.ph',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        written++
      }
      await batch.commit()
      console.log(`[seedMgpiffNavpu] Progress: ${i + chunk.length}/${parsed.length}`)
    }

    console.log(`[seedMgpiffNavpu] Done — written=${written} skipped=${skipped}`)
    res.status(200).json({ message: 'MGPIFF NAVPU seed complete', written, skipped, total: parsed.length, range: `${fromDate} → ${toDate}` })
  }
)

// ── 15. runMgpiffBacktest (HTTP, manual trigger) ──────────────────────────────

exports.runMgpiffBacktest = onRequest(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).send('Method not allowed'); return }
    console.log('[runMgpiffBacktest] Starting...')
    try {
      const { results, summary } = await runMgpiffBacktest(db)
      await db.collection('mgpiff_config').doc('backtest_summary').set(summary)
      const batchSize = 400
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = db.batch()
        for (const r of results.slice(i, i + batchSize)) {
          batch.set(db.collection('mgpiff_backtest_results').doc(r.date), r)
        }
        await batch.commit()
      }
      console.log('[runMgpiffBacktest] Done.', summary)
      res.status(200).json({ message: 'MGPIFF backtest complete', summary })
    } catch (err) {
      console.error('[runMgpiffBacktest] Error:', err)
      res.status(500).json({ error: err.message })
    }
  }
)

// ── 16. scheduledMgpiffBacktest ───────────────────────────────────────────────

exports.scheduledMgpiffBacktest = onSchedule(
  {
    schedule: '0 11 1,15 * *', // 11:00 AM Manila on 1st and 15th
    timeZone: 'Asia/Manila',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    console.log('[scheduledMgpiffBacktest] Starting...')
    try {
      const { results, summary } = await runMgpiffBacktest(db)
      await db.collection('mgpiff_config').doc('backtest_summary').set(summary)
      const batchSize = 400
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = db.batch()
        for (const r of results.slice(i, i + batchSize)) {
          batch.set(db.collection('mgpiff_backtest_results').doc(r.date), r)
        }
        await batch.commit()
      }
      console.log('[scheduledMgpiffBacktest] Done.', summary.totalDays, 'days processed')
    } catch (err) {
      console.error('[scheduledMgpiffBacktest] Error:', err)
    }
  }
)

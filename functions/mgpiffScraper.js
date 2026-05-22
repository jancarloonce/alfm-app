'use strict'

const fetch = require('node-fetch')

// uitf.com.ph JSON API — no browser needed
const UITF_JSON_URL = 'https://www.uitf.com.ph/daily_navpu_details_json.php'
const FUND_ID = 357 // MGPIFF PHP Unhedged Class A

const MONTH_MAP = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
}

/**
 * Convert "Jan 1, 2025" → "2025-01-01"
 */
function labelToDate(label) {
  const m = label.match(/(\w{3})\w*\s+(\d{1,2}),\s+(\d{4})/)
  if (!m) return null
  const mm = MONTH_MAP[m[1].toLowerCase()]
  return mm ? `${m[3]}-${mm}-${String(parseInt(m[2])).padStart(2, '0')}` : null
}

/**
 * Offset a YYYY-MM-DD date string by N days.
 */
function addDaysToDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Fetch raw data_point array from uitf.com.ph for a date range.
 * @returns {Promise<Array<{label: string, y: number}>>}
 */
async function fetchNavpuRange(fromDate, toDate) {
  const url = `${UITF_JSON_URL}?from=${fromDate}&to=${toDate}&bank_id=&fund_id=${FUND_ID}&verification_id=1&btn=Filter`
  console.log('[mgpiffScraper] Fetching:', url)

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.uitf.com.ph/',
    },
    signal: AbortSignal.timeout(20000),
  })

  if (!res.ok) throw new Error(`uitf.com.ph HTTP ${res.status}`)
  const data = await res.json()
  return Array.isArray(data?.data_point) ? data.data_point : []
}

/**
 * Scrape the latest MGPIFF NAVPU for a given target date.
 * Uses a 7-day lookback window so weekends/holidays return the last published value.
 *
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {Promise<{navpu: number|null, effectiveDate: string|null, source: string, error: string|null}>}
 */
async function scrapeMgpiffNavpu(dateStr) {
  try {
    const fromDate = addDaysToDate(dateStr, -7)
    const points = await fetchNavpuRange(fromDate, dateStr)

    if (!points.length) {
      return { navpu: null, effectiveDate: null, source: 'uitf.com.ph', error: 'No data in range' }
    }

    const latest = points[points.length - 1]
    const navpu = parseFloat(latest.y)
    const effectiveDate = labelToDate(latest.label)

    if (isNaN(navpu) || navpu < 40 || navpu > 70) {
      return { navpu: null, effectiveDate: null, source: 'uitf.com.ph', error: `NAVPU out of range: ${latest.y}` }
    }

    console.log(`[mgpiffScraper] NAVPU: ₱${navpu} | date: ${effectiveDate}`)
    return { navpu, effectiveDate, source: 'uitf.com.ph', error: null }

  } catch (err) {
    console.error('[mgpiffScraper] Error:', err.message)
    return { navpu: null, effectiveDate: null, source: 'uitf.com.ph', error: err.message }
  }
}

module.exports = { scrapeMgpiffNavpu, fetchNavpuRange, labelToDate }

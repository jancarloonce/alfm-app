'use strict'

const puppeteer = require('puppeteer-core')
const fetch = require('node-fetch')

let chromium
try {
  chromium = require('@sparticuz/chromium')
} catch (e) {
  chromium = null
}

// Affinity API — fund-specific endpoint, no browser needed
// Returns a single object with navpu + navDate directly
const AFFINITY_API_URL =
  'https://affinitycorp.net/api/funds/alfm_gmif_peso?query=' +
  encodeURIComponent(
    JSON.stringify({
      select: ['key', 'description', 'navpu', 'navDate', 'currency'],
    })
  )

const PRIMARY_URL = 'https://www.alfmmutualfunds.com/'
const FALLBACK_URL =
  'https://www.bpi.com.ph/group/bpiwealth/our-solutions/personal/investment-solutions/funds/alfm-global-multi-asset-income-fund-php'

// Regex to match NAVPU in the range of 44.xx to 55.xx
const NAVPU_REGEX = /(?:4[4-9]|5[0-5])\.\d{2}/g

/**
 * Extract NAVPU from page text.
 * @param {string} text
 * @returns {number|null}
 */
function extractNavpu(text) {
  const contextRegex =
    /(?:NAVPU|NAV(?:\s+per\s+unit)?)[:\s\-]*(?:PHP|₱)?\s*((?:4[4-9]|5[0-5])\.\d{2})/gi
  const ctxMatch = contextRegex.exec(text)
  if (ctxMatch) {
    const val = parseFloat(ctxMatch[1])
    if (val >= 44 && val <= 55) return val
  }

  const allMatches = []
  let m
  const re = new RegExp(NAVPU_REGEX.source, 'g')
  while ((m = re.exec(text)) !== null) {
    const val = parseFloat(m[0])
    if (val >= 44 && val <= 55) allMatches.push(val)
  }

  if (allMatches.length === 0) return null

  const inRange = allMatches.filter((v) => v >= 44 && v <= 55)
  if (inRange.length > 0) {
    const freq = {}
    inRange.forEach((v) => (freq[v] = (freq[v] || 0) + 1))
    return parseFloat(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0])
  }

  return allMatches[allMatches.length - 1]
}

/**
 * Extract effective date from page text.
 * Looks for patterns like "April 6, 2026", "Apr 6, 2026", "04/06/2026", "2026-04-06".
 * Returns a YYYY-MM-DD string or null.
 * @param {string} text
 * @returns {string|null}
 */
function extractEffectiveDate(text) {
  const months = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  }

  // "April 6, 2026" or "Apr 6, 2026"
  const longMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2}),?\s+(202\d)\b/gi
  )
  if (longMatch) {
    for (const m of longMatch) {
      const parts = m.match(
        /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2}),?\s+(202\d)/i
      )
      if (parts) {
        const mm = months[parts[1].toLowerCase()]
        const dd = String(parseInt(parts[2])).padStart(2, '0')
        const yyyy = parts[3]
        if (mm) return `${yyyy}-${mm}-${dd}`
      }
    }
  }

  // "2026-04-06"
  const isoMatch = text.match(/\b(202\d)-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/)
  if (isoMatch) return isoMatch[0]

  // "04/06/2026" (MM/DD/YYYY)
  const usMatch = text.match(/\b(0[1-9]|1[0-2])\/([0-2]\d|3[01])\/(202\d)\b/)
  if (usMatch) return `${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`

  return null
}

/**
 * Launch puppeteer with @sparticuz/chromium (for Cloud Functions) or local Chrome.
 */
async function launchBrowser() {
  if (chromium && process.platform === 'linux') {
    // Cloud Functions Linux environment
    const executablePath = await chromium.executablePath()
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    })
  }

  // Local fallback:find first existing Chrome/Chromium path
  const fs = require('fs')
  const localPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `C:\\Users\\${process.env.USERNAME || process.env.USER || ''}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]

  const executablePath = localPaths.find((p) => {
    try { return fs.existsSync(p) } catch { return false }
  })

  if (!executablePath) {
    throw new Error(
      'No Chrome/Chromium found locally. Install Google Chrome or set CHROME_PATH env var.'
    )
  }

  return puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath,
    headless: true,
    ignoreHTTPSErrors: true,
  })
}

/**
 * Scrape NAVPU from a given URL.
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} url
 * @returns {Promise<number|null>}
 */
async function scrapeFromUrl(browser, url) {
  const page = await browser.newPage()
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 3000))

    const pageText = await page.evaluate(() => {
      return document.body.innerText || document.body.textContent || ''
    })

    const navpu = extractNavpu(pageText)
    const effectiveDate = extractEffectiveDate(pageText)
    return { navpu, effectiveDate }
  } finally {
    await page.close().catch(() => {})
  }
}

/**
 * Fetch NAVPU from Affinity Corp JSON API (no browser needed).
 * @returns {Promise<{navpu: number|null, effectiveDate: string|null, source: string, error: string|null}>}
 */
async function scrapeFromAffinity() {
  try {
    console.log('[scraper] Trying Affinity API:', AFFINITY_API_URL)
    const res = await fetch(AFFINITY_API_URL, {
      headers: {
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 10000,
    })

    if (!res.ok) {
      return { navpu: null, effectiveDate: null, source: 'affinitycorp.net', error: `HTTP ${res.status}` }
    }

    const fund = await res.json()

    if (!fund || fund.key !== 'alfm_gmif_peso' || fund.currency !== 'PHP') {
      return { navpu: null, effectiveDate: null, source: 'affinitycorp.net', error: `Unexpected response: ${JSON.stringify(fund).slice(0, 100)}` }
    }

    const navpu = parseFloat(parseFloat(fund.navpu).toFixed(2))
    const effectiveDate = fund.navDate || null // already YYYY-MM-DD

    if (isNaN(navpu) || navpu < 44 || navpu > 55) {
      return { navpu: null, effectiveDate: null, source: 'affinitycorp.net', error: `NAVPU out of expected range: ${fund.navpu}` }
    }

    console.log('[scraper] Affinity API returned NAVPU:', navpu, 'date:', effectiveDate)
    return { navpu, effectiveDate, source: 'affinitycorp.net', error: null }
  } catch (err) {
    return { navpu: null, effectiveDate: null, source: 'affinitycorp.net', error: err.message }
  }
}

/**
 * Main scraper: tries Affinity API, then primary URL, then BPI fallback.
 * When expectedDate is provided, a result whose effectiveDate is older than
 * expectedDate is considered stale and the next source is tried instead.
 * Returns null on total failure (does not throw).
 *
 * @param {string} [expectedDate] - YYYY-MM-DD of the NAVPU we expect (last business day)
 * @returns {Promise<{navpu: number|null, effectiveDate: string|null, source: string|null, error: string|null}>}
 */
async function scrapeNavpu(expectedDate) {
  function isStale(effectiveDate) {
    return expectedDate && effectiveDate && effectiveDate < expectedDate
  }

  // Track the best (most recent) stale result across all sources
  let bestStale = null
  function trackStale(result) {
    if (!bestStale || (result.effectiveDate && (!bestStale.effectiveDate || result.effectiveDate > bestStale.effectiveDate))) {
      bestStale = result
    }
  }

  // Try Affinity API first — no browser needed, fastest
  const affinity = await scrapeFromAffinity()
  if (affinity.navpu !== null) {
    if (isStale(affinity.effectiveDate)) {
      console.log(`[scraper] Affinity API data is stale (got ${affinity.effectiveDate}, expected ${expectedDate}) — trying browser sources`)
      trackStale(affinity)
    } else {
      return affinity
    }
  } else {
    console.log('[scraper] Affinity API failed:', affinity.error, '— falling back to browser sources')
  }

  let browser = null
  try {
    browser = await launchBrowser()

    // Try primary source
    try {
      console.log('[scraper] Trying primary source:', PRIMARY_URL)
      const { navpu, effectiveDate } = await scrapeFromUrl(browser, PRIMARY_URL)
      if (navpu !== null) {
        console.log('[scraper] Primary source returned NAVPU:', navpu, 'date:', effectiveDate)
        if (isStale(effectiveDate)) {
          console.log(`[scraper] Primary source data is stale (got ${effectiveDate}, expected ${expectedDate}) — trying fallback`)
          trackStale({ navpu, effectiveDate, source: 'alfmmutualfunds.com', error: null })
        } else {
          return { navpu, effectiveDate, source: 'alfmmutualfunds.com', error: null }
        }
      } else {
        console.log('[scraper] Primary source returned null, trying fallback...')
      }
    } catch (primaryErr) {
      console.error('[scraper] Primary source error:', primaryErr.message)
    }

    // Try fallback source
    try {
      console.log('[scraper] Trying fallback source:', FALLBACK_URL)
      const { navpu, effectiveDate } = await scrapeFromUrl(browser, FALLBACK_URL)
      if (navpu !== null) {
        console.log('[scraper] Fallback source returned NAVPU:', navpu, 'date:', effectiveDate)
        if (isStale(effectiveDate)) {
          console.log(`[scraper] Fallback source data is also stale (got ${effectiveDate}, expected ${expectedDate})`)
          trackStale({ navpu, effectiveDate, source: 'bpi.com.ph', error: null })
        } else {
          return { navpu, effectiveDate, source: 'bpi.com.ph', error: null }
        }
      } else {
        console.log('[scraper] Fallback source also returned null.')
      }
    } catch (fallbackErr) {
      console.error('[scraper] Fallback source error:', fallbackErr.message)
    }

    // All sources exhausted — return the best stale result instead of failing
    if (bestStale) {
      console.log(`[scraper] Returning best stale result: ${bestStale.navpu} from ${bestStale.source} (${bestStale.effectiveDate}, expected ${expectedDate})`)
      return bestStale
    }

    return { navpu: null, effectiveDate: null, source: null, error: 'Could not extract NAVPU from any source' }
  } catch (err) {
    console.error('[scraper] Browser launch error:', err.message)
    if (bestStale) return bestStale
    return { navpu: null, effectiveDate: null, source: null, error: err.message }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}

module.exports = { scrapeNavpu, extractNavpu, launchBrowser }

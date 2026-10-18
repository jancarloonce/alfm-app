'use strict'

// ATRAM Nasdaq Equity Income Feeder Fund — NAVPU scraper placeholder.
// NAVPU source is TBD (not available on uitf.com.ph).
// For now, NAVPU must be entered manually via the daily check or seed functions.

async function scrapeAtramNavpu(dateStr) {
  console.log(`[atramScraper] No automated source configured. Manual entry required for ${dateStr}`)
  return {
    navpu: null,
    effectiveDate: null,
    source: 'manual',
    error: 'No automated NAVPU source configured — enter manually',
  }
}

module.exports = { scrapeAtramNavpu }

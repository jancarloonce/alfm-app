'use strict'

/**
 * MGPIFF Signal Engine wrapper.
 * Reuses analyzeSignal from signalEngine.js (same logic, fund-agnostic).
 * Overrides baseline thresholds for MGPIFF PHP Unhedged Class A (~₱50 NAVPU range).
 */

const { analyzeSignal, computeThresholds } = require('./signalEngine')

// MGPIFF PHP Unhedged Class A — baseline thresholds (~₱50 NAVPU range).
// Used only as drift-guard fallback when dynamic percentile thresholds stray.
// Once 90 days of MGPIFF NAVPU history exist, dynamic thresholds take over.
// Calibrated from actual PHP Unhedged Class A data (Jan 2025 – May 2026):
// range ₱48.86 – ₱55.29, mean ~₱52.50
// These approximate the 75th/60th/45th/30th percentiles of the full history.
const MGPIFF_BASELINE_THRESHOLDS = {
  noBuyThreshold:  53.80,
  watchThreshold:  53.20,
  buyThreshold:    52.50,
  buyMoreThreshold:51.50,
}

// Default initial thresholds when < 5 data points exist (day 1 bootstrap).
// Mirrors MGPIFF_BASELINE_THRESHOLDS with required metadata fields.
const MGPIFF_INITIAL_THRESHOLDS = {
  ...MGPIFF_BASELINE_THRESHOLDS,
  usingBaseline: true,
  periodHigh: 55.29,
  periodLow:  48.86,
  mean:       52.50,
  dataPoints: 0,
  computedAt: new Date().toISOString(),
}

function computeMgpiffThresholds(navpuValues) {
  // maxDrift=3.0: MGPIFF has a wide NAVPU range (~₱6 spread), so the 30th percentile
  // can sit well below the mean without it being a data problem. The drift guard
  // must not override valid percentile thresholds due to normal range width.
  return computeThresholds(navpuValues, MGPIFF_BASELINE_THRESHOLDS, 3.0) || MGPIFF_INITIAL_THRESHOLDS
}

module.exports = {
  analyzeSignal,
  computeMgpiffThresholds,
  MGPIFF_BASELINE_THRESHOLDS,
  MGPIFF_INITIAL_THRESHOLDS,
}

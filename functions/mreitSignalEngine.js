'use strict'

const { analyzeSignal, computeThresholds } = require('./signalEngine')

// Manulife Global REIT Feeder Fund PhP-Unhedged Class A — baseline thresholds (~₱51 NAVPU range).
// Calibrated from initial PHP Unhedged Class A data (Aug 2026):
// NAVPU ~₱51, expected range ₱48–₱54
const MREIT_BASELINE_THRESHOLDS = {
  noBuyThreshold:  52.00,
  watchThreshold:  51.50,
  buyThreshold:    51.00,
  buyMoreThreshold:50.50,
}

const MREIT_INITIAL_THRESHOLDS = {
  ...MREIT_BASELINE_THRESHOLDS,
  usingBaseline: true,
  periodHigh: 52.00,
  periodLow:  50.00,
  mean:       51.00,
  dataPoints: 0,
  computedAt: new Date().toISOString(),
}

function computeMreitThresholds(navpuValues) {
  return computeThresholds(navpuValues, MREIT_BASELINE_THRESHOLDS, 3.0) || MREIT_INITIAL_THRESHOLDS
}

module.exports = {
  analyzeSignal,
  computeMreitThresholds,
  MREIT_BASELINE_THRESHOLDS,
  MREIT_INITIAL_THRESHOLDS,
}

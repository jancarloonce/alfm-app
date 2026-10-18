'use strict'

const { analyzeSignal, computeThresholds } = require('./signalEngine')

// ATRAM Nasdaq Equity Income Feeder Fund — baseline thresholds (~₱108 NAVPU range).
// Calibrated from initial DragonFi data (Oct 2026):
// NAVPU ~₱108, expected range ₱100–₱115
const ATRAM_BASELINE_THRESHOLDS = {
  noBuyThreshold:  110.00,
  watchThreshold:  109.00,
  buyThreshold:    108.00,
  buyMoreThreshold:107.00,
}

const ATRAM_INITIAL_THRESHOLDS = {
  ...ATRAM_BASELINE_THRESHOLDS,
  usingBaseline: true,
  periodHigh: 112.00,
  periodLow:  104.00,
  mean:       108.00,
  dataPoints: 0,
  computedAt: new Date().toISOString(),
}

function computeAtramThresholds(navpuValues) {
  return computeThresholds(navpuValues, ATRAM_BASELINE_THRESHOLDS, 3.0) || ATRAM_INITIAL_THRESHOLDS
}

module.exports = {
  analyzeSignal,
  computeAtramThresholds,
  ATRAM_BASELINE_THRESHOLDS,
  ATRAM_INITIAL_THRESHOLDS,
}

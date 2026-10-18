'use strict'

const { analyzeSignal, computeThresholds } = require('./signalEngine')

// BPI Global Bond Income Fund PHP Class — baseline thresholds (~₱110 NAVPU range).
// Calibrated from recent PHP Class data (May–Jun 2026):
// range ₱109.93 – ₱111.84, mean ~₱111.00
const BPIBOND_BASELINE_THRESHOLDS = {
  noBuyThreshold:  111.50,
  watchThreshold:  111.00,
  buyThreshold:    110.50,
  buyMoreThreshold:110.00,
}

const BPIBOND_INITIAL_THRESHOLDS = {
  ...BPIBOND_BASELINE_THRESHOLDS,
  usingBaseline: true,
  periodHigh: 111.84,
  periodLow:  109.93,
  mean:       111.00,
  dataPoints: 0,
  computedAt: new Date().toISOString(),
}

function computeBpibondThresholds(navpuValues) {
  return computeThresholds(navpuValues, BPIBOND_BASELINE_THRESHOLDS, 3.0) || BPIBOND_INITIAL_THRESHOLDS
}

module.exports = {
  analyzeSignal,
  computeBpibondThresholds,
  BPIBOND_BASELINE_THRESHOLDS,
  BPIBOND_INITIAL_THRESHOLDS,
}

'use strict';

/**
 * Post-inference calibration layer
 * Corrects LOC bias without touching the ML model
 */
function calibrateRisk(mlResult) {
  const features = mlResult.features || {};

  const loc         = features.loc         || 0;
  const cc          = features['v(g)']     || 0;
  const halstead    = features.v           || 0;
  const branchCount = features.branchcount || 0;
  const ev          = features['ev(g)']    || 0;

  let { risk_level, bug_probability } = mlResult;
  let calibrated       = false;
  let calibration_note = null;

  // ── Rule 1: Large but simple file ───────────
  const cc_density     = cc / Math.max(loc, 1);
  const hv_density     = halstead / Math.max(loc, 1);

  if (
    risk_level === 'High' &&
    loc > 400 &&
    cc_density < 0.05 &&
    hv_density < 2.0
  ) {
    bug_probability  = bug_probability * 0.75;
    calibrated       = true;
    calibration_note = 'LOC bias corrected: large but structurally simple file';
  }

  // ── Rule 2: Very low branch density ─────────
  const branch_density = branchCount / Math.max(loc, 1);
  if (
    risk_level === 'High' &&
    bug_probability > 0.7 &&
    branch_density < 0.03
  ) {
    bug_probability  = bug_probability * 0.80;
    calibrated       = true;
    calibration_note = 'Branch density correction applied';
  }

  // ── Rule 3: Small optimized file ────────────
  // Small file + low CC + low branches = not risky
  if (
    risk_level === 'High' &&
    loc < 150 &&
    cc < 10 &&
    branchCount < 8
  ) {
    bug_probability  = bug_probability * 0.60;
    calibrated       = true;
    calibration_note = 'Small optimized file: LOC bias corrected';
  }

  // ── Rule 4: Very low CC density (optimized code) ──
  if (
    risk_level === 'High' &&
    cc_density < 0.08 &&
    loc < 200 &&
    ev < 5
  ) {
    bug_probability  = bug_probability * 0.65;
    calibrated       = true;
    calibration_note = 'Low CC density: optimized code pattern detected';
  }

  // ── Recalculate risk level ───────────────────
  if (calibrated) {
    risk_level = bug_probability >= 0.5 ? 'High' : 'Low';
  }

  return {
    ...mlResult,
    risk_level,
    bug_probability: parseFloat(bug_probability.toFixed(4)),
    calibration: {
      applied             : calibrated,
      note                : calibration_note,
      original_probability: mlResult.bug_probability,
      original_risk_level : mlResult.risk_level,
    }
  };
}

module.exports = { calibrateRisk };

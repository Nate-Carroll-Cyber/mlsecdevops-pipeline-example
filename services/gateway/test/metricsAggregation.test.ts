/**
 * Unit coverage for the analytics modules that moved to backend/src/analysis/
 * in Phase 3 step 3: detectThreatSpikes (Z-score-style hourly threat anomaly
 * detection) and calculateFalsePositiveMetrics (FPR/FNR confusion-matrix over
 * reviewed audit logs). Route-level coverage of /v1/metrics/aggregate lives in
 * securityRoutes.test.ts; this file is pure-function coverage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectThreatSpikes, type ThreatLog } from '../src/analysis/anomalyDetector.ts';
import { calculateFalsePositiveMetrics, type AuditLogMetrics } from '../src/analysis/metrics.ts';

// --- detectThreatSpikes --------------------------------------------------

test('detectThreatSpikes reports no anomaly for a quiet 24h window', () => {
  const now = Date.now();
  const logs: ThreatLog[] = Array.from({ length: 6 }, (_, i) => ({
    userId: `u-${i % 2}`,
    detectionLevel: 2,
    // Spread across the last 24h (one log every 4 hours).
    timestamp: new Date(now - i * 4 * 60 * 60 * 1000),
  }));
  const result = detectThreatSpikes(logs);

  // Six logs / 24 baseline = 0.25 expected per hour. Even if all current-hour
  // logs land in the last hour the count is bounded by the >5-event noise gate.
  assert.equal(result.isAnomaly, false);
  assert.equal(typeof result.spikeRatio, 'number');
  assert.equal(result.baselineHourlyRate, 6 / 24);
});

test('detectThreatSpikes flags a >=5x spike concentrated in the last hour', () => {
  const now = Date.now();
  // 24-hour baseline: 12 logs spread across the day, plus 8 logs piled into the
  // last hour (well above the 5-event noise gate).
  const background: ThreatLog[] = Array.from({ length: 12 }, (_, i) => ({
    userId: `bg-${i}`,
    detectionLevel: 2,
    timestamp: new Date(now - (2 + i) * 60 * 60 * 1000),
  }));
  const lastHourAttacker = 'attacker-zed';
  const lastHourLogs: ThreatLog[] = Array.from({ length: 8 }, (_, i) => ({
    userId: lastHourAttacker,
    detectionLevel: 3,
    timestamp: new Date(now - (i * 5) * 60 * 1000),
  }));
  const result = detectThreatSpikes([...background, ...lastHourLogs]);

  assert.equal(result.isAnomaly, true);
  assert.ok(result.spikeRatio >= 5);
  assert.equal(result.currentHourlyRate, 8);
  assert.equal(result.topAttackerId, lastHourAttacker);
});

test('detectThreatSpikes does not divide by zero when the baseline is empty', () => {
  const result = detectThreatSpikes([]);
  // Empty input means safeBaseline = 1; spike ratio is 0/1 = 0; no anomaly.
  assert.equal(result.isAnomaly, false);
  assert.equal(result.spikeRatio, 0);
  assert.equal(result.currentHourlyRate, 0);
  assert.equal(result.baselineHourlyRate, 0);
  assert.equal(result.topAttackerId, null);
});

// --- calculateFalsePositiveMetrics ----------------------------------------

test('calculateFalsePositiveMetrics returns zeros when no logs have been reviewed', () => {
  const logs: AuditLogMetrics[] = [
    { id: '1', detectionLevel: 3, reviewed: false },
    { id: '2', detectionLevel: 0, reviewed: false },
  ];
  const result = calculateFalsePositiveMetrics(logs);

  // Reviewed = ground truth; with no reviews the confusion matrix is empty.
  assert.equal(result.totalReviewed, 0);
  assert.equal(result.falsePositivesCount, 0);
  assert.equal(result.falseNegativesCount, 0);
  assert.equal(result.truePositivesCount, 0);
  assert.equal(result.strictFPR, '0.0');
  assert.equal(result.falseNegativeRate, '0.0');
});

test('calculateFalsePositiveMetrics partitions reviewed logs into TP/TN/FP/FN', () => {
  const logs: AuditLogMetrics[] = [
    // System blocked (>=2), analyst confirmed threat -> TP.
    { id: 'tp', detectionLevel: 3, resultantSeverity: 'Adversarial', reviewed: true },
    // System allowed (<2), analyst said clean -> TN.
    { id: 'tn', detectionLevel: 0, resultantSeverity: 'Clean', reviewed: true },
    // System blocked (>=2), analyst said clean -> FP.
    { id: 'fp', detectionLevel: 2, resultantSeverity: 'Clean', reviewed: true },
    // System allowed (<2), analyst said adversarial -> FN.
    { id: 'fn', detectionLevel: 1, resultantSeverity: 'Adversarial', reviewed: true },
    // Unreviewed -> excluded.
    { id: 'skip', detectionLevel: 3, reviewed: false },
  ];
  const result = calculateFalsePositiveMetrics(logs);

  assert.equal(result.totalReviewed, 4);
  assert.equal(result.truePositivesCount, 1);
  assert.equal(result.falsePositivesCount, 1);
  assert.equal(result.falseNegativesCount, 1);
  // strictFPR = FP / (FP + TN) = 1 / 2 = 50.0%
  assert.equal(result.strictFPR, '50.0');
  // falseNegativeRate = FN / (FN + TP) = 1 / 2 = 50.0%
  assert.equal(result.falseNegativeRate, '50.0');
});

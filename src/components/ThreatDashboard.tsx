/**
 * Metrics dashboard.
 * Aggregates audit-log activity into threat-rate, obfuscation, and governance
 * views, including source-level filtering for Sam Spade `ctf_chat` traffic.
 */
// Import React and necessary hooks
import React, { useEffect, useState } from 'react';
// Import UI components from shadcn/ui
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { HelpTooltip } from './HelpTooltip';
// Phase 3 step 3: audit-log reads + anomaly/FPR analytics flow through the
// backend (Postgres-backed listAuditLogs + /v1/metrics/aggregate). The
// anomalyDetector + metrics modules moved to services/gateway/src/analysis/.
// Phase 3 step 4: governance config (HITL/Global Pause/threshold sliders) also
// moved to Postgres via /v1/governance, replacing the previous Firestore
// onSnapshot listener with a parent-driven prop + putGovernanceConfig writes.
import { aggregateMetrics, listAuditLogs, putGovernanceConfig } from '../lib/backendApi';
import { devWarn } from '../lib/devLog';
import { ATLAS_TACTICS, ATLAS_TECHNIQUE_DEFINITIONS } from '../lib/atlasTaxonomy';
import { SUSPICIOUS_ENTROPY_THRESHOLD } from '../lib/analysisTypes';
import { getFeaturePressure, getTopPressureDriver } from '../lib/playgroundMetrics';
// Import icons from Lucide React
import { AlertTriangle, Activity, UserCheck, ShieldX, PauseOctagon, PlayCircle } from 'lucide-react';
// Import charting components from Recharts
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

interface ThreatDashboardProps {
  localReviewMode?: boolean;
  localAuditLogs?: any[];
  governanceConfig?: {
    isHitlActive: boolean;
    isGlobalPause: boolean;
    entropyThreshold: number;
    syntacticThreshold: number;
  };
  onGovernanceConfigChange?: (config: {
    isHitlActive: boolean;
    isGlobalPause: boolean;
    entropyThreshold: number;
    syntacticThreshold: number;
  }) => void;
}

const emptyHourlyData = Array(24).fill(0).map((_, hour) => ({ hour, threats: 0 }));
const emptySeverityHourlyData = Array(24).fill(0).map((_, hour) => ({
  hour,
  adversarial: 0,
  review: 0,
  policyViolation: 0,
  suspicious: 0,
  informational: 0,
  clean: 0,
}));
const PII_DETECTION_FLAGS = ['EMAIL', 'PHONE', 'ADDRESS', 'ZIPCODE', 'MAC_ADDRESS', 'IP_ADDRESS', 'CREDIT_CARD', 'SSN'];
const SECRET_DETECTION_FLAGS = ['AWS_KEY', 'LLM_API_KEY', 'PRIVATE_KEY', 'API_KEY', 'JWT', 'CANARY_TOKEN', 'CANARY_EXFIL', 'SECRET_KEY'];
const DIRECT_OBFUSCATION_FLAGS = ['URL_ENCODING', 'HTML_ENTITIES', 'UNICODE_ESCAPES', 'COMPATIBILITY_GLYPHS', 'SYMBOL_SUBSTITUTION', 'LEETSPEAK', 'ROT13', 'REVERSE_TEXT', 'NATO_PHONETIC', 'MORSE_CODE', 'BRAILLE', 'REGIONAL_INDICATORS', 'RECURSIVE_DECODE'];
const STRUCTURAL_OBFUSCATION_FLAGS = ['END_SEQUENCE', 'CHUNKING', 'VARIABLE_EXPANSION', 'VERTICAL_TEXT'];
const RESPONDER_INTERVENTION_FLAGS = ['RESPONDER_BLOCK', 'RESPONDER_REFUSAL', 'RESPONDER_QUEUE_FOR_REVIEW', 'RESPONDER_FAIL_SECURE'];
type SeverityBucket = 'adversarial' | 'review' | 'policyViolation' | 'suspicious' | 'informational' | 'clean';
type SeverityCounts = Record<SeverityBucket, number>;
const SEVERITY_LEGEND_ITEMS = [
  { value: 'Adversarial', type: 'square' as const, id: 'adversarial', color: '#ef4444' },
  { value: 'Review', type: 'square' as const, id: 'review', color: '#8b5cf6' },
  { value: 'Policy Violation', type: 'square' as const, id: 'policyViolation', color: '#f97316' },
  { value: 'Suspicious', type: 'square' as const, id: 'suspicious', color: '#f59e0b' },
  { value: 'Informational', type: 'square' as const, id: 'informational', color: '#38bdf8' },
  { value: 'Clean', type: 'square' as const, id: 'clean', color: '#22c55e' },
];

function SeverityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-300">
      {SEVERITY_LEGEND_ITEMS.map((item) => (
        <div key={item.id} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function hasAnySignal(log: any, signalSet: string[]): boolean {
  const detectionFlags = Array.isArray(log.detectionFlags) ? log.detectionFlags : [];
  const obfuscationTechniques = getObfuscationTechniques(log);
  return detectionFlags.some((flag: string) => signalSet.includes(flag)) || obfuscationTechniques.some((flag: string) => signalSet.includes(flag));
}

// Prefer the persisted summary when it exists; fall back to raw detection flags for
// older records so historical audit data still renders correctly.
function getObfuscationTechniques(log: any): string[] {
  if (log.obfuscationSummary?.hasObfuscation) {
    return Array.isArray(log.obfuscationSummary.techniques) ? log.obfuscationSummary.techniques : [];
  }
  if (!Array.isArray(log.detectionFlags)) return [];
  return log.detectionFlags.filter((flag: string) =>
    DIRECT_OBFUSCATION_FLAGS.includes(flag) || STRUCTURAL_OBFUSCATION_FLAGS.includes(flag) || flag === 'OBFUSCATED_INSTRUCTION'
  );
}

// Small helper used by the MITRE heat map to turn volume into visual intensity.
function getHeatColor(count: number, maxCount: number): string {
  if (maxCount === 0 || count === 0) return 'bg-slate-950/70 border-slate-800 text-slate-500';
  const intensity = count / maxCount;
  if (intensity >= 0.8) return 'bg-rose-600/30 border-rose-500/50 text-rose-100';
  if (intensity >= 0.5) return 'bg-amber-500/20 border-amber-500/40 text-amber-100';
  if (intensity >= 0.25) return 'bg-cyan-500/15 border-cyan-500/30 text-cyan-100';
  return 'bg-slate-900 border-slate-700 text-slate-200';
}

function getEffectiveDetectionLevel(log: any, entropyThreshold?: number): number {
  const baseLevel = Number(log.detectionLevel || 0);
  const entropy = Number(log.entropy || 0);
  if (typeof entropyThreshold === 'number' && Number.isFinite(entropy)) {
    if (entropy > entropyThreshold) {
      return Math.max(baseLevel, 3);
    }
    if (entropy > SUSPICIOUS_ENTROPY_THRESHOLD) {
      return Math.max(baseLevel, 2);
    }
  }
  return baseLevel;
}

function getSeverityBucket(log: any, entropyThreshold?: number): SeverityBucket {
  const detectionFlags = Array.isArray(log.detectionFlags) ? log.detectionFlags : [];
  const upperResponse = typeof log.response === 'string' ? log.response.toUpperCase() : '';
  const reviewedSeverity = log.reviewed === true && typeof log.resultantSeverity === 'string'
    ? log.resultantSeverity
    : undefined;
  const effectiveDetectionLevel = getEffectiveDetectionLevel(log, entropyThreshold);

  if (reviewedSeverity === 'Adversarial') return 'adversarial';
  if (reviewedSeverity === 'Suspicious') return 'suspicious';
  if (reviewedSeverity === 'Informational') return 'informational';
  if (reviewedSeverity === 'Clean') return 'clean';

  if (hasAdversarialSimilarityReference(log)) return log.instructionSimilarity?.highestRisk === 'high' ? 'adversarial' : 'review';
  if (log.status === 'PENDING_REVIEW' || detectionFlags.includes('RESPONDER_QUEUE_FOR_REVIEW') || getBackendGatewayStatus(log) === 'QUEUED') {
    return 'review';
  }
  if (
    effectiveDetectionLevel >= 3 ||
    getBackendSafeguardVerdict(log) === 'ADVERSARIAL' ||
    detectionFlags.includes('RESPONDER_BLOCK') ||
    detectionFlags.includes('RESPONDER_REFUSAL')
  ) {
    return 'adversarial';
  }
  if (
    detectionFlags.includes('POLICY_VIOLATION') ||
    detectionFlags.includes('BLOCKED_KEYWORD') ||
    detectionFlags.includes('FORBIDDEN_TOPIC') ||
    detectionFlags.includes('FORBIDDEN_PHRASE') ||
    detectionFlags.includes('REGEX_MATCH') ||
    hasBackendSafeguardIntervention(log) ||
    upperResponse.startsWith('POLICY VIOLATION DETECTED')
  ) {
    return 'policyViolation';
  }
  if (effectiveDetectionLevel === 2) {
    return 'suspicious';
  }
  if (effectiveDetectionLevel === 1) {
    return 'informational';
  }
  return 'clean';
}

function getMetricsSeverityBucket(log: any, entropyThreshold?: number): SeverityBucket {
  const bucket = getSeverityBucket(log, entropyThreshold);
  return bucket === 'suspicious' ? 'review' : bucket;
}

function isPendingReviewMetric(log: any, entropyThreshold?: number): boolean {
  return log.reviewed !== true && getMetricsSeverityBucket(log, entropyThreshold) === 'review';
}

function getPendingAgeHours(log: any): number {
  const stamp = normalizeLogTimestamp(log.timestamp);
  return (Date.now() - stamp.getTime()) / (1000 * 60 * 60);
}

function getAutomatedSeverityBucket(log: any, entropyThreshold?: number): SeverityBucket {
  const detectionFlags = Array.isArray(log.detectionFlags) ? log.detectionFlags : [];
  const upperResponse = typeof log.response === 'string' ? log.response.toUpperCase() : '';
  const effectiveDetectionLevel = getEffectiveDetectionLevel(log, entropyThreshold);

  if (hasAdversarialSimilarityReference(log)) return log.instructionSimilarity?.highestRisk === 'high' ? 'adversarial' : 'review';
  if (log.status === 'PENDING_REVIEW' || detectionFlags.includes('RESPONDER_QUEUE_FOR_REVIEW') || getBackendGatewayStatus(log) === 'QUEUED') {
    return 'review';
  }
  if (
    effectiveDetectionLevel >= 3 ||
    getBackendSafeguardVerdict(log) === 'ADVERSARIAL' ||
    detectionFlags.includes('RESPONDER_BLOCK') ||
    detectionFlags.includes('RESPONDER_REFUSAL')
  ) {
    return 'adversarial';
  }
  if (
    detectionFlags.includes('POLICY_VIOLATION') ||
    detectionFlags.includes('BLOCKED_KEYWORD') ||
    detectionFlags.includes('FORBIDDEN_TOPIC') ||
    detectionFlags.includes('FORBIDDEN_PHRASE') ||
    detectionFlags.includes('REGEX_MATCH') ||
    hasBackendSafeguardIntervention(log) ||
    upperResponse.startsWith('POLICY VIOLATION DETECTED')
  ) {
    return 'policyViolation';
  }
  if (effectiveDetectionLevel === 2) {
    return 'suspicious';
  }
  if (effectiveDetectionLevel === 1) {
    return 'informational';
  }
  return 'clean';
}

function getBackendGatewayStatus(log: any): string | undefined {
  return typeof log.backendGatewayStatus === 'string' ? log.backendGatewayStatus : undefined;
}

function getBackendSafeguardVerdict(log: any): string | undefined {
  if (typeof log.backendSafeguardVerdict === 'string') return log.backendSafeguardVerdict;
  if (typeof log.judgeDecision === 'string') return log.judgeDecision;
  return undefined;
}

function reachedBackendSafeguard(log: any): boolean {
  if (log.backendReachedSafeguard === true) return true;
  if (log.backendReachedSafeguard === false) return false;
  const gatewayStatus = getBackendGatewayStatus(log);
  const safeguardLatencyMs = Number(log.backendSafeguardLatencyMs ?? log.safeguardLatencyMs ?? 0);
  if ((gatewayStatus === 'INTERCEPTED' || gatewayStatus === 'QUEUED') && safeguardLatencyMs <= 0) return false;
  if (getBackendGatewayStatus(log)) return true;
  if (getBackendSafeguardVerdict(log)) return true;
  if (typeof log.responderStatus === 'string' && log.responderStatus.trim()) return true;
  return typeof log.response === 'string' && log.response.startsWith('Backend intercepted the prompt:');
}

function hasBackendSafeguardIntervention(log: any): boolean {
  const gatewayStatus = getBackendGatewayStatus(log);
  const verdict = getBackendSafeguardVerdict(log);
  if (gatewayStatus === 'INTERCEPTED' || gatewayStatus === 'QUEUED') return true;
  if (verdict === 'SUSPICIOUS' || verdict === 'ADVERSARIAL') return true;
  return typeof log.response === 'string' && log.response.startsWith('Backend intercepted the prompt:');
}

function normalizeLogTimestamp(value: any): Date {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function mergeLocalAuditLogOverlays(remoteLogs: any[], localLogs: any[], cutoffDate: Date): any[] {
  const logsById = new Map<string, any>();
  remoteLogs.forEach((log) => {
    if (!log?.id) return;
    logsById.set(log.id, { ...log, timestamp: normalizeLogTimestamp(log.timestamp) });
  });
  localLogs.forEach((log) => {
    if (!log?.id) return;
    const timestamp = normalizeLogTimestamp(log.timestamp);
    if (timestamp < cutoffDate) return;
    const existing = logsById.get(log.id);
    logsById.set(log.id, {
      ...(existing ?? {}),
      ...log,
      timestamp,
    });
  });
  return Array.from(logsById.values());
}

function hasResponderIntervention(log: any): boolean {
  const detectionFlags = Array.isArray(log.detectionFlags) ? log.detectionFlags : [];
  return detectionFlags.some((flag: string) => RESPONDER_INTERVENTION_FLAGS.includes(flag));
}

function hasCurrentEntropyThresholdHit(log: any, entropyThreshold: number): boolean {
  const entropy = Number(log.entropy || 0);
  return Number.isFinite(entropy) && entropy > entropyThreshold;
}

function hasPolicyViolationSignal(flags: string[] = []): boolean {
  return flags.includes('POLICY_VIOLATION') ||
    flags.includes('BLOCKED_KEYWORD') ||
    flags.includes('FORBIDDEN_TOPIC') ||
    flags.includes('FORBIDDEN_PHRASE') ||
    flags.includes('REGEX_MATCH');
}

function getDetectionFlags(log: any): string[] {
  return Array.isArray(log.detectionFlags) ? log.detectionFlags : [];
}

function hasKeywordSignal(log: any): boolean {
  return getDetectionFlags(log).some((flag: string) => flag === 'BLOCKED_KEYWORD' || flag.startsWith('BLOCKED_KEYWORD:'));
}

function hasForbiddenPhraseSignal(log: any): boolean {
  const detectionFlags = getDetectionFlags(log);
  return detectionFlags.includes('FORBIDDEN_TOPIC') || detectionFlags.includes('FORBIDDEN_PHRASE');
}

function hasPolicySemanticSignal(log: any): boolean {
  const detectionFlags = getDetectionFlags(log);
  return detectionFlags.includes('POLICY_BYPASS_QUERY') || detectionFlags.includes('CUSTOM_CIPHER_INSTRUCTION');
}

function hasAnyObfuscationSignal(log: any): boolean {
  return getObfuscationTechniques(log).length > 0;
}

function hasInstructionSimilaritySignal(log: any): boolean {
  return getDetectionFlags(log).includes('INSTRUCTION_SIMILARITY_MATCH') || Boolean(log.instructionSimilarity);
}

function hasSemanticSimilaritySignal(log: any): boolean {
  const topMatch = log.instructionSimilarity?.topMatch;
  return hasInstructionSimilaritySignal(log) && Boolean(
    topMatch?.matchReasons?.some((reason: string) => reason === 'embedding' || reason === 'chunk_embedding' || reason === 'attention_pool' || reason === 'sandwich_delta') ||
    typeof topMatch?.cosineSimilarity === 'number' ||
    typeof topMatch?.maxChunkSimilarity === 'number' ||
    typeof topMatch?.attentionPooledChunkSimilarity === 'number'
  );
}

function hasAdversarialSimilarityReference(log: any): boolean {
  const highestRisk = log.instructionSimilarity?.highestRisk;
  const targetVerdict = log.instructionSimilarity?.topMatch?.targetVerdict;
  return (highestRisk === 'medium' || highestRisk === 'high') && targetVerdict === 'ADVERSARIAL';
}

function calculateDetectionSignalMetrics(logs: any[]) {
  return {
    piiHits: logs.filter((log) => hasAnySignal(log, PII_DETECTION_FLAGS)).length,
    secretHits: logs.filter((log) => hasAnySignal(log, SECRET_DETECTION_FLAGS)).length,
    regexHits: logs.filter((log) => getDetectionFlags(log).includes('REGEX_MATCH')).length,
    keywordHits: logs.filter(hasKeywordSignal).length,
    topicHits: logs.filter(hasForbiddenPhraseSignal).length,
    policySemanticHits: logs.filter(hasPolicySemanticSignal).length,
    obfuscatedHits: logs.filter(hasAnyObfuscationSignal).length,
    instructionSimilarityHits: logs.filter(hasInstructionSimilaritySignal).length,
    semanticSimilarityHits: logs.filter(hasSemanticSimilaritySignal).length,
    languageRecoveryHits: logs.filter((log) => getDetectionFlags(log).includes('FOREIGN_LANGUAGE') || getDetectionFlags(log).includes('MIXED_LANGUAGE')).length,
    spellingObfuscationHits: logs.filter((log) => getDetectionFlags(log).includes('SPELLING_OBFUSCATION')).length,
  };
}

function calculateObfuscationSignalMetrics(logs: any[]) {
  return {
    urlEncodingHits: logs.filter((log) => getObfuscationTechniques(log).includes('URL_ENCODING')).length,
    htmlEntityHits: logs.filter((log) => getObfuscationTechniques(log).includes('HTML_ENTITIES')).length,
    leetspeakHits: logs.filter((log) => getObfuscationTechniques(log).includes('LEETSPEAK')).length,
    rot13Hits: logs.filter((log) => getObfuscationTechniques(log).includes('ROT13')).length,
    reverseTextHits: logs.filter((log) => getObfuscationTechniques(log).includes('REVERSE_TEXT')).length,
    natoHits: logs.filter((log) => getObfuscationTechniques(log).includes('NATO_PHONETIC')).length,
    morseHits: logs.filter((log) => getObfuscationTechniques(log).includes('MORSE_CODE')).length,
    recursiveDecodeHits: logs.filter((log) => getObfuscationTechniques(log).includes('RECURSIVE_DECODE')).length,
    structuralHits: logs.filter((log) =>
      getDetectionFlags(log).some((flag: string) => STRUCTURAL_OBFUSCATION_FLAGS.includes(flag))
    ).length,
  };
}

function calculateFeaturePressureMetrics(logs: any[]) {
  const featureLogs = logs.filter((log) => typeof getFeaturePressure(log) === 'number' && log.featureVector);
  const researchSignalTotal = featureLogs.reduce((sum, log) => sum + Number(getFeaturePressure(log) || 0), 0);
  const averagePressure = (selector: (log: any) => number | undefined) => {
    if (featureLogs.length === 0) return 0;
    const total = featureLogs.reduce((sum, log) => sum + Number(selector(log) || 0), 0);
    return parseFloat(((total / featureLogs.length) * 100).toFixed(1));
  };
  const driverCounts = featureLogs.reduce<Record<string, number>>((counts, log) => {
    const driver = getTopPressureDriver(log);
    if (!driver || driver === 'None') return counts;
    counts[driver] = (counts[driver] ?? 0) + 1;
    return counts;
  }, {});

  return {
    featureSampleCount: featureLogs.length,
    totalPromptCount: logs.length,
    averageResearchSignal: featureLogs.length > 0
      ? parseFloat((researchSignalTotal / featureLogs.length).toFixed(1))
      : 0,
    averageInstructionPressure: averagePressure((log) => log.featureVector?.syntactic?.normalized?.instructionPressure),
    averageConstraintDensityPressure: averagePressure((log) => log.featureVector?.syntactic?.normalized?.constraintDensity),
    averageSyntaxWrapperPressure: averagePressure((log) => log.featureVector?.syntactic?.normalized?.syntaxWrapperPressure),
    averageObfuscationPressure: averagePressure((log) => log.featureVector?.syntactic?.normalized?.obfuscationPressure),
    averageEntropyPressure: averagePressure((log) => log.featureVector?.entropy?.normalizedPressure),
    averageNgramObfuscationSignal: averagePressure((log) => log.featureVector?.languageLikelihood?.normalizedSuspicion),
    highResearchSignalCount: featureLogs.filter((log) => Number(getFeaturePressure(log) || 0) >= 70).length,
    topResearchDriver: Object.entries(driverCounts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'None',
    lowNgramLikelihoodCount: featureLogs.filter((log) => log.featureVector?.languageLikelihood?.lowNaturalLanguageLikelihood).length,
    obfuscationHeavyCount: featureLogs.filter((log) => Number(log.featureVector?.syntactic?.raw?.obfuscationBonus || 0) > 0).length,
    instructionDenseCount: featureLogs.filter((log) => Number(log.featureVector?.syntactic?.normalized?.instructionPressure || 0) >= 0.7).length,
  };
}

function wasOriginallyReleased(log: any, entropyThreshold?: number): boolean {
  const automatedSeverity = getAutomatedSeverityBucket(log, entropyThreshold);
  return automatedSeverity === 'clean' || automatedSeverity === 'informational';
}

function wasPreInferenceBlocked(log: any, entropyThreshold?: number): boolean {
  if (reachedBackendSafeguard(log)) return false;
  if (hasResponderIntervention(log)) return false;
  if (log.status === 'PENDING_REVIEW') return true;
  if (hasPolicyViolationSignal(Array.isArray(log.detectionFlags) ? log.detectionFlags : [])) return true;
  return getEffectiveDetectionLevel(log, entropyThreshold) >= 2;
}

function isLikelyMaliciousPrompt(log: any, entropyThreshold?: number): boolean {
  if (typeof log.expectedVerdict === 'string') {
    return log.expectedVerdict === 'Suspicious' || log.expectedVerdict === 'Adversarial';
  }
  if (log.reviewed === true && typeof log.resultantSeverity === 'string') {
    return log.resultantSeverity === 'Suspicious' || log.resultantSeverity === 'Adversarial';
  }
  return (
    wasPreInferenceBlocked(log, entropyThreshold) ||
    hasBackendSafeguardIntervention(log) ||
    hasResponderIntervention(log) ||
    getSeverityBucket(log, entropyThreshold) === 'policyViolation' ||
    getSeverityBucket(log, entropyThreshold) === 'adversarial' ||
    getSeverityBucket(log, entropyThreshold) === 'review' ||
    getSeverityBucket(log, entropyThreshold) === 'suspicious'
  );
}

function calculateLayerMetrics(logs: any[], entropyThreshold?: number) {
  const totalLogs = logs.length;
  const preInferenceBlockedCount = logs.filter((log) => wasPreInferenceBlocked(log, entropyThreshold)).length;
  const reachedSafeguardCount = logs.filter((log) => reachedBackendSafeguard(log)).length;
  const safeguardInterventionsCount = logs.filter((log) => reachedBackendSafeguard(log) && hasBackendSafeguardIntervention(log)).length;
  const cleanTrafficCount = logs.filter((log) => getMetricsSeverityBucket(log, entropyThreshold) === 'clean').length;
  const likelyMaliciousLogs = logs.filter((log) => isLikelyMaliciousPrompt(log, entropyThreshold));
  const postModelEscapeCount = likelyMaliciousLogs.filter((log) =>
    !wasPreInferenceBlocked(log, entropyThreshold) &&
    !hasBackendSafeguardIntervention(log) &&
    !hasResponderIntervention(log) &&
    wasOriginallyReleased(log, entropyThreshold)
  ).length;

  return {
    totalCount: totalLogs,
    preInferenceBlockedCount,
    safeguardInterventionsCount,
    reachedSafeguardCount,
    cleanTrafficCount,
    likelyMaliciousCount: likelyMaliciousLogs.length,
    postModelEscapeCount,
    preInferenceBlockRate: totalLogs > 0 ? parseFloat(((preInferenceBlockedCount / totalLogs) * 100).toFixed(1)) : 0,
    safeguardInterventionRate: reachedSafeguardCount > 0 ? parseFloat(((safeguardInterventionsCount / reachedSafeguardCount) * 100).toFixed(1)) : 0,
    cleanTrafficRate: totalLogs > 0 ? parseFloat(((cleanTrafficCount / totalLogs) * 100).toFixed(1)) : 0,
    postModelEscapeRate: likelyMaliciousLogs.length > 0 ? parseFloat(((postModelEscapeCount / likelyMaliciousLogs.length) * 100).toFixed(1)) : 0,
  };
}

function createEmptySeverityCounts(): SeverityCounts {
  return {
    adversarial: 0,
    review: 0,
    policyViolation: 0,
    suspicious: 0,
    informational: 0,
    clean: 0,
  };
}

function formatMetricLatencyMs(value: unknown): string {
  const duration = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return '--';
  if (duration >= 1000) return `${(duration / 1000).toFixed(2)}s`;
  return `${duration.toFixed(1).replace(/\.0$/, '')}ms`;
}

// Export the ThreatDashboard functional component
export function ThreatDashboard({
  localReviewMode = false,
  localAuditLogs = [],
  governanceConfig,
  onGovernanceConfigChange,
}: ThreatDashboardProps) {
  // State to hold the results of the anomaly detection analysis
  const [metrics, setMetrics] = useState<any>(null);
  // Defer chart mount by one tick so the Card container has a real measured
  // size before recharts' ResponsiveContainer runs its first layout pass.
  // Without this, recharts measures width(-1) height(-1) on first paint and
  // logs a noisy console warning (the chart still renders correctly once
  // ResizeObserver fires, but the warning sticks around forever).
  const [chartsReady, setChartsReady] = useState(false);
  useEffect(() => { setChartsReady(true); }, []);
  // State to hold the calculated False Positive Rate metrics
  const [fprMetrics, setFprMetrics] = useState<any>(null);
  // State to hold the time-series data for the chart
  const [chartData, setChartData] = useState<any[]>([]);
  const [severityChartData, setSeverityChartData] = useState<any[]>([]);
  const [operationalMetrics, setOperationalMetrics] = useState<any>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'ctf_chat'>('all');
  // State to track if Human-in-the-Loop (HITL) mode is active
  const [isHitlActive, setIsHitlActive] = useState(false); 
  // State to track if the Global System Pause is active
  const [isGlobalPause, setIsGlobalPause] = useState(false);
  const [entropyThreshold, setEntropyThreshold] = useState(Math.max(governanceConfig?.entropyThreshold ?? 4.0, SUSPICIOUS_ENTROPY_THRESHOLD));
  const [syntacticThreshold, setSyntacticThreshold] = useState(governanceConfig?.syntacticThreshold ?? 65);

  useEffect(() => {
    if (!governanceConfig) return;
    setIsHitlActive(governanceConfig.isHitlActive);
    setIsGlobalPause(governanceConfig.isGlobalPause);
    setEntropyThreshold(Math.max(governanceConfig.entropyThreshold, SUSPICIOUS_ENTROPY_THRESHOLD));
    setSyntacticThreshold(governanceConfig.syntacticThreshold);
  }, [governanceConfig]);

  // Phase 3 step 4: the old per-component onSnapshot to `config/governance` is
  // gone. The parent (App.tsx) polls /v1/governance and feeds the current value
  // down via the `governanceConfig` prop; the useEffect above (~line 495) keeps
  // local state synced when the prop changes. Mutations call PUT /v1/governance
  // and also bubble up via `onGovernanceConfigChange` so the parent doesn't
  // have to wait for its next poll tick.

  async function persistGovernance(next: {
    isHitlActive: boolean;
    isGlobalPause: boolean;
    entropyThreshold: number;
    syntacticThreshold: number;
  }) {
    onGovernanceConfigChange?.(next);
    if (localReviewMode) return;
    try {
      await putGovernanceConfig(next);
    } catch (error) {
      devWarn('Failed to persist governance config update', error);
    }
  }

  // Function to toggle the Global System Pause state
  const handleGlobalPauseToggle = async () => {
    const newPaused = !isGlobalPause;
    const nextHitl = newPaused ? false : isHitlActive;
    setIsGlobalPause(newPaused);
    if (newPaused) setIsHitlActive(false);
    await persistGovernance({
      isHitlActive: nextHitl,
      isGlobalPause: newPaused,
      entropyThreshold,
      syntacticThreshold,
    });
  };

  // Function to toggle the Human-in-the-Loop (HITL) mode
  const handleHitlToggle = async () => {
    const newHitl = !isHitlActive;
    setIsHitlActive(newHitl);
    await persistGovernance({
      isHitlActive: newHitl,
      isGlobalPause,
      entropyThreshold,
      syntacticThreshold,
    });
  };

  const handleEntropyThresholdChange = async (value: number) => {
    setEntropyThreshold(value);
    await persistGovernance({
      isHitlActive,
      isGlobalPause,
      entropyThreshold: value,
      syntacticThreshold,
    });
  };

  const handleSyntacticThresholdChange = async (value: number) => {
    setSyntacticThreshold(value);
    await persistGovernance({
      isHitlActive,
      isGlobalPause,
      entropyThreshold,
      syntacticThreshold: value,
    });
  };

  // Effect hook to load and calculate metrics data
  useEffect(() => {
    async function loadMetrics() {
      const buildMetricsFromLogs = (logs: any[]) => {
        const filteredLogs = sourceFilter === 'all'
          ? logs
          : logs.filter((log) => log.source === sourceFilter);

        // Anomaly detection + FPR moved to POST /v1/metrics/aggregate in Phase 3
        // step 3 (see the call below this function). Only display-bucketing and
        // operational-metrics computation stay client-side.
        const threatLogs = filteredLogs
          .filter((log) => getEffectiveDetectionLevel(log, entropyThreshold) >= 2)
          .map((log) => ({
            userId: log.userId,
            detectionLevel: getEffectiveDetectionLevel(log, entropyThreshold),
            timestamp: log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp),
          }));

        const hourlyData = Array(24).fill(0).map((_, i) => ({ hour: i, threats: 0 }));
        threatLogs.forEach(log => {
          const hour = log.timestamp.getHours();
          const bucket = hourlyData[hour];
          if (bucket) bucket.threats += 1;
        });

        const currentHour = new Date().getHours();
        const reorderedData = [];
        for (let i = 1; i <= 24; i++) {
          const h = (currentHour + i) % 24;
          reorderedData.push(hourlyData[h]);
        }
        setChartData(reorderedData);

        const severityHourlyData: Array<{ hour: number } & SeverityCounts> = Array(24).fill(0).map((_, i) => ({
          ...createEmptySeverityCounts(),
          hour: i,
        }));
        filteredLogs.forEach((log) => {
          const stamp = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
          const hour = stamp.getHours();
          const bucket = severityHourlyData[hour];
          if (!bucket) return;
          bucket[getMetricsSeverityBucket(log, entropyThreshold)] += 1;
        });
        const reorderedSeverityData = [];
        for (let i = 1; i <= 24; i++) {
          const h = (currentHour + i) % 24;
          reorderedSeverityData.push(severityHourlyData[h]);
        }
        setSeverityChartData(reorderedSeverityData);

        const pendingLogs = filteredLogs.filter((log) => isPendingReviewMetric(log, entropyThreshold));
        const reviewedLogs = filteredLogs.filter((log) => log.reviewed === true);
        const averagePendingHours = pendingLogs.length > 0
          ? pendingLogs.reduce((sum, log) => sum + getPendingAgeHours(log), 0) / pendingLogs.length
          : 0;

        const totalLogs = filteredLogs.length || 1;
        const latencyValues = filteredLogs
          .map((log) => Number(log.latencyMs || 0))
          .filter((latency) => Number.isFinite(latency) && latency > 0)
          .sort((a, b) => a - b);
        const averageLatencyMs = latencyValues.length > 0
          ? latencyValues.reduce((sum, latency) => sum + latency, 0) / latencyValues.length
          : 0;
        const p95Index = latencyValues.length > 0 ? Math.max(0, Math.ceil(latencyValues.length * 0.95) - 1) : 0;
        const p95LatencyMs = latencyValues.length > 0 ? latencyValues[p95Index] : 0;
        const maxLatencyMs = latencyValues.length > 0 ? latencyValues[latencyValues.length - 1] : 0;
        const embeddingDurationValues = filteredLogs
          .map((log) => Number(log.instructionEmbeddingDurationMs || 0))
          .filter((duration) => Number.isFinite(duration) && duration > 0)
          .sort((a, b) => a - b);
        const averageEmbeddingDurationMs = embeddingDurationValues.length > 0
          ? embeddingDurationValues.reduce((sum, duration) => sum + duration, 0) / embeddingDurationValues.length
          : 0;
        const embeddingP95Index = embeddingDurationValues.length > 0
          ? Math.max(0, Math.ceil(embeddingDurationValues.length * 0.95) - 1)
          : 0;
        const p95EmbeddingDurationMs = embeddingDurationValues.length > 0 ? embeddingDurationValues[embeddingP95Index] : 0;
        const maxEmbeddingDurationMs = embeddingDurationValues.length > 0 ? embeddingDurationValues[embeddingDurationValues.length - 1] : 0;
        const redosTrips = filteredLogs.filter((log) => Array.isArray(log.detectionFlags) && log.detectionFlags.includes('ReDoS_ATTEMPT_DETECTED')).length;
        const highLatencyCount = filteredLogs.filter((log) => Number(log.latencyMs || 0) > 100).length;
        const detectionSignalMetrics = calculateDetectionSignalMetrics(filteredLogs);
        const obfuscationSignalMetrics = calculateObfuscationSignalMetrics(filteredLogs);
        const researchSignalMetrics = calculateFeaturePressureMetrics(filteredLogs);
        const atlasColumns = ATLAS_TACTICS.map((tactic) => {
          const techniques = ATLAS_TECHNIQUE_DEFINITIONS
            .filter((definition) => definition.tactic === tactic)
            .map((definition) => ({
              ...definition,
              count: filteredLogs.filter((log) => log.atlasTechniqueId === definition.id).length,
            }));
          return { tactic, techniques };
        });
        const maxAtlasCount = atlasColumns.reduce((maxCount, column) => {
          const columnMax = column.techniques.reduce((innerMax, technique) => Math.max(innerMax, technique.count), 0);
          return Math.max(maxCount, columnMax);
        }, 0);

        const averagePromptLength = filteredLogs.length > 0
          ? filteredLogs.reduce((sum, log) => sum + (log.sanitizedPrompt?.length || 0), 0) / filteredLogs.length
          : 0;
        const averageLineCount = filteredLogs.length > 0
          ? filteredLogs.reduce((sum, log) => sum + (log.sanitizedPrompt ? log.sanitizedPrompt.split(/\r?\n/).length : 0), 0) / filteredLogs.length
          : 0;
        const averageEntropy = filteredLogs.length > 0
          ? filteredLogs.reduce((sum, log) => sum + (log.entropy || 0), 0) / filteredLogs.length
          : 0;
        const averageSuspiciousChunks = filteredLogs.length > 0
          ? filteredLogs.reduce((sum, log) => sum + ((log.suspiciousChunks || []).length), 0) / filteredLogs.length
          : 0;
        const entropyThresholdHitCount = filteredLogs.filter((log) => hasCurrentEntropyThresholdHit(log, entropyThreshold)).length;
        const strongestEntropyHit = filteredLogs.reduce((maxEntropy, log) => {
          const entropy = Number(log.entropy || 0);
          return Number.isFinite(entropy) ? Math.max(maxEntropy, entropy) : maxEntropy;
        }, 0);
        const alertCounts = filteredLogs.reduce<SeverityCounts>((counts, log) => {
          counts[getMetricsSeverityBucket(log, entropyThreshold)] += 1;
          return counts;
        }, createEmptySeverityCounts());
        const layerMetrics = calculateLayerMetrics(filteredLogs, entropyThreshold);

        setOperationalMetrics({
          hitl: {
            pendingCount: pendingLogs.length,
            reviewedCount: reviewedLogs.length,
            averagePendingHours: parseFloat(averagePendingHours.toFixed(1)),
          },
          latency: {
            averageLatencyMs: parseFloat(averageLatencyMs.toFixed(1)),
            p95LatencyMs: parseFloat((p95LatencyMs ?? 0).toFixed(1)),
            maxLatencyMs: parseFloat((maxLatencyMs ?? 0).toFixed(1)),
            embeddingSampleCount: embeddingDurationValues.length,
            averageEmbeddingDurationMs: parseFloat(averageEmbeddingDurationMs.toFixed(1)),
            p95EmbeddingDurationMs: parseFloat((p95EmbeddingDurationMs ?? 0).toFixed(1)),
            maxEmbeddingDurationMs: parseFloat((maxEmbeddingDurationMs ?? 0).toFixed(1)),
          },
          resilience: {
            redosTrips,
            highLatencyCount,
            highLatencyRate: parseFloat(((highLatencyCount / totalLogs) * 100).toFixed(1)),
          },
          promptShape: {
            averagePromptLength: Math.round(averagePromptLength),
            averageLineCount: parseFloat(averageLineCount.toFixed(1)),
            averageEntropy: parseFloat(averageEntropy.toFixed(2)),
            averageSuspiciousChunks: parseFloat(averageSuspiciousChunks.toFixed(1)),
          },
          entropyPolicy: {
            currentThreshold: parseFloat(entropyThreshold.toFixed(1)),
            hitCount: entropyThresholdHitCount,
            hitRate: parseFloat(((entropyThresholdHitCount / totalLogs) * 100).toFixed(1)),
            strongestHit: parseFloat(strongestEntropyHit.toFixed(2)),
          },
          alertSeverity: alertCounts,
          layerDefense: layerMetrics,
          detectionSignals: detectionSignalMetrics,
          obfuscationSignals: obfuscationSignalMetrics,
          researchSignals: researchSignalMetrics,
          atlasHeatmap: {
            maxCount: maxAtlasCount,
            columns: atlasColumns,
          },
        });
      };

      // localReviewMode runs entirely off in-memory audit logs (the polling
      // effect short-circuits in that mode). Anomaly + FPR aggregation runs
      // server-side over Postgres data and has no overlap with localReviewMode's
      // data, so surface empty defaults for those two widgets rather than
      // duplicating the analytics modules client-side.
      if (localReviewMode) {
        buildMetricsFromLogs(localAuditLogs);
        setMetrics({ isAnomaly: false, spikeRatio: 0, currentHourlyRate: 0, baselineHourlyRate: 0, topAttackerId: null });
        setFprMetrics({ strictFPR: 'N/A', falseNegativeRate: 'N/A', falsePositivesCount: 0, falseNegativesCount: 0, truePositivesCount: 0, totalReviewed: 0 });
        return;
      }

      try {
        // Phase 3 step 3: replace the prior direct Firestore getDocs(query) on
        // `audit_logs` with the Postgres-backed listAuditLogs client. row.record
        // already carries id/userId/timestamp mirrored in so we don't need a
        // hand-rolled field-by-field projection here.
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);
        const rows = await listAuditLogs({
          sinceTimestamp: yesterday.toISOString(),
          limit: 1000,
        });
        let allLogs: any[] = rows.map((row) => ({
          ...(row.record as Record<string, unknown>),
          timestamp: new Date(row.timestamp),
        }));
        allLogs = mergeLocalAuditLogOverlays(allLogs, localAuditLogs, yesterday);

        // Display-side bucketing + operational metrics still computed
        // client-side from the audit-log rows; only the two analytics modules
        // (detectThreatSpikes + calculateFalsePositiveMetrics) moved to the
        // backend in this step.
        buildMetricsFromLogs(allLogs);

        const aggregate = await aggregateMetrics({
          sinceTimestamp: yesterday.toISOString(),
          ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
          entropyThreshold,
        });
        setMetrics(aggregate.anomaly);
        setFprMetrics(aggregate.fpr);
      } catch (error) {
        console.error("Failed to load threat metrics:", error);
      }
    }

    // Execute the metrics loading function
    loadMetrics();
  }, [localReviewMode, sourceFilter, localAuditLogs, entropyThreshold]);

  // Render a loading state if metrics haven't loaded yet
  if (!metrics) {
    return (
      <div className="p-4 text-sm text-muted-foreground flex items-center gap-2 mb-6">
        <Activity className="w-4 h-4 animate-pulse" /> Loading telemetry...
      </div>
    );
  }

  // Render the main dashboard UI
  return (
    // 🔴 DYNAMIC BACKGROUND: Shifts to a dark crimson tint with a glowing red inset shadow when paused
    <div className={`transition-all duration-700 ease-in-out min-h-screen p-6 space-y-6 text-slate-100 ${
      isGlobalPause 
        ? 'bg-rose-950/20 shadow-[inset_0_0_120px_rgba(225,29,72,0.15)] border-t-4 border-rose-600' 
        : 'bg-transparent border-t-4 border-transparent'
    }`}>
      
      {/* 🔴 GLOBAL ALERT BANNER: Only renders when the system is halted */}
      {isGlobalPause && (
        <div className="w-full bg-rose-600 text-white p-3 rounded-md flex items-center justify-center gap-3 animate-in slide-in-from-top-4 shadow-lg shadow-rose-900/50">
          <AlertTriangle className="animate-pulse" size={24} />
          <span className="font-bold tracking-widest uppercase">
            System Halted: All automated inference is paused. 100% of traffic is routed to the manual review queue.
          </span>
        </div>
      )}

      {/* --- Header & Time Controls --- */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Security Operations</h2>
          <p className={`${isGlobalPause ? 'text-rose-300' : 'text-muted-foreground'} transition-colors`}>
            {localReviewMode
              ? 'Local review telemetry and governance controls.'
              : 'Real-time threat telemetry and governance controls.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</span>
          <button
            type="button"
            onClick={() => setSourceFilter('all')}
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
              sourceFilter === 'all'
                ? 'bg-secondary text-secondary-foreground'
                : 'border border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            All Traffic
          </button>
          <button
            type="button"
            onClick={() => setSourceFilter('ctf_chat')}
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
              sourceFilter === 'ctf_chat'
                ? 'bg-secondary text-secondary-foreground'
                : 'border border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            CTF Chat
          </button>
          <HelpTooltip text="Focus the Metrics view on Sam Spade CTF traffic or keep the full platform view." align="right" />
        </div>
      </div>

      {localReviewMode && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-sm text-slate-300">
          Local review mode is using in-memory telemetry. Firestore reads and governance writes are disabled for this session.
        </div>
      )}

      {/* --- Active Governance Controls (The Switches) --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Strict HITL Mode Toggle */}
        <div className={`p-4 rounded-lg border flex items-center justify-between transition-colors ${
          isHitlActive && !isGlobalPause ? 'bg-amber-950/40 border-amber-500/50' : 'bg-slate-900 border-slate-800'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-md ${isHitlActive && !isGlobalPause ? 'bg-amber-500/20 text-amber-500' : 'bg-slate-800 text-slate-400'}`}>
              <UserCheck size={24} />
            </div>
            <div>
              <h3 className="flex items-center gap-2 font-bold text-lg">
                <span>Human-in-the-Loop Mode</span>
                <HelpTooltip text="Route borderline prompts into analyst review instead of forwarding them automatically." />
              </h3>
              <p className="text-sm text-slate-400">Route "Suspicious" traffic to manual review queue.</p>
            </div>
          </div>
          <button 
            onClick={handleHitlToggle}
            disabled={isGlobalPause}
            className={`px-6 py-2 font-bold rounded-md transition-all ${
              isGlobalPause ? 'opacity-50 cursor-not-allowed bg-slate-800 text-slate-500' :
              isHitlActive ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            {isHitlActive ? 'ACTIVE' : 'ENABLE'}
          </button>
        </div>

        {/* Global Kill Switch */}
        <div className={`p-4 rounded-lg border flex items-center justify-between transition-colors ${
          isGlobalPause ? 'bg-rose-950/60 border-rose-500 ring-2 ring-rose-500/50 shadow-lg shadow-rose-900/50' : 'bg-slate-900 border-slate-800'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-md ${isGlobalPause ? 'bg-rose-500/20 text-rose-500 animate-pulse' : 'bg-slate-800 text-slate-400'}`}>
              {isGlobalPause ? <PauseOctagon size={24} /> : <PlayCircle size={24} />}
            </div>
            <div>
              <h3 className="flex items-center gap-2 font-bold text-lg">
                <span>Global System Pause</span>
                <HelpTooltip text="Halt automated inference and force traffic into manual review (e.g., Kill Switch)." />
              </h3>
              <p className={`text-sm ${isGlobalPause ? 'text-rose-200' : 'text-slate-400'}`}>
                Halt ALL traffic. Route 100% of prompts to manual review.
              </p>
            </div>
          </div>
          <button 
            onClick={handleGlobalPauseToggle}
            className={`px-6 py-2 font-bold rounded-md transition-all ${
              isGlobalPause ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-md' : 'bg-slate-800 hover:bg-rose-900/50 text-slate-300'
            }`}
          >
            {isGlobalPause ? 'SYSTEM HALTED' : 'INITIATE PAUSE'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 font-bold text-lg">
                <span>Entropy Threshold</span>
                <HelpTooltip text={`Sets the maximum approved entropy before prompts become adversarial. Prompt entropy above ${SUSPICIOUS_ENTROPY_THRESHOLD.toFixed(1)} and up to this threshold is treated as suspicious.`} />
              </h3>
              <p className="text-sm text-slate-400">Current adversarial cutoff for prompt entropy.</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-sm text-slate-100">
              {entropyThreshold.toFixed(1)}
            </div>
          </div>
          <input
            type="range"
            min={SUSPICIOUS_ENTROPY_THRESHOLD}
            max={4.6}
            step={0.1}
            value={entropyThreshold}
            onChange={(e) => { void handleEntropyThresholdChange(Number(e.target.value)); }}
            className="w-full accent-cyan-400"
          />
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>More aggressive</span>
            <span>More forgiving</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 font-bold text-lg">
                <span>Syntactic Threshold</span>
                <HelpTooltip text="Lower values catch more instruction-heavy prompts. Higher values require stronger meta-prompt structure before escalation." />
              </h3>
              <p className="text-sm text-slate-400">Current threshold for syntactic-probe escalation.</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-sm text-slate-100">
              {syntacticThreshold}
            </div>
          </div>
          <input
            type="range"
            min={40}
            max={90}
            step={1}
            value={syntacticThreshold}
            onChange={(e) => { void handleSyntacticThresholdChange(Number(e.target.value)); }}
            className="w-full accent-amber-400"
          />
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>More aggressive</span>
            <span>More forgiving</span>
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-8">
      {/* 🔴 Anomaly Alert Banner */}
      {metrics.isAnomaly && (
        <div className="bg-destructive/20 border border-destructive p-4 rounded-xl flex items-center gap-3 text-destructive-foreground">
          <AlertTriangle className="text-destructive w-8 h-8 flex-shrink-0" />
          <div>
            <h3 className="font-bold text-lg text-destructive">CRITICAL: Threat Spike Detected</h3>
            <p className="text-sm opacity-90">
              Threat volume is <b>{Math.round(metrics.spikeRatio * 100)}%</b> higher than the 24-hour baseline. 
              {metrics.topAttackerId && ` Top offending User ID: ${metrics.topAttackerId}`}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Metric Cards */}
        {/* Current Threat Rate Card */}
        <Card className="bg-card border-border shadow-sm overflow-visible">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span>Current Threat Rate (Last 1h)</span>
              <HelpTooltip text="Share of recent prompts classified as suspicious or adversarial in the last hour." />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold text-orange-500">
            {metrics.currentHourlyRate} <span className="text-xs font-normal text-muted-foreground">blocks/hr</span>
          </CardContent>
        </Card>
        
        {/* Baseline Threat Rate Card */}
        <Card className="bg-card border-border shadow-sm overflow-visible">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span>Baseline Threat Rate (24h Avg)</span>
              <HelpTooltip text="Average hourly suspicious and adversarial prompt volume across the last 24 hours." />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold text-blue-500">
            {metrics.baselineHourlyRate.toFixed(1)} <span className="text-xs font-normal text-muted-foreground">blocks/hr</span>
          </CardContent>
        </Card>
      </div>

      {/* FPR Metrics */}
      {fprMetrics && (
        <div className="grid grid-cols-2 gap-4">
          {/* False Positive Rate Card */}
          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span>False Positive Rate</span>
              <HelpTooltip text="Percentage of analyst-clean prompts wrongly blocked or threat-classified by the firewall." />
            </CardTitle>
              <UserCheck className="w-4 h-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-500">{fprMetrics.strictFPR}%</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Percentage of analyst-clean prompts wrongly blocked.
              </p>
            </CardContent>
          </Card>

          {/* False Negative Rate Card */}
          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span>False Negative Rate</span>
              <HelpTooltip text="Percentage of analyst-malicious prompts initially allowed by the firewall." />
            </CardTitle>
              <ShieldX className="w-4 h-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-rose-500">{fprMetrics.falseNegativeRate}%</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Percentage of analyst-malicious prompts initially missed.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Time-Series Chart */}
      <Card className="bg-card border-border shadow-sm overflow-visible">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span>24-Hour Threat Velocity</span>
              <HelpTooltip text="Hourly trend of suspicious and adversarial prompt volume over the last 24 hours." />
            </CardTitle>
        </CardHeader>
        <CardContent className="h-[250px] pt-4">
          {chartsReady && (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            {/* Render the LineChart using Recharts */}
            <LineChart data={chartData}>
              {/* Add a grid to the chart */}
              <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
              {/* Configure the X-axis to display hours */}
              <XAxis 
                dataKey="hour" 
                stroke="#888" 
                fontSize={12} 
                tickFormatter={(tick) => `${tick}:00`} 
                tickMargin={10}
              />
              {/* Configure the Y-axis for threat counts */}
              <YAxis 
                stroke="#888" 
                fontSize={12} 
                allowDecimals={false} 
                tickMargin={10}
              />
              {/* Add a tooltip to display details on hover */}
              <Tooltip 
                contentStyle={{ backgroundColor: '#1a1a1a', borderColor: '#333', borderRadius: '8px', fontSize: '12px' }} 
                itemStyle={{ color: '#ef4444' }}
                labelFormatter={(label) => `Hour: ${label}:00`}
              />
              {/* Render the line representing the threat data */}
              <Line 
                type="monotone" 
                dataKey="threats" 
                name="Threats"
                stroke="#ef4444"
                strokeWidth={3} 
                dot={{ r: 4, fill: "#ef4444", strokeWidth: 0 }} 
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border shadow-sm overflow-visible">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span>24-Hour Alert Severity Trend</span>
            <HelpTooltip text="Hourly trend of prompt outcomes grouped by alert severity over the last 24 hours." />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <div className="h-[180px]">
            {chartsReady && (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={severityChartData} margin={{ top: 6, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
              <XAxis
                dataKey="hour"
                stroke="#888"
                fontSize={12}
                tickFormatter={(tick) => `${tick}:00`}
                tickMargin={10}
              />
              <YAxis
                stroke="#888"
                fontSize={12}
                allowDecimals={false}
                tickMargin={10}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', color: '#e2e8f0' }}
                wrapperStyle={{ zIndex: 40 }}
                formatter={(value: number, name: string) => [`${value} alerts`, name]}
                labelFormatter={(label) => `Hour: ${label}:00`}
              />
              <Area type="monotone" dataKey="adversarial" name="Adversarial" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.35} />
              <Area type="monotone" dataKey="review" name="Review" stackId="1" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.35} />
              <Area type="monotone" dataKey="policyViolation" name="Policy Violation" stackId="1" stroke="#f97316" fill="#f97316" fillOpacity={0.35} />
              <Area type="monotone" dataKey="suspicious" name="Suspicious" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.35} />
              <Area type="monotone" dataKey="informational" name="Informational" stackId="1" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.3} />
              <Area type="monotone" dataKey="clean" name="Clean" stackId="1" stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
          <SeverityLegend />
        </CardContent>
      </Card>

      {operationalMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span>HITL Queue</span>
                <HelpTooltip text="Current manual review workload, including pending and already reviewed items." align="left" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pending Review</span>
                <span className="font-semibold text-amber-500">{operationalMetrics.hitl.pendingCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Reviewed</span>
                <span className="font-semibold text-blue-500">{operationalMetrics.hitl.reviewedCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span>Avg Pending Age</span>
                  <HelpTooltip text="Average time current review items have been waiting for analyst action." />
                </span>
                <span className="font-semibold text-slate-100">{operationalMetrics.hitl.averagePendingHours}h</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span>Latency Profile</span>
                <HelpTooltip text="Operational latency summary for prompt evaluation in the current dataset." />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Average</span>
                <span className="font-semibold text-cyan-400">{formatMetricLatencyMs(operationalMetrics.latency.averageLatencyMs)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span>P95</span>
                  <HelpTooltip text="Time under which 95% of prompt evaluations completed." />
                </span>
                <span className="font-semibold text-indigo-400">{formatMetricLatencyMs(operationalMetrics.latency.p95LatencyMs)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span>Max</span>
                  <HelpTooltip text="Slowest prompt evaluation observed in the current dataset." />
                </span>
                <span className="font-semibold text-amber-500">{formatMetricLatencyMs(operationalMetrics.latency.maxLatencyMs)}</span>
              </div>
              <div className="border-t border-border/70 pt-2" />
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span>Embedding Avg</span>
                  <HelpTooltip text="Average duration for backend instruction-monitor embedding calls recorded on audit logs." />
                </span>
                <span className="font-semibold text-emerald-400">{formatMetricLatencyMs(operationalMetrics.latency.averageEmbeddingDurationMs)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span>Embedding P95</span>
                  <HelpTooltip text="Time under which 95% of recorded embedding calls completed." />
                </span>
                <span className="font-semibold text-teal-300">{formatMetricLatencyMs(operationalMetrics.latency.p95EmbeddingDurationMs)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Embedding Samples</span>
                <span className="font-semibold text-slate-100">{operationalMetrics.latency.embeddingSampleCount}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span>Resilience Signals</span>
                <HelpTooltip text="Resilience and abuse signals that indicate regex stress, latency spikes, or service degradation." />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span>ReDoS Trips</span>
                  <HelpTooltip text="Number of prompts blocked because sanitization latency suggested regex abuse or computational overload." />
                </span>
                <span className="font-semibold text-rose-500">{operationalMetrics.resilience.redosTrips}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">High-Latency Prompts</span>
                <span className="font-semibold text-amber-500">{operationalMetrics.resilience.highLatencyCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span>High-Latency Rate</span>
                  <HelpTooltip text="Percentage of prompts whose evaluation time exceeded the high-latency threshold." />
                </span>
                <span className="font-semibold text-slate-100">{operationalMetrics.resilience.highLatencyRate}%</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span>Alert (By Severity)</span>
                <HelpTooltip text="Prompt counts grouped by final alert severity, ordered from most severe down to clean traffic." />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Adversarial</span>
                <span className="font-semibold text-rose-500">{operationalMetrics.alertSeverity.adversarial}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Review</span>
                <span className="font-semibold text-violet-400">{operationalMetrics.alertSeverity.review}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Policy Violation</span>
                <span className="font-semibold text-orange-400">{operationalMetrics.alertSeverity.policyViolation}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Suspicious</span>
                <span className="font-semibold text-amber-400">{operationalMetrics.alertSeverity.suspicious}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Informational</span>
                <span className="font-semibold text-sky-400">{operationalMetrics.alertSeverity.informational}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Clean</span>
                <span className="font-semibold text-emerald-400">{operationalMetrics.alertSeverity.clean}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span>Defense Funnel</span>
                <HelpTooltip text="Shows where prompt traffic is stopped across the two-layer safeguard path: before Safeguard LLM, by Safeguard LLM, or after both layers." />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <span>Pre-Inference Block Rate</span>
                    <HelpTooltip text="Of all prompts in the current view, this is the share blocked before they ever reached the Safeguard LLM." />
                  </span>
                  <span className="font-semibold text-rose-500">{operationalMetrics.layerDefense.preInferenceBlockRate}%</span>
                </div>
                <div className="text-[11px] text-slate-500 text-right">
                  {operationalMetrics.layerDefense.preInferenceBlockedCount} blocked before Safeguard LLM / {operationalMetrics.layerDefense.preInferenceBlockedCount + operationalMetrics.layerDefense.reachedSafeguardCount} total prompts
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <span>Model Intervention Rate</span>
                    <HelpTooltip text="Of the prompts that actually reached the Safeguard LLM, this is the share that it then blocked or queued for review." />
                  </span>
                  <span className="font-semibold text-amber-400">{operationalMetrics.layerDefense.safeguardInterventionRate}%</span>
                </div>
                <div className="text-[11px] text-slate-500 text-right">
                  {operationalMetrics.layerDefense.safeguardInterventionsCount} caught by Safeguard LLM / {operationalMetrics.layerDefense.reachedSafeguardCount} prompts that reached it
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <span>Clean Traffic Rate</span>
                    <HelpTooltip text="Of all prompts in the current view, this is the share grouped as Clean by the same severity bucketing used in Alert (By Severity)." />
                  </span>
                  <span className="font-semibold text-emerald-400">{operationalMetrics.layerDefense.cleanTrafficRate}%</span>
                </div>
                <div className="text-[11px] text-slate-500 text-right">
                  {operationalMetrics.layerDefense.cleanTrafficCount} clean prompts / {operationalMetrics.layerDefense.totalCount} total prompts
                  {operationalMetrics.layerDefense.likelyMaliciousCount > 0 && (
                    <span> ({operationalMetrics.layerDefense.postModelEscapeCount} likely-malicious escapes)</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2">
	              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
	                <span>Detection Signals</span>
	                <HelpTooltip text="Prompt counts for the main detection flag families in the current dataset, such as PII, regex hits, configured forbidden phrase hits, code-level policy semantic hits, and any recorded obfuscation technique." />
	              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">PII Hits</span>
                <span className="font-semibold text-blue-500">{operationalMetrics.detectionSignals.piiHits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Secret / Token Hits</span>
                <span className="font-semibold text-sky-400">{operationalMetrics.detectionSignals.secretHits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Regex Hits</span>
                <span className="font-semibold text-amber-500">{operationalMetrics.detectionSignals.regexHits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Keyword Hits</span>
                <span className="font-semibold text-rose-500">{operationalMetrics.detectionSignals.keywordHits}</span>
              </div>
	              <div className="flex items-center justify-between">
	                <span className="text-muted-foreground">Forbidden Phrase Hits</span>
	                <span className="font-semibold text-violet-400">{operationalMetrics.detectionSignals.topicHits}</span>
	              </div>
	              <div className="flex items-center justify-between">
	                <span className="text-muted-foreground">Policy Semantic Hits</span>
	                <span className="font-semibold text-pink-300">{operationalMetrics.detectionSignals.policySemanticHits}</span>
	              </div>
	              <div className="flex items-center justify-between">
	                <span className="text-muted-foreground">Obfuscation Hits</span>
	                <span className="font-semibold text-fuchsia-400">{operationalMetrics.detectionSignals.obfuscatedHits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Similarity Matches</span>
                <span className="font-semibold text-purple-400">{operationalMetrics.detectionSignals.instructionSimilarityHits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Semantic Matches</span>
                <span className="font-semibold text-indigo-300">{operationalMetrics.detectionSignals.semanticSimilarityHits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Language Recovery Signals</span>
                <span className="font-semibold text-cyan-300">{operationalMetrics.detectionSignals.languageRecoveryHits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Spelling Recovery</span>
                <span className="font-semibold text-emerald-300">{operationalMetrics.detectionSignals.spellingObfuscationHits}</span>
              </div>
              </CardContent>
          </Card>

          {operationalMetrics.researchSignals && (
            <Card className="bg-card border-border shadow-sm overflow-visible">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <span>Feature Pressure</span>
                  <HelpTooltip text="Pre-inference feature vectors recorded automatically with audit events, before Safeguard LLM forwarding. Feature Pressure is a 0-100 analysis score for comparing prompt structure; it does not independently block or allow traffic." />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {operationalMetrics.researchSignals.featureSampleCount === 0 ? (
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs text-muted-foreground">
                    No feature-vector audit events yet. Submit a prompt to populate this pre-inference analysis card.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Avg Feature Pressure</span>
                      <span className="font-semibold text-cyan-300">{operationalMetrics.researchSignals.averageResearchSignal} / 100</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">High Pressure Prompts</span>
                      <span className="font-semibold text-amber-400">{operationalMetrics.researchSignals.highResearchSignalCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Top Pressure Driver</span>
                      <span className="max-w-40 truncate text-right font-semibold text-slate-100" title={operationalMetrics.researchSignals.topResearchDriver}>
                        {operationalMetrics.researchSignals.topResearchDriver}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Avg Instruction Pressure</span>
                      <span className="font-semibold text-cyan-300">{operationalMetrics.researchSignals.averageInstructionPressure}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Avg Constraint Density</span>
                      <span className="font-semibold text-indigo-300">{operationalMetrics.researchSignals.averageConstraintDensityPressure}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Avg Syntax / Wrapper</span>
                      <span className="font-semibold text-pink-300">{operationalMetrics.researchSignals.averageSyntaxWrapperPressure}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Avg Obfuscation Pressure</span>
                      <span className="font-semibold text-fuchsia-400">{operationalMetrics.researchSignals.averageObfuscationPressure}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Avg Entropy Pressure</span>
                      <span className="font-semibold text-amber-400">{operationalMetrics.researchSignals.averageEntropyPressure}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Avg N-Gram Signal</span>
                      <span className="font-semibold text-emerald-300">{operationalMetrics.researchSignals.averageNgramObfuscationSignal}%</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span>Current Entropy Policy</span>
                <HelpTooltip text="Shows how the current entropy policy bands classify the stored prompt entropy values in this dataset, using the same threshold model the sanitizer and Metrics severity views now follow." />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Threshold</span>
                <span className="font-semibold text-cyan-300">{operationalMetrics.entropyPolicy.currentThreshold}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current Threshold Hits</span>
                <span className="font-semibold text-amber-400">{operationalMetrics.entropyPolicy.hitCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Hit Rate</span>
                <span className="font-semibold text-slate-100">{operationalMetrics.entropyPolicy.hitRate}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span>Strongest Recorded Entropy</span>
                  <HelpTooltip text="Highest stored entropy value in the current dataset, useful for comparing current policy headroom against historical prompt shape." />
                </span>
                <span className="font-semibold text-rose-400">{operationalMetrics.entropyPolicy.strongestHit}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border shadow-sm overflow-visible">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span>Prompt Shape</span>
                <HelpTooltip text="Aggregate prompt characteristics such as length, line count, entropy, and suspicious chunk volume." />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Avg Length</span>
                <span className="font-semibold text-slate-100">{operationalMetrics.promptShape.averagePromptLength} chars</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Avg Lines</span>
                <span className="font-semibold text-slate-100">{operationalMetrics.promptShape.averageLineCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Avg Entropy</span>
                <span className="font-semibold text-slate-100">{operationalMetrics.promptShape.averageEntropy}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Avg Suspicious Chunks</span>
                <span className="font-semibold text-slate-100">{operationalMetrics.promptShape.averageSuspiciousChunks}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {operationalMetrics && (
        <Card className="bg-card border-border shadow-sm overflow-visible">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span>MITRE ATLAS Technique Heat Map</span>
              <HelpTooltip text="Volume of labeled prompts grouped by the active MITRE ATLAS organizer taxonomy." />
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid gap-4 xl:grid-cols-4">
              {operationalMetrics.atlasHeatmap.columns.map((column: any) => (
                <div key={column.tactic} className="space-y-2 min-w-0">
	                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
	                    {column.tactic}
	                  </div>
                  <div className="space-y-2">
                    {column.techniques.length > 0 ? column.techniques.map((technique: any) => (
	                      <div
	                        key={technique.id}
	                        className={`rounded-lg border px-3 py-2 transition-colors ${getHeatColor(technique.count, operationalMetrics.atlasHeatmap.maxCount)}`}
	                        title={`${technique.id} - ${technique.name}: ${technique.count} labeled prompts${technique.mappedCategories?.length ? ` | Covers: ${technique.mappedCategories.join(', ')}` : ''}`}
	                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono uppercase opacity-80">{technique.id}</div>
                            <div className="text-xs font-medium leading-snug mt-1">{technique.name}</div>
                          </div>
                          <div className="text-sm font-bold tabular-nums">{technique.count}</div>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-4 text-xs text-slate-500">
                        No mapped techniques yet.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-4">
              Tactics run horizontally, with MITRE ATLAS techniques stacked vertically beneath each tactic. Heat intensity scales to the highest labeled technique count in the current dataset.
            </p>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}

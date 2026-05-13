/**
 * Browser-local Playground research log.
 * Persists structured analysis snapshots so research/export work can happen
 * without storing raw prompts by default.
 */
import { z } from 'zod';
import {
  ATLAS_TACTIC_VALUES,
  ATLAS_TECHNIQUE_ID_VALUES,
  LOCAL_ARCHETYPES,
  type AtlasTaxonomyFields,
} from './atlasTaxonomy';

const PLAYGROUND_METRICS_STORAGE_KEY = 'counter_spy_playground_metrics_v1';
const MAX_PLAYGROUND_METRIC_ENTRIES = 2000;
export const PLAYGROUND_METRICS_UPDATED_EVENT = 'counter-spy:playground-metrics-updated';

// Display helper for normalized [0,1] feature-pressure values (UI-only formatter;
// the feature vector itself is computed server-side).
export function formatFeaturePercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export interface PlaygroundMetricEntry extends AtlasTaxonomyFields {
  id: string;
  timestamp: string;
  promptHash: string;
  promptLength: number;
  lineCount: number;
  wordCount: number;
  syntacticScore: number;
  entropy: number;
  globalEntropy: number;
  detectionLevel: number;
  verdictLabel: string;
  decodeTelemetry: 'plain_text' | 'single_hop_decode' | 'recursive_decode';
  redactionCount: number;
  redactionLabels?: string[];
  suspiciousChunkLengths?: number[];
  suspiciousChunkHashes?: string[];
  suspiciousChunkCount: number;
  isPotentiallyAdversarial: boolean;
  isProbingAttempt?: boolean;
  constraintCount?: number;
  constraintDensity?: number;
  specialCharRatio?: number;
  avgWordsPerSentence?: number;
  featureVector?: PromptFeatureVector;
  featurePressure?: number;
  researchSignal?: number;
  topPressureDriver?: string;
  topResearchDriver?: string;
  obfuscationCategory?: string;
  obfuscationTechniqueId?: string;
  obfuscationTechniqueName?: string;
  obfuscationAtlasId?: string;
  sourcePromptHash?: string;
  normalizationBackend?: string;
  normalizationChanged?: boolean;
  normalizationCorrectionsCount?: number;
  translationProvider?: string;
  translationSourceLang?: string;
  translationTargetLang?: string;
  translationTargetLangName?: string;
  pipelineStageCount?: number;
  backendGatewayStatus?: 'CLEAN' | 'INTERCEPTED' | 'QUEUED' | 'SHIELD_ERROR';
  backendSafeguardVerdict?: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL';
  backendSafeguardReasoning?: string;
  backendReachedSafeguard?: boolean;
  instructionSimilarity?: unknown;
  instructionEmbeddingDurationMs?: number;
}

export interface PlaygroundMetricSummary {
  sampleCount: number;
  featureSampleCount: number;
  averageSyntacticScore: number;
  averageEntropy: number;
  averageResearchSignal: number;
  highResearchSignalCount: number;
  lowLanguageLikelihoodCount: number;
  obfuscationHeavyCount: number;
  instructionDenseCount: number;
  topResearchDriver: string;
  suspiciousRate: number;
  adversarialRate: number;
}

export interface PromptFeatureVector {
  syntactic: {
    score: number;
    threshold: number;
    raw: {
      constraintCount: number;
      weightedConstraintScore: number;
      constraintDensity: number;
      specialCharRatio: number;
      avgWordsPerSentence: number;
      wrapperShellCount: number;
      verbosityBonus: number;
      wrapperShellBonus: number;
      obfuscationBonus: number;
      keywordScoreContribution: number;
      densityScoreContribution: number;
      specialCharScoreContribution: number;
    };
    normalized: {
      instructionPressure: number;
      constraintDensity: number;
      syntaxWrapperPressure: number;
      obfuscationPressure: number;
      verbosityPressure: number;
    };
  };
  entropy: {
    globalEntropy: number;
    maxWindowEntropy: number;
    suspiciousChunkCount: number;
    threshold: number;
    normalizedPressure: number;
  };
  languageLikelihood: {
    trigramHitRate: number;
    bestCaesarShiftTrigramRate: number;
    lowNaturalLanguageLikelihood: boolean;
    tokenCount: number;
    uniqueTokenRate: number;
    averageTokenLength: number;
    normalizedSuspicion: number;
  };
  featurePressure: number;
  researchSignal: number;
  topDriver: string;
  detectionFlags: string[];
  redactions: string[];
}

// Validates the wire shape returned by /v1/analyze/full (and used for the
// browser-local research log). Mirrors buildPromptFeatureVector in
// backend/src/analysis/promptFeatureVector.ts.
export const PromptFeatureVectorSchema: z.ZodType<PromptFeatureVector> = z.object({
  syntactic: z.object({
    score: z.number(),
    threshold: z.number(),
    raw: z.object({
      constraintCount: z.number(),
      weightedConstraintScore: z.number(),
      constraintDensity: z.number(),
      specialCharRatio: z.number(),
      avgWordsPerSentence: z.number(),
      wrapperShellCount: z.number(),
      verbosityBonus: z.number(),
      wrapperShellBonus: z.number(),
      obfuscationBonus: z.number(),
      keywordScoreContribution: z.number(),
      densityScoreContribution: z.number(),
      specialCharScoreContribution: z.number(),
    }),
    normalized: z.object({
      instructionPressure: z.number(),
      constraintDensity: z.number(),
      syntaxWrapperPressure: z.number(),
      obfuscationPressure: z.number(),
      verbosityPressure: z.number(),
    }),
  }),
  entropy: z.object({
    globalEntropy: z.number(),
    maxWindowEntropy: z.number(),
    suspiciousChunkCount: z.number(),
    threshold: z.number(),
    normalizedPressure: z.number(),
  }),
  languageLikelihood: z.object({
    trigramHitRate: z.number(),
    bestCaesarShiftTrigramRate: z.number(),
    lowNaturalLanguageLikelihood: z.boolean(),
    tokenCount: z.number(),
    uniqueTokenRate: z.number(),
    averageTokenLength: z.number(),
    normalizedSuspicion: z.number(),
  }),
  featurePressure: z.number().optional(),
  researchSignal: z.number().optional(),
  topDriver: z.string(),
  detectionFlags: z.array(z.string()),
  redactions: z.array(z.string()),
}).transform((featureVector) => {
  const featurePressure = featureVector.featurePressure ?? featureVector.researchSignal ?? 0;
  return {
    ...featureVector,
    featurePressure,
    researchSignal: featurePressure,
  };
});

const PlaygroundMetricEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  promptHash: z.string(),
  promptLength: z.number(),
  lineCount: z.number(),
  wordCount: z.number(),
  syntacticScore: z.number(),
  entropy: z.number(),
  globalEntropy: z.number(),
  detectionLevel: z.number(),
  verdictLabel: z.string(),
  decodeTelemetry: z.enum(['plain_text', 'single_hop_decode', 'recursive_decode']),
  redactionCount: z.number(),
  redactionLabels: z.array(z.string()).optional(),
  suspiciousChunkLengths: z.array(z.number()).optional(),
  suspiciousChunkHashes: z.array(z.string()).optional(),
  suspiciousChunkCount: z.number(),
  isPotentiallyAdversarial: z.boolean(),
  isProbingAttempt: z.boolean().optional(),
  constraintCount: z.number().optional(),
  constraintDensity: z.number().optional(),
  specialCharRatio: z.number().optional(),
  avgWordsPerSentence: z.number().optional(),
  featureVector: PromptFeatureVectorSchema.optional(),
  featurePressure: z.number().optional(),
  researchSignal: z.number().optional(),
  topPressureDriver: z.string().optional(),
  topResearchDriver: z.string().optional(),
  obfuscationCategory: z.string().optional(),
  obfuscationTechniqueId: z.string().optional(),
  obfuscationTechniqueName: z.string().optional(),
  obfuscationAtlasId: z.string().optional(),
  sourcePromptHash: z.string().optional(),
  normalizationBackend: z.string().optional(),
  normalizationChanged: z.boolean().optional(),
  normalizationCorrectionsCount: z.number().optional(),
  translationProvider: z.string().optional(),
  translationSourceLang: z.string().optional(),
  translationTargetLang: z.string().optional(),
  translationTargetLangName: z.string().optional(),
  pipelineStageCount: z.number().optional(),
  backendGatewayStatus: z.enum(['CLEAN', 'INTERCEPTED', 'QUEUED', 'SHIELD_ERROR']).optional(),
  backendSafeguardVerdict: z.enum(['CLEAN', 'SUSPICIOUS', 'ADVERSARIAL']).optional(),
  backendSafeguardReasoning: z.string().optional(),
  backendReachedSafeguard: z.boolean().optional(),
  instructionSimilarity: z.unknown().optional(),
  instructionEmbeddingDurationMs: z.number().optional(),
  atlasTactic: z.enum(ATLAS_TACTIC_VALUES).optional(),
  atlasTechniqueId: z.enum(ATLAS_TECHNIQUE_ID_VALUES).optional(),
  atlasTechniqueName: z.string().optional(),
  localArchetype: z.enum(LOCAL_ARCHETYPES).optional(),
  taxonomyConfidence: z.number().optional(),
  taxonomyNotes: z.string().optional(),
}).transform((entry) => {
  const featurePressure = getFeaturePressure(entry);
  const topPressureDriver = getTopPressureDriver(entry);

  return {
    ...entry,
    featurePressure,
    researchSignal: featurePressure,
    topPressureDriver,
    topResearchDriver: topPressureDriver,
  };
});

const PlaygroundMetricEntriesSchema = z.array(PlaygroundMetricEntrySchema);

export function getFeaturePressure(entry: {
  featurePressure?: number;
  researchSignal?: number;
  featureVector?: {
    featurePressure?: number;
    researchSignal?: number;
  };
}): number | undefined {
  return entry.featurePressure
    ?? entry.researchSignal
    ?? entry.featureVector?.featurePressure
    ?? entry.featureVector?.researchSignal;
}

export function getTopPressureDriver(entry: {
  topPressureDriver?: string;
  topResearchDriver?: string;
  featureVector?: {
    topDriver?: string;
  };
}): string | undefined {
  return entry.topPressureDriver
    ?? entry.topResearchDriver
    ?? entry.featureVector?.topDriver;
}

// Read and validate the local research log from browser storage.
export function loadPlaygroundMetrics(): PlaygroundMetricEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(PLAYGROUND_METRICS_STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    const validated = PlaygroundMetricEntriesSchema.safeParse(parsed);
    return validated.success ? validated.data : [];
  } catch (error) {
    console.error('Failed to load playground metrics from localStorage.', error);
    return [];
  }
}

// Persist a bounded rolling window of research entries.
export function savePlaygroundMetrics(entries: PlaygroundMetricEntry[]) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      PLAYGROUND_METRICS_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_PLAYGROUND_METRIC_ENTRIES)),
    );
    window.dispatchEvent(new CustomEvent(PLAYGROUND_METRICS_UPDATED_EVENT));
  } catch (error) {
    console.error('Failed to save playground metrics to localStorage.', error);
  }
}

// Clear the stored research history during purge/reset flows.
export function clearPlaygroundMetrics() {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(PLAYGROUND_METRICS_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(PLAYGROUND_METRICS_UPDATED_EVENT));
  } catch (error) {
    console.error('Failed to clear playground metrics from localStorage.', error);
  }
}

// Produce summary stats for the selected time window in the Playground UI.
export function summarizePlaygroundMetrics(entries: PlaygroundMetricEntry[], days?: number): PlaygroundMetricSummary {
  const cutoff = days
    ? Date.now() - (days * 24 * 60 * 60 * 1000)
    : null;

  const scopedEntries = cutoff
    ? entries.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff)
    : entries;

  if (scopedEntries.length === 0) {
    return {
      sampleCount: 0,
      featureSampleCount: 0,
      averageSyntacticScore: 0,
      averageEntropy: 0,
      averageResearchSignal: 0,
      highResearchSignalCount: 0,
      lowLanguageLikelihoodCount: 0,
      obfuscationHeavyCount: 0,
      instructionDenseCount: 0,
      topResearchDriver: 'None',
      suspiciousRate: 0,
      adversarialRate: 0,
    };
  }

  const suspiciousCount = scopedEntries.filter((entry) => entry.detectionLevel >= 2).length;
  const adversarialCount = scopedEntries.filter((entry) => entry.detectionLevel >= 3).length;
  const syntacticTotal = scopedEntries.reduce((sum, entry) => sum + entry.syntacticScore, 0);
  const entropyTotal = scopedEntries.reduce((sum, entry) => sum + entry.entropy, 0);
  const entriesWithResearchSignal = scopedEntries.filter((entry) => typeof getFeaturePressure(entry) === 'number');
  const researchSignalTotal = entriesWithResearchSignal.reduce((sum, entry) => sum + (getFeaturePressure(entry) ?? 0), 0);
  const highResearchSignalCount = entriesWithResearchSignal.filter((entry) => (getFeaturePressure(entry) ?? 0) >= 70).length;
  const lowLanguageLikelihoodCount = entriesWithResearchSignal.filter((entry) => entry.featureVector?.languageLikelihood.lowNaturalLanguageLikelihood).length;
  const obfuscationHeavyCount = entriesWithResearchSignal.filter((entry) => (entry.featureVector?.syntactic.raw.obfuscationBonus ?? 0) > 0).length;
  const instructionDenseCount = entriesWithResearchSignal.filter((entry) => (entry.featureVector?.syntactic.normalized.instructionPressure ?? 0) >= 0.7).length;
  const driverCounts = entriesWithResearchSignal.reduce<Record<string, number>>((counts, entry) => {
    const driver = getTopPressureDriver(entry);
    if (!driver) return counts;
    counts[driver] = (counts[driver] ?? 0) + 1;
    return counts;
  }, {});
  const topResearchDriver = Object.entries(driverCounts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'None';

  return {
    sampleCount: scopedEntries.length,
    featureSampleCount: entriesWithResearchSignal.length,
    averageSyntacticScore: parseFloat((syntacticTotal / scopedEntries.length).toFixed(1)),
    averageEntropy: parseFloat((entropyTotal / scopedEntries.length).toFixed(2)),
    averageResearchSignal: entriesWithResearchSignal.length > 0
      ? parseFloat((researchSignalTotal / entriesWithResearchSignal.length).toFixed(1))
      : 0,
    highResearchSignalCount,
    lowLanguageLikelihoodCount,
    obfuscationHeavyCount,
    instructionDenseCount,
    topResearchDriver,
    suspiciousRate: parseFloat(((suspiciousCount / scopedEntries.length) * 100).toFixed(1)),
    adversarialRate: parseFloat(((adversarialCount / scopedEntries.length) * 100).toFixed(1)),
  };
}

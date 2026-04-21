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
}

export interface PlaygroundMetricSummary {
  sampleCount: number;
  averageSyntacticScore: number;
  averageEntropy: number;
  suspiciousRate: number;
  adversarialRate: number;
}

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
  atlasTactic: z.enum(ATLAS_TACTIC_VALUES).optional(),
  atlasTechniqueId: z.enum(ATLAS_TECHNIQUE_ID_VALUES).optional(),
  atlasTechniqueName: z.string().optional(),
  localArchetype: z.enum(LOCAL_ARCHETYPES).optional(),
  taxonomyConfidence: z.number().optional(),
  taxonomyNotes: z.string().optional(),
});

const PlaygroundMetricEntriesSchema = z.array(PlaygroundMetricEntrySchema);

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
      averageSyntacticScore: 0,
      averageEntropy: 0,
      suspiciousRate: 0,
      adversarialRate: 0,
    };
  }

  const suspiciousCount = scopedEntries.filter((entry) => entry.detectionLevel >= 2).length;
  const adversarialCount = scopedEntries.filter((entry) => entry.detectionLevel >= 3).length;
  const syntacticTotal = scopedEntries.reduce((sum, entry) => sum + entry.syntacticScore, 0);
  const entropyTotal = scopedEntries.reduce((sum, entry) => sum + entry.entropy, 0);

  return {
    sampleCount: scopedEntries.length,
    averageSyntacticScore: parseFloat((syntacticTotal / scopedEntries.length).toFixed(1)),
    averageEntropy: parseFloat((entropyTotal / scopedEntries.length).toFixed(2)),
    suspiciousRate: parseFloat(((suspiciousCount / scopedEntries.length) * 100).toFixed(1)),
    adversarialRate: parseFloat(((adversarialCount / scopedEntries.length) * 100).toFixed(1)),
  };
}

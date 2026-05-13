import { analyzeLanguageLikelihood } from './languageLikelihood.js';
import type { BackendSanitizationResult } from '../security/sanitizer.js';
import { analyzeSyntacticComplexity, type SyntacticComplexityAnalysis } from './syntacticAnalyzer.js';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// The research-only prompt feature vector. The wire shape is mirrored on the client
// by PromptFeatureVectorSchema in src/lib/playgroundMetrics.ts (which validates the
// payload from /v1/analyze/feature-vector); keep the two in sync. The return type is
// left to inference so there is one source of truth for the shape.
export function buildPromptFeatureVector(params: {
  prompt: string;
  sanitization: Pick<BackendSanitizationResult, 'entropy' | 'globalEntropy' | 'suspiciousChunks' | 'redactions'> | null;
  entropyThreshold: number;
  syntacticThreshold: number;
  syntactic?: SyntacticComplexityAnalysis;
}) {
  const { prompt, sanitization, entropyThreshold, syntacticThreshold } = params;
  const syntactic = params.syntactic ?? analyzeSyntacticComplexity(prompt, syntacticThreshold);
  const languageLikelihood = analyzeLanguageLikelihood(prompt);
  const maxWindowEntropy = sanitization?.entropy ?? 0;
  const globalEntropy = sanitization?.globalEntropy ?? 0;
  const suspiciousChunkCount = sanitization?.suspiciousChunks.length ?? 0;
  const instructionPressure = clamp01(syntactic.metrics.keywordScoreContribution / 60);
  const constraintDensityPressure = clamp01(syntactic.metrics.densityScoreContribution / 40);
  const syntaxWrapperPressure = clamp01((
    syntactic.metrics.specialCharScoreContribution +
    syntactic.metrics.wrapperShellBonus
  ) / 42);
  const obfuscationPressure = clamp01(syntactic.metrics.obfuscationBonus / 72);
  const verbosityPressure = clamp01(syntactic.metrics.verbosityBonus / 25);
  const entropyPressure = clamp01((maxWindowEntropy - 3.0) / Math.max(0.1, entropyThreshold - 3.0));
  const languageSuspicion = languageLikelihood.tokenCount === 0
    ? 0
    : languageLikelihood.lowNaturalLanguageLikelihood
      ? 1
      : clamp01(1 - languageLikelihood.trigramHitRate);

  const drivers = [
    { label: 'Instruction Pressure', value: instructionPressure, weight: 0.26 },
    { label: 'Constraint Density', value: constraintDensityPressure, weight: 0.18 },
    { label: 'Syntax / Wrapper Pressure', value: syntaxWrapperPressure, weight: 0.14 },
    { label: 'Obfuscation Pressure', value: obfuscationPressure, weight: 0.18 },
    { label: 'Entropy Pressure', value: entropyPressure, weight: 0.12 },
    { label: 'N-Gram Obfuscation Signal', value: languageSuspicion, weight: 0.12 },
  ];
  const featurePressure = Math.round(
    drivers.reduce((sum, driver) => sum + driver.value * driver.weight, 0) * 100,
  );
  const topDriver = featurePressure === 0
    ? 'None'
    : drivers
      .map((driver) => ({ ...driver, weighted: driver.value * driver.weight }))
      .sort((left, right) => right.weighted - left.weighted)[0]?.label ?? 'None';

  return {
    syntactic: {
      score: syntactic.score,
      threshold: syntacticThreshold,
      raw: {
        constraintCount: syntactic.metrics.constraintCount,
        weightedConstraintScore: syntactic.metrics.weightedConstraintScore,
        constraintDensity: syntactic.metrics.constraintDensity,
        specialCharRatio: syntactic.metrics.specialCharRatio,
        avgWordsPerSentence: syntactic.metrics.avgWordsPerSentence,
        wrapperShellCount: syntactic.metrics.wrapperShellCount,
        verbosityBonus: syntactic.metrics.verbosityBonus,
        wrapperShellBonus: syntactic.metrics.wrapperShellBonus,
        obfuscationBonus: syntactic.metrics.obfuscationBonus,
        keywordScoreContribution: syntactic.metrics.keywordScoreContribution,
        densityScoreContribution: syntactic.metrics.densityScoreContribution,
        specialCharScoreContribution: syntactic.metrics.specialCharScoreContribution,
      },
      normalized: {
        instructionPressure,
        constraintDensity: constraintDensityPressure,
        syntaxWrapperPressure,
        obfuscationPressure,
        verbosityPressure,
      },
    },
    entropy: {
      globalEntropy,
      maxWindowEntropy,
      suspiciousChunkCount,
      threshold: entropyThreshold,
      normalizedPressure: entropyPressure,
    },
    languageLikelihood: {
      ...languageLikelihood,
      normalizedSuspicion: languageSuspicion,
    },
    featurePressure,
    researchSignal: featurePressure,
    topDriver,
    detectionFlags: sanitization?.redactions ?? [],
    redactions: sanitization?.redactions ?? [],
  };
}

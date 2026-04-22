/**
 * Prompt Playground / Syntactic Analyzer.
 * Combines local analysis, research snapshotting, normalization/translation,
 * and the obfuscation lab used for adversarial testing.
 */
// Import React and necessary hooks
import React, { useEffect, useMemo, useState } from 'react';
// Import icons from Lucide React
import { ShieldAlert, ShieldCheck, Activity, Info, Download, Save, Send, Languages, SpellCheck } from 'lucide-react';
// Import the syntactic complexity analysis function
import { analyzeSyntacticComplexity } from '../lib/syntacticAnalyzer';
// Import the full sanitization function and DetectionLevel enum
import { sanitizeInput, DetectionLevel } from '../lib/sanitizer';
import { POLICIES, extractMcpA2AHardBlockPhrases } from '../lib/policies';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  loadPlaygroundMetrics,
  PLAYGROUND_METRICS_UPDATED_EVENT,
  savePlaygroundMetrics,
  summarizePlaygroundMetrics,
  type PlaygroundMetricEntry,
} from '../lib/playgroundMetrics';
import {
  ATLAS_TACTICS,
  ATLAS_TECHNIQUE_DEFINITIONS,
  LOCAL_ARCHETYPES,
  type AtlasTactic,
  type AtlasTechniqueId,
  type LocalArchetype,
} from '../lib/atlasTaxonomy';
import { HelpTooltip } from './HelpTooltip';
import { toast } from 'sonner';
import {
  OBFUSCATION_CATEGORIES,
  applyObfuscationTechnique,
  generateObfuscationVariants,
  getObfuscationTechniques,
  type ObfuscatedVariant,
  type ObfuscationCategory,
} from '../lib/obfuscation';
import {
  normalizeSpelling,
  type NormalizationResult,
  type SpellCheckBackend,
} from '../lib/spellNormalize';
import {
  FOREIGN_LANGUAGE_KEYS,
  TRANSLATION_PROVIDER,
  TRANSLATION_PROVIDER_LABEL,
  TRANSLATION_TARGET_LANGUAGE_NAME,
  getLanguageName,
  type TranslationMode,
  type TranslationResult,
} from '../lib/translate';
import {
  checkBackendHealth,
  getBackendApiBaseUrl,
  translatePromptViaBackend,
  type BackendHealthResponse,
} from '../lib/backendApi';

// Define the properties expected by the SyntacticAnalyzer component
interface SyntacticAnalyzerProps {
  // Optional system configuration containing blocklists and regex rules
  systemConfig?: {
    blockedKeywords: string;
    forbiddenTopics: string;
    regexRules: string;
  };
  // Optional active guardrails configuration
  activeGuardrails?: any;
  governanceConfig?: {
    entropyThreshold: number;
    syntacticThreshold: number;
  };
  // Optional callback to route the current prompt through the live firewall pipeline
  onSubmitPrompt?: (prompt: string) => Promise<void>;
  // Optional flag showing the shared send pipeline is already busy
  isSubmitting?: boolean;
  maxContextWindow?: number;
  estimatePromptTokens?: (prompt: string) => number;
}

interface LanguagePipelineResult {
  sourcePromptHash: string;
  finalText: string;
  normalized?: NormalizationResult;
  translated?: TranslationResult;
}

// Export the SyntacticAnalyzer functional component
export function SyntacticAnalyzer({
  systemConfig,
  activeGuardrails,
  governanceConfig,
  onSubmitPrompt,
  isSubmitting = false,
  maxContextWindow,
  estimatePromptTokens,
}: SyntacticAnalyzerProps) {
  // State to hold the current text input by the user
  const [promptText, setPromptText] = useState('');
  const [researchEntries, setResearchEntries] = useState<PlaygroundMetricEntry[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [atlasTactic, setAtlasTactic] = useState<AtlasTactic | ''>('');
  const [atlasTechniqueId, setAtlasTechniqueId] = useState<AtlasTechniqueId | ''>('');
  const [localArchetype, setLocalArchetype] = useState<LocalArchetype | ''>('');
  const [taxonomyConfidence, setTaxonomyConfidence] = useState<string>('');
  const [taxonomyNotes, setTaxonomyNotes] = useState('');
  const [obfuscationCategory, setObfuscationCategory] = useState<ObfuscationCategory | 'all'>('all');
  const [obfuscationTechniqueId, setObfuscationTechniqueId] = useState('');
  const [obfuscationVariants, setObfuscationVariants] = useState<ObfuscatedVariant[]>([]);
  const [obfuscationSourceHash, setObfuscationSourceHash] = useState<string | null>(null);
  const [activeObfuscation, setActiveObfuscation] = useState<ObfuscatedVariant | null>(null);
  const [submitBaseDelayMs, setSubmitBaseDelayMs] = useState('750');
  const [submitJitterMs, setSubmitJitterMs] = useState('500');
  const [normalizationEnabled, setNormalizationEnabled] = useState(true);
  const [normalizationBackend, setNormalizationBackend] = useState<SpellCheckBackend>('heuristic');
  const [languageToolUrl, setLanguageToolUrl] = useState('http://localhost:8010');
  const [translationEnabled, setTranslationEnabled] = useState(true);
  const [translationMode, setTranslationMode] = useState<TranslationMode>('recover_to_english');
  const [translationTargetLang, setTranslationTargetLang] = useState('es');
  const [backendHealth, setBackendHealth] = useState<BackendHealthResponse | null>(null);
  const [backendHealthError, setBackendHealthError] = useState<string | null>(null);
  const [isCheckingBackendHealth, setIsCheckingBackendHealth] = useState(false);
  const [languagePipelineError, setLanguagePipelineError] = useState<string | null>(null);
  const [languagePipelineResult, setLanguagePipelineResult] = useState<LanguagePipelineResult | null>(null);
  const [activeLanguagePipeline, setActiveLanguagePipeline] = useState<LanguagePipelineResult | null>(null);
  const [isRunningLanguagePipeline, setIsRunningLanguagePipeline] = useState(false);

  // Boot and keep the browser-local research log in sync with the current tab state.
  useEffect(() => {
    const syncResearchEntries = () => setResearchEntries(loadPlaygroundMetrics());
    syncResearchEntries();
    window.addEventListener(PLAYGROUND_METRICS_UPDATED_EVENT, syncResearchEntries);
    return () => window.removeEventListener(PLAYGROUND_METRICS_UPDATED_EVENT, syncResearchEntries);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadBackendHealth = async () => {
      setIsCheckingBackendHealth(true);
      try {
        const result = await checkBackendHealth();
        if (!cancelled) {
          setBackendHealth(result);
          setBackendHealthError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setBackendHealth(null);
          setBackendHealthError(error instanceof Error ? error.message : 'Backend connection failed.');
        }
      } finally {
        if (!cancelled) {
          setIsCheckingBackendHealth(false);
        }
      }
    };

    void loadBackendHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  // useMemo ensures we only recalculate the analysis when the text or config actually changes
  const analysis = useMemo(() => {
    // Run the standalone syntactic complexity analysis
    const syntactic = analyzeSyntacticComplexity(promptText, governanceConfig?.syntacticThreshold ?? 65);
    
    // Initialize fullSanitization as null
    let fullSanitization = null;
    // Run full sanitization if config is provided and the prompt is not empty
    if (systemConfig && activeGuardrails && promptText.trim()) {
      // Parse the configuration strings into arrays
      const keywords = [
        ...new Set([
          ...systemConfig.blockedKeywords.split('\n').map((keyword) => keyword.trim().toLowerCase()).filter(Boolean),
          ...extractMcpA2AHardBlockPhrases(POLICIES),
        ]),
      ];
      const topics = systemConfig.forbiddenTopics.split('\n').filter(t => t.trim());
      const regexes = systemConfig.regexRules.split('\n').filter(r => r.trim());
      
      // Execute the full sanitization pipeline
      fullSanitization = sanitizeInput(promptText, keywords, topics, regexes, activeGuardrails, {
        entropyThreshold: governanceConfig?.entropyThreshold ?? 4.0,
        syntacticThreshold: governanceConfig?.syntacticThreshold ?? 65,
      });
    }
    
    // Return both the syntactic analysis and the full sanitization result
    return { syntactic, fullSanitization };
  }, [promptText, systemConfig, activeGuardrails]);

  // Helper function to colorize the syntactic score based on severity thresholds
  const getScoreColor = (score: number) => {
    // Red for scores >= 65 (Probing Attempt)
    if (score >= 65) return 'text-rose-500';
    // Yellow for scores >= 40 (Elevated)
    if (score >= 40) return 'text-amber-500';
    // Green for normal scores
    return 'text-emerald-500';
  };

  // Initialize default verdict variables (Clean)
  let verdictText = 'CLEAN';
  let verdictColor = 'bg-emerald-950/50 border-emerald-500/50 text-emerald-500';
  let VerdictIcon = ShieldCheck;

  // Determine the overall verdict based on the full sanitization result (if available)
  if (analysis.fullSanitization) {
    switch (analysis.fullSanitization.detectionLevel) {
      case DetectionLevel.ADVERSARIAL:
        // Set verdict to Adversarial (Red)
        verdictText = 'ADVERSARIAL';
        verdictColor = 'bg-rose-950/50 border-rose-500/50 text-rose-500';
        VerdictIcon = ShieldAlert;
        break;
      case DetectionLevel.SUSPICIOUS:
        // Set verdict to Suspicious (Yellow)
        verdictText = 'SUSPICIOUS';
        verdictColor = 'bg-amber-950/50 border-amber-500/50 text-amber-500';
        VerdictIcon = ShieldAlert;
        break;
      case DetectionLevel.INFORMATIONAL:
        // Set verdict to Informational (Blue)
        verdictText = 'INFORMATIONAL';
        verdictColor = 'bg-blue-950/50 border-blue-500/50 text-blue-500';
        VerdictIcon = Info;
        break;
    }
  // Fallback to syntactic score if full sanitization is not available
  } else if (analysis.syntactic.score >= 90) {
    verdictText = 'ADVERSARIAL';
    verdictColor = 'bg-rose-950/50 border-rose-500/50 text-rose-500';
    VerdictIcon = ShieldAlert;
  } else if (analysis.syntactic.isProbingAttempt) {
    verdictText = 'PROBING DETECTED';
    verdictColor = 'bg-amber-950/50 border-amber-500/50 text-amber-500';
    VerdictIcon = ShieldAlert;
  }

  // Render the component UI
  const summary30d = summarizePlaygroundMetrics(researchEntries, 30);
  const summary180d = summarizePlaygroundMetrics(researchEntries, 180);
  const summaryAll = summarizePlaygroundMetrics(researchEntries);
  const recentEntries = researchEntries.slice(-5).reverse();
  const availableTechniques = atlasTactic
    ? ATLAS_TECHNIQUE_DEFINITIONS.filter((definition) => definition.tactic === atlasTactic)
    : ATLAS_TECHNIQUE_DEFINITIONS;
  const selectedTacticDefinitions = atlasTactic
    ? ATLAS_TECHNIQUE_DEFINITIONS.filter((definition) => definition.tactic === atlasTactic)
    : [];
  const selectedTechnique = atlasTechniqueId
    ? ATLAS_TECHNIQUE_DEFINITIONS.find((definition) => definition.id === atlasTechniqueId)
    : undefined;
  const availableObfuscationTechniques = getObfuscationTechniques(obfuscationCategory);
  const canRunSanitization = Boolean(systemConfig && activeGuardrails);
  const estimatedPromptTokens = estimatePromptTokens && promptText.trim()
    ? estimatePromptTokens(promptText)
    : null;
  const exceedsContextWindow = Boolean(
    estimatedPromptTokens !== null &&
    Number.isFinite(maxContextWindow) &&
    (maxContextWindow ?? 0) > 0 &&
    estimatedPromptTokens > (maxContextWindow ?? 0),
  );
  const backendApiBaseUrl = getBackendApiBaseUrl();
  const translationModeLabel = translationMode === 'recover_to_english'
    ? 'Recover to English'
    : 'Generate Foreign Variant';
  const backendStatusLabel = isCheckingBackendHealth
    ? 'Checking backend'
    : backendHealth?.ok
      ? 'Backend ready'
      : 'Backend unavailable';
  const backendStatusTone = isCheckingBackendHealth
    ? 'border-amber-500/40 bg-amber-950/30 text-amber-200'
    : backendHealth?.ok
      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
      : 'border-rose-500/40 bg-rose-950/30 text-rose-200';

  const resetTranslationSettings = () => {
    setTranslationEnabled(true);
    setTranslationMode('recover_to_english');
    setTranslationTargetLang('es');
    setLanguagePipelineError(null);
  };

  const hashText = async (value: string) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  };

  // Normalize -> translate pipeline used to create cross-language prompt variants
  // before they move into the obfuscation lab or live firewall submission path.
  const runLanguagePipeline = async () => {
    if (!promptText.trim()) return;
    if (!normalizationEnabled && !translationEnabled) {
      setLanguagePipelineError('Enable normalization or translation before running the language pipeline.');
      return;
    }
    if (translationEnabled && !backendHealth?.ok) {
      setLanguagePipelineError('Counter-Spy.ai backend is unavailable. Keep the local backend running before using translation.');
      return;
    }
    setLanguagePipelineError(null);
    setIsRunningLanguagePipeline(true);

    try {
      const sourcePromptHash = await hashText(promptText);
      let currentText = promptText;
      let normalized: NormalizationResult | undefined;
      let translated: TranslationResult | undefined;

      if (normalizationEnabled) {
        normalized = await normalizeSpelling(currentText, {
          backend: normalizationBackend,
          languageToolUrl,
        });
        currentText = normalized.text;
      }

      if (translationEnabled) {
        const translationResult = await translatePromptViaBackend({
          text: currentText,
          provider: TRANSLATION_PROVIDER,
          mode: translationMode,
          ...(translationMode === 'generate_foreign_variant' ? { targetLang: translationTargetLang } : {}),
        });
        translated = translationResult;
        currentText = translationResult.text;
      }

      const nextResult: LanguagePipelineResult = {
        sourcePromptHash,
        finalText: currentText,
        normalized,
        translated,
      };

      setLanguagePipelineResult(nextResult);
      toast.success('Language pipeline completed.');
    } catch (error) {
      console.error('Failed to run language pipeline:', error);
      setLanguagePipelineError(
        error instanceof Error
          ? error.message
          : 'Language pipeline failed. Please verify the selected provider settings.',
      );
    } finally {
      setIsRunningLanguagePipeline(false);
    }
  };

  // Move the language-pipeline output back into the active prompt editor.
  const loadLanguagePipelineOutput = () => {
    if (!languagePipelineResult) return;
    setPromptText(languagePipelineResult.finalText);
    setActiveLanguagePipeline(languagePipelineResult);
    setActiveObfuscation(null);
    setObfuscationSourceHash(languagePipelineResult.sourcePromptHash);
    setSubmitError(null);
  };

  // Load one generated obfuscation variant as the current working prompt.
  const loadVariantIntoPrompt = async (variant: ObfuscatedVariant) => {
    const sourcePromptHash = promptText.trim() ? await hashText(promptText) : null;
    setPromptText(variant.result);
    setActiveObfuscation(variant);
    setObfuscationSourceHash(sourcePromptHash);
  };

  // Generate a single selected obfuscation transform.
  const generateSelectedObfuscation = () => {
    if (!promptText.trim() || !obfuscationTechniqueId) return;
    const variant = applyObfuscationTechnique(promptText, obfuscationTechniqueId);
    setObfuscationVariants(variant ? [variant] : []);
  };

  // Generate a whole family of obfuscation variants at once.
  const generateCategoryVariants = () => {
    if (!promptText.trim()) return;
    setObfuscationVariants(generateObfuscationVariants(promptText, obfuscationCategory));
  };

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  // Build one research-log entry from the current prompt, analysis, labeling, and
  // optional pipeline metadata so exports stay structured and presentation-friendly.
  const buildSnapshotEntry = async (
    rawPrompt: string,
    variant?: ObfuscatedVariant,
    sourcePromptHash?: string,
  ): Promise<PlaygroundMetricEntry | null> => {
    if (!rawPrompt.trim() || !systemConfig || !activeGuardrails) return null;

    const keywords = [
      ...new Set([
        ...systemConfig.blockedKeywords.split('\n').map((keyword) => keyword.trim().toLowerCase()).filter(Boolean),
        ...extractMcpA2AHardBlockPhrases(POLICIES),
      ]),
    ];
    const topics = systemConfig.forbiddenTopics.split('\n').filter((topic) => topic.trim());
    const regexes = systemConfig.regexRules.split('\n').filter((rule) => rule.trim());
    const syntactic = analyzeSyntacticComplexity(rawPrompt, governanceConfig?.syntacticThreshold ?? 65);
    const fullSanitization = sanitizeInput(rawPrompt, keywords, topics, regexes, activeGuardrails, {
      entropyThreshold: governanceConfig?.entropyThreshold ?? 4.0,
      syntacticThreshold: governanceConfig?.syntacticThreshold ?? 65,
    });
    const promptHash = await hashText(rawPrompt);
    const suspiciousChunkHashes = await Promise.all(
      fullSanitization.suspiciousChunks.map((chunk) => hashText(chunk)),
    );

    let derivedVerdict = 'CLEAN';
    if (fullSanitization.detectionLevel === DetectionLevel.ADVERSARIAL) {
      derivedVerdict = 'ADVERSARIAL';
    } else if (fullSanitization.detectionLevel === DetectionLevel.SUSPICIOUS) {
      derivedVerdict = 'SUSPICIOUS';
    } else if (fullSanitization.detectionLevel === DetectionLevel.INFORMATIONAL) {
      derivedVerdict = 'INFORMATIONAL';
    } else if (syntactic.score >= 90) {
      derivedVerdict = 'ADVERSARIAL';
    } else if (syntactic.isProbingAttempt) {
      derivedVerdict = 'PROBING DETECTED';
    }

    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      promptHash,
      promptLength: rawPrompt.length,
      lineCount: rawPrompt.split(/\r?\n/).length,
      wordCount: rawPrompt.trim().split(/\s+/).filter(Boolean).length,
      syntacticScore: syntactic.score,
      entropy: fullSanitization.entropy,
      globalEntropy: fullSanitization.globalEntropy,
      detectionLevel: fullSanitization.detectionLevel,
      verdictLabel: derivedVerdict,
      decodeTelemetry: fullSanitization.decodeTelemetry,
      redactionCount: fullSanitization.redactions.length,
      redactionLabels: fullSanitization.redactions,
      suspiciousChunkLengths: fullSanitization.suspiciousChunks.map((chunk) => chunk.length),
      suspiciousChunkHashes,
      suspiciousChunkCount: fullSanitization.suspiciousChunks.length,
      isPotentiallyAdversarial: fullSanitization.isPotentiallyAdversarial,
      isProbingAttempt: syntactic.isProbingAttempt,
      constraintCount: syntactic.metrics.constraintCount,
      constraintDensity: syntactic.metrics.constraintDensity,
      specialCharRatio: syntactic.metrics.specialCharRatio,
      avgWordsPerSentence: syntactic.metrics.avgWordsPerSentence,
      obfuscationCategory: variant?.technique.category,
      obfuscationTechniqueId: variant?.technique.id,
      obfuscationTechniqueName: variant?.technique.name,
      obfuscationAtlasId: variant?.technique.atlasId,
      sourcePromptHash: sourcePromptHash || undefined,
      normalizationBackend: activeLanguagePipeline?.normalized?.backend,
      normalizationChanged: activeLanguagePipeline?.normalized?.changed,
      normalizationCorrectionsCount: activeLanguagePipeline?.normalized?.corrections.length,
      translationProvider: activeLanguagePipeline?.translated?.provider,
      translationSourceLang: activeLanguagePipeline?.translated?.sourceLang,
      translationTargetLang: activeLanguagePipeline?.translated?.targetLang,
      translationTargetLangName: activeLanguagePipeline?.translated?.targetLangName,
      pipelineStageCount:
        (activeLanguagePipeline?.normalized ? 1 : 0) +
        (activeLanguagePipeline?.translated ? 1 : 0) || undefined,
      atlasTactic: selectedTechnique?.tactic || (atlasTactic || undefined),
      atlasTechniqueId: selectedTechnique?.id || undefined,
      atlasTechniqueName: selectedTechnique?.name || undefined,
      localArchetype: localArchetype || undefined,
      taxonomyConfidence: taxonomyConfidence ? Number(taxonomyConfidence) : undefined,
      taxonomyNotes: taxonomyNotes.trim() || undefined,
    };
  };

  // Save the current working prompt analysis to the browser-local research log.
  const recordResearchSnapshot = async () => {
    const entry = await buildSnapshotEntry(promptText, activeObfuscation || undefined, obfuscationSourceHash || undefined);
    if (!entry) return;

    const nextEntries = [...researchEntries, entry];
    setResearchEntries(nextEntries);
    savePlaygroundMetrics(nextEntries);
  };

  // Run every generated variant back through local analysis and snapshot the results.
  const analyzeAllVariants = async () => {
    if (!promptText.trim() || !canRunSanitization) return;

    const variants = generateObfuscationVariants(promptText, obfuscationCategory);
    if (variants.length === 0) return;

    setObfuscationVariants(variants);
    const sourcePromptHash = await hashText(promptText);
    const entries = (
      await Promise.all(
        variants.map((variant) => buildSnapshotEntry(variant.result, variant, sourcePromptHash)),
      )
    ).filter((entry): entry is PlaygroundMetricEntry => entry !== null);

    if (entries.length === 0) return;

    const nextEntries = [...researchEntries, ...entries];
    setResearchEntries(nextEntries);
    savePlaygroundMetrics(nextEntries);
    toast.success(`Recorded ${entries.length} obfuscation variant snapshots.`);
  };

  // Export the richer research artifact for notebooks, writeups, and CFP material.
  const exportResearchLogJson = () => {
    if (researchEntries.length === 0) return;

    const blob = new Blob([JSON.stringify(researchEntries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `playground_metrics_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export the same research log as a flat table for spreadsheets and charts.
  const exportResearchLogCsv = () => {
    if (researchEntries.length === 0) return;

    const escapeCsv = (value: string | number | boolean | null | undefined) => {
      const normalized = value == null ? '' : String(value);
      return `"${normalized.replace(/"/g, '""')}"`;
    };

    const csvHeaders = [
      'id',
      'timestamp',
      'promptHash',
      'promptLength',
      'lineCount',
      'wordCount',
      'syntacticScore',
      'constraintCount',
      'constraintDensity',
      'specialCharRatio',
      'avgWordsPerSentence',
      'obfuscationCategory',
      'obfuscationTechniqueId',
      'obfuscationTechniqueName',
      'obfuscationAtlasId',
      'sourcePromptHash',
      'normalizationBackend',
      'normalizationChanged',
      'normalizationCorrectionsCount',
      'translationProvider',
      'translationSourceLang',
      'translationTargetLang',
      'translationTargetLangName',
      'pipelineStageCount',
      'isProbingAttempt',
      'entropy',
      'globalEntropy',
      'detectionLevel',
      'verdictLabel',
      'decodeTelemetry',
      'redactionCount',
      'redactionLabels',
      'suspiciousChunkCount',
      'suspiciousChunkLengths',
      'suspiciousChunkHashes',
      'isPotentiallyAdversarial',
      'atlasTactic',
      'atlasTechniqueId',
      'atlasTechniqueName',
      'localArchetype',
      'taxonomyConfidence',
      'taxonomyNotes',
    ];

    const csvRows = researchEntries.map((entry) => [
      entry.id,
      entry.timestamp,
      entry.promptHash,
      entry.promptLength,
      entry.lineCount,
      entry.wordCount,
      entry.syntacticScore,
      entry.constraintCount,
      entry.constraintDensity,
      entry.specialCharRatio,
      entry.avgWordsPerSentence,
      entry.obfuscationCategory,
      entry.obfuscationTechniqueId,
      entry.obfuscationTechniqueName,
      entry.obfuscationAtlasId,
      entry.sourcePromptHash,
      entry.normalizationBackend,
      entry.normalizationChanged,
      entry.normalizationCorrectionsCount,
      entry.translationProvider,
      entry.translationSourceLang,
      entry.translationTargetLang,
      entry.translationTargetLangName,
      entry.pipelineStageCount,
      entry.isProbingAttempt,
      entry.entropy,
      entry.globalEntropy,
      entry.detectionLevel,
      entry.verdictLabel,
      entry.decodeTelemetry,
      entry.redactionCount,
      entry.redactionLabels?.join('|'),
      entry.suspiciousChunkCount,
      entry.suspiciousChunkLengths?.join('|'),
      entry.suspiciousChunkHashes?.join('|'),
      entry.isPotentiallyAdversarial,
      entry.atlasTactic,
      entry.atlasTechniqueId,
      entry.atlasTechniqueName,
      entry.localArchetype,
      entry.taxonomyConfidence,
      entry.taxonomyNotes,
    ].map(escapeCsv).join(','));

    const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `playground_metrics_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Route the current prompt through the shared live firewall pipeline.
  const submitToPipeline = async () => {
    if (!promptText.trim() || !onSubmitPrompt || isSubmitting) return;
    if (exceedsContextWindow && estimatedPromptTokens !== null && maxContextWindow) {
      setSubmitError(`Estimated forwarded prompt footprint ${estimatedPromptTokens} tokens exceeds the configured max context window of ${maxContextWindow}.`);
      return;
    }

    setSubmitError(null);
    try {
      await onSubmitPrompt(promptText);
    } catch (error) {
      console.error('Failed to submit playground prompt:', error);
      setSubmitError('Prompt submission failed. Please try again.');
    }
  };

  // Replay all generated variants through the live pipeline using delay + jitter so
  // demo traffic and audit trails look more like controlled test traffic than a burst.
  const submitAllVariantsToPipeline = async () => {
    if (!promptText.trim() || !onSubmitPrompt || isSubmitting) return;

    const variants = generateObfuscationVariants(promptText, obfuscationCategory);
    if (variants.length === 0) return;

    setSubmitError(null);
    setObfuscationVariants(variants);
    const baseDelay = Math.max(0, Number(submitBaseDelayMs) || 0);
    const jitter = Math.max(0, Number(submitJitterMs) || 0);

    let submittedCount = 0;
    try {
      for (const [index, variant] of variants.entries()) {
        await onSubmitPrompt(variant.result);
        submittedCount += 1;
        if (index < variants.length - 1) {
          const randomizedDelay = baseDelay + (jitter > 0 ? Math.floor(Math.random() * (jitter + 1)) : 0);
          if (randomizedDelay > 0) {
            await sleep(randomizedDelay);
          }
        }
      }
      toast.success(`Submitted ${submittedCount} obfuscation variants to the firewall.`);
    } catch (error) {
      console.error('Failed to submit obfuscation variants:', error);
      setSubmitError(`Variant submission stopped after ${submittedCount} successful sends.`);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 space-y-6 bg-slate-950 text-slate-200 rounded-xl border border-slate-800 shadow-xl">
      
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="text-indigo-500" />
            Prompt Playground
          </h2>
          <p className="text-slate-400 text-sm mt-1">Real-time detection using full firewall parameters.</p>
        </div>
        
        {/* Real-time Verdict Badge */}
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold border ${verdictColor}`}>
          <VerdictIcon size={20} />
          {verdictText}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            className="bg-indigo-600 text-white hover:bg-indigo-500"
            onClick={() => { void submitToPipeline(); }}
            disabled={!promptText.trim() || !analysis.fullSanitization || !onSubmitPrompt || isSubmitting || exceedsContextWindow}
          >
            <Send className="w-4 h-4 mr-2" />
            {isSubmitting ? 'Submitting...' : 'Submit to Firewall'}
          </Button>
          <HelpTooltip text="Send this single prompt through the same live pipeline used by Analyst Chat and Bulk Ingest." />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            className="bg-fuchsia-700 text-white hover:bg-fuchsia-600"
            onClick={() => { void submitAllVariantsToPipeline(); }}
            disabled={!promptText.trim() || !onSubmitPrompt || isSubmitting}
          >
            <Send className="w-4 h-4 mr-2" />
            Submit All Variants
          </Button>
          <HelpTooltip text="Generate a category set and submit each obfuscated variant through the live firewall path." />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
            onClick={() => { void recordResearchSnapshot(); }}
            disabled={!promptText.trim() || !analysis.fullSanitization}
          >
            <Save className="w-4 h-4 mr-2" />
            Record Metrics Snapshot
          </Button>
          <HelpTooltip text="Save the current analyzer result as a research entry without storing the raw prompt text." />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
            onClick={exportResearchLogJson}
            disabled={researchEntries.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export JSON
          </Button>
          <HelpTooltip text="Download the full research log in structured form for archival, scripting, or notebooks." />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
            onClick={exportResearchLogCsv}
            disabled={researchEntries.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <HelpTooltip text="Download the research log in tabular form for spreadsheets, charts, and slide prep." />
        </div>
        <Badge variant="outline" className="border-slate-700 text-slate-300">
          Browser-local research store
        </Badge>
        {estimatedPromptTokens !== null && (
          <Badge
            variant="outline"
            className={exceedsContextWindow ? 'border-rose-500 text-rose-300' : 'border-slate-700 text-slate-300'}
          >
            Estimated Prompt Tokens: {estimatedPromptTokens}
          </Badge>
        )}
        {Number.isFinite(maxContextWindow) && (maxContextWindow ?? 0) > 0 && (
          <Badge
            variant="outline"
            className={exceedsContextWindow ? 'border-rose-500 text-rose-300' : 'border-slate-700 text-slate-300'}
          >
            Max Context Window: {maxContextWindow}
          </Badge>
        )}
      </div>

      {submitError && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {submitError}
        </div>
      )}

      {exceedsContextWindow && estimatedPromptTokens !== null && maxContextWindow ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          This prompt is estimated at {estimatedPromptTokens} tokens after the forwarded firewall envelope, which exceeds the configured max context window of {maxContextWindow}. Raise the limit in the Analyst Chat settings dialog before submitting.
        </div>
      ) : null}

      {/* Input Area for the prompt */}
      <textarea
        className="w-full h-40 p-4 bg-slate-900 border border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none resize-none font-mono text-sm"
        placeholder="Enter a prompt to analyze..."
        value={promptText}
        onChange={(e) => {
          setPromptText(e.target.value);
          setActiveObfuscation(null);
          setActiveLanguagePipeline(null);
          setObfuscationSourceHash(null);
        }}
      />

      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">MITRE ATLAS Annotation</h3>
          <p className="text-xs text-slate-400 mt-1">
            Optional research labels for the current Playground prompt. These fields are saved with the research snapshot export.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <span>ATLAS Tactic</span>
              <HelpTooltip text="MITRE top-level organizer used to group this prompt for research and reporting." />
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={atlasTactic}
              onChange={(e) => {
                const nextTactic = e.target.value as AtlasTactic | '';
                setAtlasTactic(nextTactic);
                if (atlasTechniqueId) {
                  const stillValid = ATLAS_TECHNIQUE_DEFINITIONS.some((definition) => definition.id === atlasTechniqueId && definition.tactic === nextTactic);
                  if (!stillValid) {
                    setAtlasTechniqueId('');
                  }
                }
              }}
            >
              <option value="">Unlabeled</option>
              {ATLAS_TACTICS.map((tactic) => (
                <option key={tactic} value={tactic}>{tactic}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <span>ATLAS Technique</span>
              <HelpTooltip text="Specific MITRE organizer node assigned to this prompt within the active ATLAS taxonomy." />
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={atlasTechniqueId}
              onChange={(e) => {
                const nextTechniqueId = e.target.value as AtlasTechniqueId | '';
                setAtlasTechniqueId(nextTechniqueId);
                const nextTechnique = ATLAS_TECHNIQUE_DEFINITIONS.find((definition) => definition.id === nextTechniqueId);
                if (nextTechnique) {
                  setAtlasTactic(nextTechnique.tactic);
                }
              }}
            >
              <option value="">Unlabeled</option>
              {availableTechniques.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.id} - {definition.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <span>Local Archetype</span>
              <HelpTooltip text="Optional internal shorthand for finer distinctions beneath the main ATLAS organizer." />
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={localArchetype}
              onChange={(e) => setLocalArchetype(e.target.value as LocalArchetype | '')}
            >
              <option value="">None</option>
              {LOCAL_ARCHETYPES.map((archetype) => (
                <option key={archetype} value={archetype}>{archetype}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <span>Taxonomy Confidence</span>
              <HelpTooltip text="Analyst confidence that the selected taxonomy label is the best fit." />
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={taxonomyConfidence}
              onChange={(e) => setTaxonomyConfidence(e.target.value)}
            >
              <option value="">Unset</option>
              <option value="0.4">0.40</option>
              <option value="0.6">0.60</option>
              <option value="0.8">0.80</option>
              <option value="1">1.00</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <span>Taxonomy Notes</span>
            <HelpTooltip text="Optional rationale, ambiguity notes, or observations worth preserving with the label." />
          </label>
          <textarea
            className="w-full min-h-[84px] rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none resize-y"
            placeholder="Optional rationale for the MITRE ATLAS mapping, ambiguity, or analyst observations..."
            value={taxonomyNotes}
            onChange={(e) => setTaxonomyNotes(e.target.value)}
          />
        </div>

        {(selectedTechnique || atlasTactic) && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <Info className="h-3.5 w-3.5 text-slate-400" />
              Taxonomy Helper
            </div>
            {selectedTechnique ? (
              <div className="space-y-1">
                <div className="text-xs text-slate-200">
                  <span className="font-semibold">{selectedTechnique.id}</span> - {selectedTechnique.name}
                </div>
                <div className="text-[11px] text-slate-400">Tactic: {selectedTechnique.tactic}</div>
                {selectedTechnique.mappedCategories && selectedTechnique.mappedCategories.length > 0 && (
                  <div className="text-[11px] leading-relaxed text-slate-400">
                    Covers: {selectedTechnique.mappedCategories.join(', ')}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-xs text-slate-200">{atlasTactic}</div>
                <div className="text-[11px] leading-relaxed text-slate-400">
                  Techniques in this organizer: {selectedTacticDefinitions.map((definition) => `${definition.id} ${definition.name}`).join(', ')}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <SpellCheck className="h-4 w-4 text-cyan-400" />
            Normalize - Translate Pipeline
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Recover likely spelling intent, then translate natural-language prompts into English through the backend. Use this before adding evasions, not after encoding.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-cyan-500"
                  checked={normalizationEnabled}
                  onChange={(e) => setNormalizationEnabled(e.target.checked)}
                />
                Spell Verification
              </label>
              <HelpTooltip text="Normalize likely misspellings before translation. Skip this stage for already clean prompts or encoded payloads." />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <span>Normalization Backend</span>
                <HelpTooltip text="Heuristic runs fully in-browser. LanguageTool uses a configured local or remote service for richer correction." />
              </label>
              <select
                className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                value={normalizationBackend}
                onChange={(e) => setNormalizationBackend(e.target.value as SpellCheckBackend)}
                disabled={!normalizationEnabled}
              >
                <option value="heuristic">Heuristic (Browser-Local)</option>
                <option value="languagetool">LanguageTool (Provider)</option>
              </select>
            </div>

            {normalizationEnabled && normalizationBackend === 'languagetool' && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
                  <span>LanguageTool URL</span>
                  <HelpTooltip text="LanguageTool endpoint used for spelling and grammar correction. Example: http://localhost:8010" />
                </label>
                <input
                  type="text"
                  className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                  value={languageToolUrl}
                  onChange={(e) => setLanguageToolUrl(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                  checked={translationEnabled}
                  onChange={(e) => setTranslationEnabled(e.target.checked)}
                />
                Translation
              </label>
              <HelpTooltip text="This stage is manual only. Use Lara on demand to either recover English analyst text or generate one foreign-language variant without spending translation calls on every prompt change." />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-slate-700 text-slate-200">
                Provider: {TRANSLATION_PROVIDER_LABEL}
              </Badge>
              <Badge variant="outline" className={backendStatusTone}>
                {backendStatusLabel}
              </Badge>
              <Badge variant="outline" className="border-slate-700 text-slate-200">
                Mode: {translationModeLabel}
              </Badge>
              <Badge variant="outline" className="border-slate-700 text-slate-200">
                Manual only
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
                  <span>Translation Mode</span>
                  <HelpTooltip text="Recover to English is the default analyst path. Generate Foreign Variant translates English prompts into one analyst-selected language for later obfuscation and firewall testing." />
                </label>
                <select
                  className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  value={translationMode}
                  onChange={(e) => setTranslationMode(e.target.value as TranslationMode)}
                  disabled={!translationEnabled}
                >
                  <option value="recover_to_english">Recover to English</option>
                  <option value="generate_foreign_variant">Generate Foreign Variant</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
                  <span>Target Language</span>
                  <HelpTooltip text="Only used for Generate Foreign Variant. Recover to English always uses English as the fixed destination." />
                </label>
                <select
                  className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  value={translationMode === 'recover_to_english' ? 'en' : translationTargetLang}
                  onChange={(e) => setTranslationTargetLang(e.target.value)}
                  disabled={!translationEnabled || translationMode === 'recover_to_english'}
                >
                  {translationMode === 'recover_to_english' ? (
                    <option value="en">{TRANSLATION_TARGET_LANGUAGE_NAME}</option>
                  ) : (
                    FOREIGN_LANGUAGE_KEYS.map((languageKey) => (
                      <option key={languageKey} value={languageKey}>
                        {getLanguageName(languageKey)}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800"
                onClick={resetTranslationSettings}
              >
                Use Recommended Settings
              </Button>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3 text-xs text-slate-300 space-y-1">
              <div>
                Backend route: <span className="font-mono text-slate-100">{backendApiBaseUrl || 'same-origin dev proxy'}</span>
              </div>
              {backendHealthError ? (
                <div className="text-rose-300">{backendHealthError}</div>
              ) : (
                <div className="text-slate-400">
                  Keep the Counter-Spy.ai backend running with Lara credentials configured. This stage only runs when you click the pipeline button, so translation usage stays explicit and predictable.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-cyan-700 bg-cyan-950/30 text-cyan-100 hover:bg-cyan-900/40"
              onClick={() => { void runLanguagePipeline(); }}
              disabled={!promptText.trim() || isRunningLanguagePipeline}
            >
              <Languages className="w-4 h-4 mr-2" />
              {isRunningLanguagePipeline ? 'Running Pipeline...' : 'Run Normalize -> Translate'}
            </Button>
            <HelpTooltip text="Run spelling verification first, then optionally call Lara in the selected translation mode. Nothing in this stage runs automatically during normal prompt editing." />
          </div>

          {languagePipelineResult && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800"
                onClick={loadLanguagePipelineOutput}
              >
                Load Final Into Playground
              </Button>
              <HelpTooltip text="Replace the current Playground prompt with the latest pipeline output while preserving lineage metadata for research snapshots." />
            </div>
          )}
        </div>

        {languagePipelineError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            {languagePipelineError}
          </div>
        )}

        {languagePipelineResult && (
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pipeline Result</div>

            {languagePipelineResult.normalized && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-100">Normalization Stage</div>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">
                    {languagePipelineResult.normalized.backend}
                  </Badge>
                </div>
                <div className="text-xs text-slate-400">
                  {languagePipelineResult.normalized.changed
                    ? `Applied ${languagePipelineResult.normalized.corrections.length} corrections.`
                    : 'No spelling changes were applied.'}
                </div>
                {languagePipelineResult.normalized.corrections.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {languagePipelineResult.normalized.corrections.slice(0, 6).map((correction) => (
                      <Badge key={`${correction.offset}-${correction.original}`} variant="outline" className="border-slate-700 text-slate-300">
                        {correction.original} → {correction.replacement}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {languagePipelineResult.translated && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-100">Translation Stage</div>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">
                    {languagePipelineResult.translated.provider}
                  </Badge>
                </div>
                <div className="text-xs text-slate-400">
                  {languagePipelineResult.translated.sourceLang} → {languagePipelineResult.translated.targetLangName}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-3 space-y-2">
              <div className="text-sm font-semibold text-indigo-100">Final Pipeline Output</div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-300">
                {languagePipelineResult.finalText}
              </pre>
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Obfuscation Lab</h3>
          <p className="text-xs text-slate-400 mt-1">
            Generate evasive prompt variants for analyst testing. Adapted for Counter-Spy.ai from the Arcanum Prompt Obfuscator workbench.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <span>Technique Category</span>
              <HelpTooltip text="Group of obfuscation transforms used to generate analyst test variants." />
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={obfuscationCategory}
              onChange={(e) => {
                const nextCategory = e.target.value as ObfuscationCategory | 'all';
                setObfuscationCategory(nextCategory);
                if (obfuscationTechniqueId) {
                  const stillValid = getObfuscationTechniques(nextCategory).some((technique) => technique.id === obfuscationTechniqueId);
                  if (!stillValid) setObfuscationTechniqueId('');
                }
              }}
            >
              {OBFUSCATION_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category === 'all' ? 'All Categories' : category}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <span>Technique</span>
              <HelpTooltip text="Specific transform to apply to the current Playground prompt." />
            </label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={obfuscationTechniqueId}
              onChange={(e) => setObfuscationTechniqueId(e.target.value)}
            >
              <option value="">Select a technique</option>
              {availableObfuscationTechniques.map((technique) => (
                <option key={technique.id} value={technique.id}>
                  {technique.name} ({technique.atlasId})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <span>Replay Base Delay (ms)</span>
              <HelpTooltip text="Minimum wait time between Submit All Variants sends." />
            </label>
            <input
              type="number"
              min={0}
              step={50}
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={submitBaseDelayMs}
              onChange={(e) => setSubmitBaseDelayMs(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <span>Replay Jitter (ms)</span>
              <HelpTooltip text="Random extra delay added between Submit All Variants sends to avoid perfectly uniform replay traffic." />
            </label>
            <input
              type="number"
              min={0}
              step={50}
              className="flex h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={submitJitterMs}
              onChange={(e) => setSubmitJitterMs(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800"
              onClick={generateSelectedObfuscation}
              disabled={!promptText.trim() || !obfuscationTechniqueId}
            >
              Generate Technique Variant
            </Button>
            <HelpTooltip text="Apply the selected obfuscation technique to the current prompt." />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800"
              onClick={generateCategoryVariants}
              disabled={!promptText.trim()}
            >
              Generate Category Set
            </Button>
            <HelpTooltip text="Generate one variant for each technique in the selected category." />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-indigo-700 bg-indigo-950/40 text-indigo-100 hover:bg-indigo-900/50"
              onClick={() => { void analyzeAllVariants(); }}
              disabled={!promptText.trim() || !canRunSanitization}
            >
              Analyze All Variants
            </Button>
            <HelpTooltip text="Generate a category set and immediately record analyzer snapshots for each variant." />
          </div>
        </div>

        {activeObfuscation && (
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-3 text-xs text-slate-300">
            Active variant: <span className="font-semibold">{activeObfuscation.technique.name}</span> ({activeObfuscation.technique.atlasId})
          </div>
        )}

        {obfuscationVariants.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Generated Variants</div>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {obfuscationVariants.map((variant) => (
                <div key={`${variant.technique.id}-${variant.result.slice(0, 32)}`} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{variant.technique.name}</div>
                      <div className="text-[11px] text-slate-400">{variant.technique.category} · {variant.technique.atlasId}</div>
                    </div>
                    <Button type="button" size="sm" variant="outline" className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800" onClick={() => { void loadVariantIntoPrompt(variant); }}>
                      Use Variant
                    </Button>
                  </div>
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-300">{variant.result}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Flags & Redactions display */}
      {analysis.fullSanitization && analysis.fullSanitization.redactions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {/* Map over the redaction flags and render them as badges */}
          {analysis.fullSanitization.redactions.map((flag, idx) => (
            <span key={idx} className="px-2 py-1 text-xs font-semibold bg-slate-800 text-slate-300 rounded border border-slate-700">
              {flag}
            </span>
          ))}
        </div>
      )}

      {/* Dashboard Grid for metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* Main Score Card displaying the overall syntactic score */}
        <div className="col-span-1 bg-slate-900 p-4 rounded-lg border border-slate-800 flex flex-col justify-center items-center text-center">
          <span className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-2">Syntactic Score</span>
          <span className={`text-6xl font-black ${getScoreColor(analysis.syntactic.score)}`}>
            {analysis.syntactic.score}
          </span>
          <span className="text-slate-500 text-xs mt-2">Threshold: {governanceConfig?.syntacticThreshold ?? 65}</span>
        </div>

        {/* Metrics Breakdown Section */}
        <div className="col-span-3 bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-4">
          
          {/* Metric 0: Raw Keywords */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-300">Operational Keywords</span>
              <span className="font-mono text-cyan-400">{analysis.syntactic.metrics.constraintCount} found</span>
            </div>
            {/* Progress bar for Raw Keywords */}
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div 
                className="bg-cyan-500 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${Math.min((analysis.syntactic.metrics.constraintCount / 50) * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">Raw count of meta-prompting instructions (highly indicative of injection).</p>
          </div>

          {/* Metric 1: Constraint Density */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-300">Constraint Density</span>
              <span className="font-mono text-indigo-400">{analysis.syntactic.metrics.constraintDensity}%</span>
            </div>
            {/* Progress bar for Constraint Density */}
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div 
                className="bg-indigo-500 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${Math.min(analysis.syntactic.metrics.constraintDensity, 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">Density of operational overrides (ignore, must, system).</p>
          </div>

          {/* Metric 2: Special Character Ratio */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-300">Special Character Ratio</span>
              <span className="font-mono text-pink-400">{analysis.syntactic.metrics.specialCharRatio}%</span>
            </div>
            {/* Progress bar for Special Character Ratio */}
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div 
                className="bg-pink-500 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${Math.min(analysis.syntactic.metrics.specialCharRatio, 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">Usage of formatting escape characters (JSON/XML tags).</p>
          </div>

          {/* Metric 3: Sentence Verbosity */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-300">Sentence Verbosity</span>
              <span className="font-mono text-amber-400">{analysis.syntactic.metrics.avgWordsPerSentence} words/sentence</span>
            </div>
            {/* Progress bar for Sentence Verbosity */}
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div 
                className="bg-amber-500 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${Math.min((analysis.syntactic.metrics.avgWordsPerSentence / 100) * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">Detects run-on logic used for cognitive overload.</p>
          </div>

        </div>
      </div>

      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Research Log</h3>
            <p className="text-xs text-slate-400 mt-1">Saved snapshots record prompt hashes and firewall metrics for later trend analysis.</p>
          </div>
          <Badge variant="outline" className="border-slate-700 text-slate-300">
            {summaryAll.sampleCount} samples
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Last 30 Days', summary: summary30d },
            { label: 'Last 180 Days', summary: summary180d },
            { label: 'All Time', summary: summaryAll },
          ].map(({ label, summary }) => (
            <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
              <div className="text-2xl font-bold text-slate-100">{summary.sampleCount}</div>
              <div className="text-xs text-slate-400">Avg syntactic {summary.averageSyntacticScore} | Avg entropy {summary.averageEntropy}</div>
              <div className="text-xs text-slate-400">Suspicious {summary.suspiciousRate}% | Adversarial {summary.adversarialRate}%</div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Snapshots</div>
          {recentEntries.length === 0 ? (
            <div className="text-xs text-slate-500">No research snapshots recorded yet.</div>
          ) : (
            <div className="space-y-2">
              {recentEntries.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[140px_1fr_110px_160px] gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
                  <div className="text-slate-400">{new Date(entry.timestamp).toLocaleString()}</div>
                  <div className="font-mono text-slate-300 truncate" title={entry.promptHash}>{entry.promptHash}</div>
                  <div className="text-slate-300">Score {entry.syntacticScore}</div>
                  <div className="space-y-1">
                    <div className="text-slate-300">{entry.verdictLabel}</div>
                    {entry.atlasTechniqueId && (
                      <div className="text-[10px] text-slate-400 truncate" title={`${entry.atlasTechniqueId} - ${entry.atlasTechniqueName || ''}`}>
                        {entry.atlasTechniqueId}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

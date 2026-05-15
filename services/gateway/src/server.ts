/**
 * Counter-Spy backend gateway.
 * Hosts the local firewall intercept API, translation proxy, health endpoint,
 * and the governed Sam Spade CTF routes.
 */
// IMPORTANT: telemetry must be the first import so OpenTelemetry auto-instrumentation
// can patch Express/http/pg before they are loaded. See packages/backend-shared/src/telemetry.ts.
import { TELEMETRY_SERVICE_NAME } from '@counter-spy/backend-shared/telemetry.js';
import express, { type Request, type Response } from 'express';
import { Credentials, Translator } from '@translated/lara';
import { createHash } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';
import { sanitizeOutput, sanitizePrompt, type BackendSanitizationResult, type FirewallVerdict, type OutputSanitizationResult } from '@counter-spy/backend-shared/security/sanitizer.js';
import { DEFAULT_SAFEGUARD_EFFECTIVE_PROMPT } from '@counter-spy/backend-shared/security/safeguardDefaults.js';
import { assertEgressAllowed } from '@counter-spy/backend-shared/security/urlGuard.js';
import { createRateLimiter } from '@counter-spy/backend-shared/middleware/rateLimit.js';
import {
  createBackendAuthMiddleware,
  getAuthenticatedCallerId,
  type AuthenticatedRequest,
} from '@counter-spy/backend-shared/auth.js';
import { createObservability } from '@counter-spy/backend-shared/observability.js';
import {
  createSafeguardClient,
  SafeguardTimeoutError,
  type SafeguardResponseShape,
} from '@counter-spy/backend-shared/providers/safeguardClient.js';
import {
  createResponderClient,
  UpstreamResponderError,
  type ResponderProvider,
} from '@counter-spy/backend-shared/providers/responderClient.js';
import {
  getOpenAiCompatibleEmbeddingsEndpoint,
  isLocalOpenAiCompatibleUrl,
} from '@counter-spy/backend-shared/providers/openaiCompat.js';
import {
  LOCAL_INSPECTION_RESPONSE_TEXT,
  LOCAL_RESPONDER_PASSTHROUGH_RESPONSE_TEXT,
} from '@counter-spy/backend-shared/prompts/samSpadeDefaults.js';
import { detectThreatSpikes, type ThreatLog } from './analysis/anomalyDetector.js';
import { calculateFalsePositiveMetrics, type AuditLogMetrics } from './analysis/metrics.js';
import { mountWebApp } from './web/ssr.js';
import { analyzeSyntacticComplexity } from './analysis/syntacticAnalyzer.js';
import { buildPromptFeatureVector } from './analysis/promptFeatureVector.js';
import {
  OBFUSCATION_CATEGORIES,
  OBFUSCATION_TECHNIQUES,
  applyObfuscationTechnique,
  generateObfuscationVariants,
  type ObfuscatedVariant,
  type ObfuscationCategory,
} from './analysis/obfuscation.js';
import { normalizeWithHeuristicSync, type NormalizationResult } from './analysis/spellNormalize.js';
import { appendAuditLog, clearAuditLogs, initAuditStore, isAuditStoreConfigured, listAuditLogs, patchAuditLog, type AuditLogRow } from './audit/auditStore.js';
import { getConfig, initConfigStore, isConfigStoreConfigured, putConfig } from './config/configStore.js';
import { appendCtfReviewArtifact, listCtfReviewArtifacts } from './ctf/reviewArtifactStore.js';
import { SamSpadeReviewArtifactSchema, type SamSpadeReviewArtifact } from './ctf/types.js';
import {
  chunkText,
  fingerprintInstruction,
  getInstructionMonitorConnectionString,
  instructionMonitorConfig,
  PgvectorInstructionMonitor,
  type InstructionChunkInput,
  type InstructionMonitorCompareResult,
  type InstructionMatch,
  type InstructionSource,
} from './services/instruction-monitor/index.js';

export { LOCAL_INSPECTION_RESPONSE_TEXT, LOCAL_RESPONDER_PASSTHROUGH_RESPONSE_TEXT };

const EnvSchema = z.object({
  APP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  APP_ENV: z.enum(['dev', 'test', 'prod']).default('dev'),
  ALLOWED_ORIGINS: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SAFEGUARDS_MODEL_ID: z.string().min(1).default('gpt-5.4-mini'),
  SAFEGUARDS_API_BASE_URL: z.string().url().optional(),
  SAFEGUARDS_API_KEY: z.string().optional(),
  SAFEGUARDS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  RESPONDER_PROVIDER: z.enum(['openai_compatible', 'gemini']).optional(),
  RESPONDER_API_BASE_URL: z.string().url().optional(),
  RESPONDER_API_KEY: z.string().optional(),
  RESPONDER_MODEL_ID: z.string().min(1).default('amazon.nova-micro-v1:0'),
  LLM_API_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL_ID: z.string().optional(),
  INTERCEPT_BEARER_TOKEN: z.string().min(16).optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(0).max(1_000_000).default(120),
  EGRESS_ALLOWLIST: z.string().optional(),
  RESPONDER_OUTPUT_SHIELD_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value.toLowerCase() !== 'false')),
  // Opt-in safeguard-verdict cache. 0 = disabled (default). Keyed by the exact
  // (modelId + system prompt + constructed judge input), so a tuning/prompt
  // change is a cache miss; a per-request safeguard API key override is never cached.
  SAFEGUARD_CACHE_TTL_MS: z.coerce.number().int().min(0).max(86_400_000).default(0),
  SAFEGUARD_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).max(100_000).default(256),
  LARA_ACCESS_KEY_ID: z.string().optional(),
  LARA_ACCESS_KEY_SECRET: z.string().optional(),
  LARA_API_BASE_URL: z.string().url().optional(),
  INSTRUCTION_MONITOR_EMBEDDINGS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value.toLowerCase() !== 'false'),
  INSTRUCTION_MONITOR_EMBEDDINGS_API_BASE_URL: z.string().url().optional(),
  INSTRUCTION_MONITOR_EMBEDDINGS_API_KEY: z.string().optional(),
  INSTRUCTION_MONITOR_EMBEDDINGS_MODEL_ID: z.string().min(1).default('gpt-oss-safeguard-20b'),
  INSTRUCTION_MONITOR_EMBEDDINGS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  INSTRUCTION_MONITOR_EMBEDDINGS_MAX_CHUNKS: z.coerce.number().int().min(0).max(32).default(8),
});

// Validate backend configuration once before the server boots.
const env = EnvSchema.parse(process.env);

if (env.APP_ENV !== 'dev' && !env.INTERCEPT_BEARER_TOKEN) {
  throw new Error('INTERCEPT_BEARER_TOKEN is required outside dev.');
}

const app = express();
const port = env.APP_PORT || env.PORT || 8080;
const appEnv = env.APP_ENV;
const allowedOrigins = (
  env.ALLOWED_ORIGINS ||
  [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:3003',
    'http://127.0.0.1:3003',
    'https://app.cyber-spy.ai',
  ].join(',')
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const safeguardsModelId = env.SAFEGUARDS_MODEL_ID;
const safeguardsTimeoutMs = env.SAFEGUARDS_TIMEOUT_MS;
const responderModelId = env.LLM_MODEL_ID || env.RESPONDER_MODEL_ID;
const defaultGeminiResponderModelId = 'gemini-2.5-flash';

// SSRF egress guard: validate every configurable outbound base URL once at boot
// so a tampered/misconfigured endpoint cannot reach cloud metadata or other
// internal hosts. Loopback/RFC1918 targets are tolerated only in dev/demo.
const egressGuardOptions = {
  allowPrivate: appEnv === 'dev',
  ...(env.EGRESS_ALLOWLIST ? { allowlist: env.EGRESS_ALLOWLIST } : {}),
};
for (const [label, value] of [
  ['SAFEGUARDS_API_BASE_URL', env.SAFEGUARDS_API_BASE_URL],
  ['RESPONDER_API_BASE_URL', env.RESPONDER_API_BASE_URL],
  ['LLM_API_BASE_URL', env.LLM_API_BASE_URL],
  ['LARA_API_BASE_URL', env.LARA_API_BASE_URL],
  ['INSTRUCTION_MONITOR_EMBEDDINGS_API_BASE_URL', env.INSTRUCTION_MONITOR_EMBEDDINGS_API_BASE_URL],
] as const) {
  if (value) assertEgressAllowed(value, { ...egressGuardOptions, label });
}
const recentPromptHashes = new Map<string, number>();
const RETRY_WINDOW_MS = 5 * 60_000;
let instructionMonitorPromise: Promise<PgvectorInstructionMonitor | null> | undefined;

// Reports the runtime config for the instruction-monitor's embeddings sidecar.
// Embedding upstreams must stay loopback/RFC1918 in dev/demo; an explicitly
// configured external URL is "blocked_external" and the monitor refuses to
// embed against it.
function getInstructionEmbeddingsRuntimeConfig(): {
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  source: 'explicit' | 'blocked_external' | 'disabled';
} {
  if (env.INSTRUCTION_MONITOR_EMBEDDINGS_API_BASE_URL) {
    if (!isLocalOpenAiCompatibleUrl(env.INSTRUCTION_MONITOR_EMBEDDINGS_API_BASE_URL)) {
      return { source: 'blocked_external' };
    }
    return {
      baseUrl: env.INSTRUCTION_MONITOR_EMBEDDINGS_API_BASE_URL,
      apiKey: env.INSTRUCTION_MONITOR_EMBEDDINGS_API_KEY,
      modelId: env.INSTRUCTION_MONITOR_EMBEDDINGS_MODEL_ID,
      source: 'explicit',
    };
  }
  return { source: 'disabled' };
}

const responderProvider = env.RESPONDER_PROVIDER || 'openai_compatible';

// Observability + provider clients are constructed once at boot from the shared
// factories in @counter-spy/backend-shared. The gateway and sam-spade-service
// share the exact same implementations; each service constructs its own
// instance with its env-derived config.
const observability = createObservability({
  telemetryServiceName: TELEMETRY_SERVICE_NAME,
  logServiceName: 'counter-spy-backend',
  environment: appEnv,
  minLogLevel: env.LOG_LEVEL,
});
const { log, emitMetricIncrement } = observability;
const otelMeter = observability.meter;
// These instruments resolve to no-ops unless the OTel SDK was started (see
// telemetry.ts), so they are always safe to call.
const requestDurationHistogram = otelMeter.createHistogram('counterspy.http.server.duration', {
  description: 'Counter-Spy backend HTTP request duration.',
  unit: 'ms',
});
const safeguardLatencyHistogram = otelMeter.createHistogram('counterspy.safeguard.latency', {
  description: 'Safeguard LLM call latency.',
  unit: 'ms',
});
const responderLatencyHistogram = otelMeter.createHistogram('counterspy.responder.latency', {
  description: 'Downstream responder LLM call latency.',
  unit: 'ms',
});
const interceptVerdictCounter = otelMeter.createCounter('counterspy.intercept.verdict', {
  description: 'Gateway intercept decisions by status.',
});

const safeguardClient = createSafeguardClient(
  {
    baseUrl: env.SAFEGUARDS_API_BASE_URL,
    apiKey: env.SAFEGUARDS_API_KEY,
    modelId: safeguardsModelId,
    timeoutMs: safeguardsTimeoutMs,
    // Opt-in safeguard-verdict cache (see SAFEGUARD_CACHE_TTL_MS). Keyed by the
    // exact (modelId + system prompt + judge input) so any tuning/prompt change
    // is a miss; a per-request safeguard API key override is never cached.
    ...(env.SAFEGUARD_CACHE_TTL_MS > 0
      ? { cache: { ttlMs: env.SAFEGUARD_CACHE_TTL_MS, maxEntries: env.SAFEGUARD_CACHE_MAX_ENTRIES } }
      : {}),
  },
  {
    log,
    onCacheEvent: (event) => emitMetricIncrement('safeguard.cache', { hit: event === 'hit' }),
  },
);
const generateSafeguardVerdict = safeguardClient.generateSafeguardVerdict;

const responderClient = createResponderClient(
  {
    configuredProvider: env.RESPONDER_PROVIDER,
    responderBaseUrl: env.RESPONDER_API_BASE_URL,
    fallbackOpenAiBaseUrl: env.LLM_API_BASE_URL,
    apiKey: env.RESPONDER_API_KEY,
    fallbackApiKey: env.LLM_API_KEY,
    openAiModelId: responderModelId,
    geminiModelId: defaultGeminiResponderModelId,
  },
  { log },
);
const generateResponderOutput = responderClient.generateResponderOutput;

const requireBackendAuth = createBackendAuthMiddleware(env.INTERCEPT_BEARER_TOKEN);

async function getInstructionMonitor(): Promise<PgvectorInstructionMonitor | null> {
  if (!instructionMonitorConfig.INSTRUCTION_MONITOR_ENABLED) return null;
  if (!instructionMonitorPromise) {
    instructionMonitorPromise = (async () => {
      const connectionString = getInstructionMonitorConnectionString();
      if (!connectionString) {
        log('warn', 'instruction_monitor_disabled_missing_database_url');
        return null;
      }
      const monitor = new PgvectorInstructionMonitor({
        connectionString,
        embeddingDimensions: instructionMonitorConfig.INSTRUCTION_MONITOR_EMBEDDING_DIMENSIONS,
        compareLimit: instructionMonitorConfig.INSTRUCTION_MONITOR_COMPARE_LIMIT,
        similarityThreshold: instructionMonitorConfig.INSTRUCTION_MONITOR_SIMILARITY_THRESHOLD,
        hammingThreshold: instructionMonitorConfig.INSTRUCTION_MONITOR_HAMMING_THRESHOLD,
        chunkQueryConcurrency: instructionMonitorConfig.INSTRUCTION_MONITOR_CHUNK_QUERY_CONCURRENCY,
        ...(instructionMonitorConfig.INSTRUCTION_MONITOR_SEED_HMAC_KEY ? { seedHmacKey: instructionMonitorConfig.INSTRUCTION_MONITOR_SEED_HMAC_KEY } : {}),
      });
      await monitor.initialize();
      log('info', 'instruction_monitor_initialized', {
        embeddingDimensions: instructionMonitorConfig.INSTRUCTION_MONITOR_EMBEDDING_DIMENSIONS,
      });
      return monitor;
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Instruction monitor initialization failed.';
      log('warn', 'instruction_monitor_initialization_failed', { error: message });
      instructionMonitorPromise = undefined;
      return null;
    });
  }
  return instructionMonitorPromise;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((item) => typeof item === 'number' && Number.isFinite(item))) return undefined;
  return value;
}

function getInstructionSource(metadata: Record<string, unknown> | undefined): InstructionSource {
  const source = metadata?.source;
  if (
    source === 'analyst_chat' ||
    source === 'bulk_ingest' ||
    source === 'ctf_chat' ||
    source === 'ctf_solve' ||
    source === 'playground' ||
    source === 'system'
  ) {
    return source;
  }
  return 'analyst_chat';
}

function getInstructionChunks(metadata: Record<string, unknown> | undefined): InstructionChunkInput[] | undefined {
  const chunks = metadata?.instructionChunks;
  if (!Array.isArray(chunks)) return undefined;
  const parsed = chunks.flatMap((chunk): InstructionChunkInput[] => {
    if (!chunk || typeof chunk !== 'object') return [];
    const candidate = chunk as Record<string, unknown>;
    const text = typeof candidate.text === 'string' ? candidate.text : undefined;
    const embedding = asNumberArray(candidate.embedding);
    const intentScore = typeof candidate.intentScore === 'number' && Number.isFinite(candidate.intentScore)
      ? Math.max(0, Math.min(1, candidate.intentScore))
      : undefined;
    return text && embedding ? [{ text, embedding, intentScore }] : [];
  });
  return parsed.length ? parsed : undefined;
}

async function generateInstructionMonitorEmbeddings(text: string): Promise<{
  embedding?: number[];
  chunks?: InstructionChunkInput[];
  durationMs?: number;
} | undefined> {
  if (!env.INSTRUCTION_MONITOR_EMBEDDINGS_ENABLED) return undefined;
  const embeddingsRuntime = getInstructionEmbeddingsRuntimeConfig();
  if (embeddingsRuntime.source === 'blocked_external') {
    log('warn', 'instruction_embedding_external_provider_blocked', {
      reason: 'Instruction-monitor embeddings must use a local or private-network endpoint.',
    });
    return undefined;
  }
  if (!embeddingsRuntime.baseUrl || !embeddingsRuntime.modelId) return undefined;

  const chunkTexts = env.INSTRUCTION_MONITOR_EMBEDDINGS_MAX_CHUNKS > 0
    ? chunkText(text).filter((chunk) => chunk.trim()).slice(0, env.INSTRUCTION_MONITOR_EMBEDDINGS_MAX_CHUNKS)
    : [];
  const startedAt = Date.now();
  const endpoint = getOpenAiCompatibleEmbeddingsEndpoint(embeddingsRuntime.baseUrl);
  const fetchEmbeddings = async (inputs: string[], label: 'whole_and_chunks' | 'chunks_only') => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.INSTRUCTION_MONITOR_EMBEDDINGS_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(embeddingsRuntime.apiKey ? { authorization: `Bearer ${embeddingsRuntime.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: embeddingsRuntime.modelId,
          input: inputs,
        }),
      });

      if (!response.ok) {
        log('warn', 'instruction_embedding_provider_rejected', {
          status: response.status,
          modelId: embeddingsRuntime.modelId,
          source: embeddingsRuntime.source,
          inputMode: label,
          inputCount: inputs.length,
        });
        return undefined;
      }

      const payload = await response.json() as {
        data?: Array<{ index?: number; embedding?: unknown }>;
      };
      const embeddingsByIndex = new Map<number, number[]>();
      for (const item of payload.data ?? []) {
        const embedding = asNumberArray(item.embedding);
        if (typeof item.index === 'number' && embedding) embeddingsByIndex.set(item.index, embedding);
      }
      return embeddingsByIndex;
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? `Instruction embedding request timed out after ${env.INSTRUCTION_MONITOR_EMBEDDINGS_TIMEOUT_MS}ms.`
        : error instanceof Error
          ? error.message
          : 'Instruction embedding request failed.';
      log('warn', 'instruction_embedding_failed', {
        error: message,
        modelId: embeddingsRuntime.modelId,
        source: embeddingsRuntime.source,
        inputMode: label,
        inputCount: inputs.length,
      });
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  };

  const buildChunks = (embeddingsByIndex: Map<number, number[]>, indexOffset: number) => {
    return chunkTexts.flatMap((chunk, index): InstructionChunkInput[] => {
      const chunkEmbedding = embeddingsByIndex.get(index + indexOffset);
      return chunkEmbedding ? [{ text: chunk, embedding: chunkEmbedding }] : [];
    });
  };

  const batchedInputs = [text, ...chunkTexts];
  const embeddingsByIndex = await fetchEmbeddings(batchedInputs, 'whole_and_chunks');
  const embedding = embeddingsByIndex?.get(0);
  let chunks = embeddingsByIndex ? buildChunks(embeddingsByIndex, 1) : [];

  if (!chunks.length && chunkTexts.length) {
    const chunkOnlyEmbeddingsByIndex = await fetchEmbeddings(chunkTexts, 'chunks_only');
    if (chunkOnlyEmbeddingsByIndex) {
      chunks = chunkTexts.flatMap((chunk, index): InstructionChunkInput[] => {
        const chunkEmbedding = chunkOnlyEmbeddingsByIndex.get(index);
        return chunkEmbedding ? [{ text: chunk, embedding: chunkEmbedding }] : [];
      });
      if (chunks.length) {
        log('info', 'instruction_chunk_embedding_generated_after_whole_prompt_failure', {
          modelId: embeddingsRuntime.modelId,
          source: embeddingsRuntime.source,
          chunkCount: chunks.length,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  if (embedding || chunks.length) {
    log('info', 'instruction_embedding_generated', {
      modelId: embeddingsRuntime.modelId,
      source: embeddingsRuntime.source,
      inputCount: batchedInputs.length,
      ...(embedding ? { embeddingDimensions: embedding.length } : {}),
      chunkCount: chunks.length,
      durationMs,
      embeddingMode: embedding ? 'whole_and_chunks' : 'chunks_only',
    });
  }

  return {
    ...(embedding ? { embedding } : {}),
    ...(chunks.length ? { chunks } : {}),
    durationMs,
  };
}

async function evaluateInstructionSimilarity(args: {
  requestId: string;
  input: InterceptRequest;
  sanitization: BackendSanitizationResult;
}): Promise<{
  result: InstructionMonitorCompareResult;
  embeddingDurationMs?: number;
} | undefined> {
  const monitor = await getInstructionMonitor();
  if (!monitor) return undefined;

  const source = getInstructionSource(args.input.metadata);
  const suppliedEmbedding = asNumberArray(args.input.metadata?.instructionEmbedding);
  const suppliedChunks = getInstructionChunks(args.input.metadata);
  const generatedSignals = suppliedEmbedding && suppliedChunks
    ? undefined
    : await generateInstructionMonitorEmbeddings(args.sanitization.sanitized);
  const embedding = suppliedEmbedding ?? generatedSignals?.embedding;
  const chunks = suppliedChunks ?? generatedSignals?.chunks;
  const monitorInput = {
    id: args.requestId,
    source,
    text: args.sanitization.sanitized,
    embedding,
    chunks,
    verdict: args.sanitization.verdict,
    detectionFlags: args.sanitization.detectionFlags,
  };

  try {
    const record = fingerprintInstruction(monitorInput);
    const result = await monitor.compare(record);
    await monitor.observe({
      ...monitorInput,
      verdict: args.sanitization.verdict === 'CLEAN' && result.highestRisk !== 'low'
        ? 'SUSPICIOUS'
        : args.sanitization.verdict,
      detectionFlags: result.highestRisk === 'low'
        ? args.sanitization.detectionFlags
        : Array.from(new Set([
            ...args.sanitization.detectionFlags,
            'INSTRUCTION_SIMILARITY_MATCH',
            `INSTRUCTION_SIMILARITY_${result.highestRisk.toUpperCase()}`,
          ])),
    });
    if (result.highestRisk !== 'low') {
      log('info', 'instruction_similarity_match', {
        requestId: args.requestId,
        highestRisk: result.highestRisk,
        matchCount: result.matches.length,
        topMatchId: result.matches[0]?.targetId,
        topMatchHash: result.matches[0]?.targetHash,
        topMatchRisk: result.matches[0]?.risk,
      });
    }
    return {
      result,
      embeddingDurationMs: generatedSignals?.durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instruction monitor comparison failed.';
    log('warn', 'instruction_monitor_failed', { requestId: args.requestId, error: message });
    return undefined;
  }
}

async function observeReviewedAdversarialInstruction(input: ReviewedAdversarialInstructionRequest) {
  const monitor = await getInstructionMonitor();
  if (!monitor) return undefined;

  const generatedSignals = await generateInstructionMonitorEmbeddings(input.sanitizedPrompt);
  const labels = Array.from(new Set(['reviewed_adversarial', ...input.labels]));
  const record = await monitor.observe({
    id: input.logId,
    source: input.source,
    text: input.sanitizedPrompt,
    verdict: 'ADVERSARIAL',
    reviewed: true,
    detectionFlags: input.detectionFlags,
    labels,
    metadata: {
      ...(input.metadata ?? {}),
      reviewWorkflow: 'audit_log_button',
    },
    ...(generatedSignals?.embedding ? { embedding: generatedSignals.embedding } : {}),
    ...(generatedSignals?.chunks ? { chunks: generatedSignals.chunks } : {}),
  });

  return {
    record,
    embedded: Boolean(generatedSignals?.embedding),
    chunkCount: generatedSignals?.chunks?.length ?? 0,
    embeddingDurationMs: generatedSignals?.durationMs,
  };
}

export function getInstructionMatchReasons(match: InstructionMatch): string[] {
  const reasons: string[] = [];
  if (match.exactMatch) reasons.push('exact_sha256');
  if (match.looseExactMatch) reasons.push('loose_sha256');
  if (match.hammingDistance <= instructionMonitorConfig.INSTRUCTION_MONITOR_HAMMING_THRESHOLD) reasons.push('simhash_3gram');
  if (match.hammingDistance2gram <= instructionMonitorConfig.INSTRUCTION_MONITOR_HAMMING_THRESHOLD) reasons.push('simhash_2gram');
  if (match.hammingDistance4gram <= instructionMonitorConfig.INSTRUCTION_MONITOR_HAMMING_THRESHOLD) reasons.push('simhash_4gram');
  if (match.cosineSimilarity !== null && match.cosineSimilarity >= instructionMonitorConfig.INSTRUCTION_MONITOR_SIMILARITY_THRESHOLD) reasons.push('embedding');
  if (match.maxChunkSimilarity !== null && match.maxChunkSimilarity > 0.72) reasons.push('chunk_embedding');
  if (match.attentionPooledChunkSimilarity !== null && match.attentionPooledChunkSimilarity > 0.70) reasons.push('attention_pool');
  if (
    match.sandwichDelta !== null &&
    match.sandwichDelta > 0.20 &&
    match.maxChunkSimilarity !== null &&
    match.maxChunkSimilarity > 0.72
  ) reasons.push('sandwich_delta');
  return reasons;
}

function summarizeInstructionSimilarity(result: InstructionMonitorCompareResult | undefined) {
  if (!result || result.highestRisk === 'low') return undefined;
  const topMatch = result.matches[0];
  return {
    highestRisk: result.highestRisk,
    matchCount: result.matches.length,
    topMatch: topMatch
      ? {
          targetId: topMatch.targetId,
          targetHash: topMatch.targetHash,
          source: topMatch.source,
          targetVerdict: topMatch.targetVerdict,
          risk: topMatch.risk,
          matchReasons: getInstructionMatchReasons(topMatch),
          hammingDistance: topMatch.hammingDistance,
          hammingDistance2gram: topMatch.hammingDistance2gram,
          hammingDistance4gram: topMatch.hammingDistance4gram,
          cosineSimilarity: topMatch.cosineSimilarity,
          maxChunkSimilarity: topMatch.maxChunkSimilarity,
          attentionPooledChunkSimilarity: topMatch.attentionPooledChunkSimilarity,
          sandwichDelta: topMatch.sandwichDelta,
        }
      : undefined,
  };
}

function shortHash(hash: string | undefined) {
  return hash ? hash.slice(0, 16) : 'unknown';
}

function tagRetry(prompt: string, nowMs: number = Date.now()) {
  const promptHash = createHash('sha256').update(prompt).digest('hex');
  const firstSeen = recentPromptHashes.get(promptHash);
  const isRetry = firstSeen !== undefined && nowMs - firstSeen < RETRY_WINDOW_MS;

  for (const [hash, seenAt] of recentPromptHashes) {
    if (nowMs - seenAt >= RETRY_WINDOW_MS) {
      recentPromptHashes.delete(hash);
    }
  }

  if (!isRetry) {
    recentPromptHashes.set(promptHash, nowMs);
  }

  return {
    promptHash,
    isRetry,
    retryOfHash: isRetry ? promptHash : undefined,
  };
}

function hasSafeguardDivergence(verdict: FirewallVerdict, gatewayAction: InterceptResponse['status']) {
  if (verdict === 'CLEAN') return gatewayAction !== 'CLEAN';
  if (verdict === 'SUSPICIOUS') return gatewayAction !== 'QUEUED';
  return gatewayAction !== 'INTERCEPTED';
}

function emitSafeguardDecisionObservability(args: {
  requestId: string;
  retryTag: ReturnType<typeof tagRetry>;
  responseShape: SafeguardResponseShape;
  judgeVerdict: FirewallVerdict;
  gatewayAction: InterceptResponse['status'];
  rawReasoningTrace?: string;
  latencyMs: number;
}) {
  const divergence = hasSafeguardDivergence(args.judgeVerdict, args.gatewayAction);

  safeguardLatencyHistogram.record(args.latencyMs, { judge_verdict: args.judgeVerdict, response_shape: args.responseShape });
  interceptVerdictCounter.add(1, { status: args.gatewayAction, judge_verdict: args.judgeVerdict, stage: 'safeguard' });
  emitMetricIncrement('safeguard.schema', {
    shape: args.responseShape,
  });
  emitMetricIncrement('safeguard.divergence', {
    judgeVerdict: args.judgeVerdict,
    gatewayAction: args.gatewayAction,
    divergent: divergence,
  });

  log('info', 'safeguard_decision', {
    requestId: args.requestId,
    promptHash: args.retryTag.promptHash,
    isRetry: args.retryTag.isRetry,
    retryOfHash: args.retryTag.retryOfHash,
    responseShape: args.responseShape,
    judgeVerdict: args.judgeVerdict,
    gatewayAction: args.gatewayAction,
    divergence,
    rawReasoningTrace: args.rawReasoningTrace,
    latencyMs: args.latencyMs,
  });
}

const RESPONDER_OUTPUT_WITHHELD_TEXT =
  'Counter-Spy.ai withheld this responder output pending analyst review (the output Shield detected secret/credential material).';

// Output-side Shield: re-run the responder's text through `sanitizeOutput` before
// it leaves the gateway. High-risk leaks (canary, private/AWS/LLM keys) are
// withheld entirely; lesser redactions (e.g. an email or credit card the model
// echoed) are returned with the offending span replaced. Returns the (possibly
// rewritten) responder payload plus the OUTPUT_* flags to fold into detectionFlags.
function applyResponderOutputShield(
  responder: { provider: ResponderProvider; modelId: string; latencyMs: number; response: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } },
  context: { requestId: string; route: 'intercept' | 'sam_spade'; blockedKeywords?: string[] },
): {
  responder: NonNullable<InterceptResponse['responder']>;
  outputDetectionFlags: string[];
  tripped: boolean;
  highRiskLeak: boolean;
} {
  responderLatencyHistogram.record(responder.latencyMs, { provider: responder.provider, route: context.route });
  if (!env.RESPONDER_OUTPUT_SHIELD_ENABLED) {
    return {
      responder: { ...responder, status: 'COMPLETED' },
      outputDetectionFlags: [],
      tripped: false,
      highRiskLeak: false,
    };
  }
  const shield = sanitizeOutput(responder.response, context.blockedKeywords ? { blockedKeywords: context.blockedKeywords } : {});
  if (!shield.tripped) {
    return {
      responder: { ...responder, status: 'COMPLETED' },
      outputDetectionFlags: [],
      tripped: false,
      highRiskLeak: false,
    };
  }

  emitMetricIncrement('responder.output_redacted', {
    route: context.route,
    highRisk: shield.highRiskLeak,
    flags: shield.detectionFlags.length,
  });
  log('warn', 'responder_output_shield_tripped', {
    requestId: context.requestId,
    route: context.route,
    highRiskLeak: shield.highRiskLeak,
    detectionFlags: shield.detectionFlags,
  });

  if (shield.highRiskLeak) {
    return {
      responder: {
        provider: responder.provider,
        modelId: responder.modelId,
        status: 'WITHHELD',
        latencyMs: responder.latencyMs,
        response: RESPONDER_OUTPUT_WITHHELD_TEXT,
        outputDetectionFlags: shield.detectionFlags,
        ...(responder.usage ? { usage: responder.usage } : {}),
      },
      outputDetectionFlags: shield.detectionFlags,
      tripped: true,
      highRiskLeak: true,
    };
  }
  return {
    responder: {
      provider: responder.provider,
      modelId: responder.modelId,
      status: 'REDACTED',
      latencyMs: responder.latencyMs,
      response: shield.sanitized,
      outputDetectionFlags: shield.detectionFlags,
      ...(responder.usage ? { usage: responder.usage } : {}),
    },
    outputDetectionFlags: shield.detectionFlags,
    tripped: true,
    highRiskLeak: false,
  };
}

// Request shape for the main firewall intercept endpoint.
const InstructionSourceSchema = z.enum(['analyst_chat', 'bulk_ingest', 'ctf_chat', 'ctf_solve', 'playground', 'system']);

const InstructionChunkRequestSchema = z.object({
  text: z.string().min(1).max(10_000),
  embedding: z.array(z.number()).max(4096),
  intentScore: z.number().min(0).max(1).optional(),
});

const InterceptMetadataSchema = z.object({
  localReviewMode: z.boolean().optional(),
  source: InstructionSourceSchema.optional(),
  providerLlmRoutingEnabled: z.boolean().optional(),
  responderLlmRoutingEnabled: z.boolean().optional(),
  instructionSimilarityEnabled: z.boolean().optional(),
  safeguardApiKey: z.string().min(1).max(4096).optional(),
  safeguardEffectivePrompt: z.string().max(200_000).optional(),
  instructionEmbedding: z.array(z.number()).max(4096).optional(),
  instructionChunks: z.array(InstructionChunkRequestSchema).max(32).optional(),
}).strict();

const InterceptRequestSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  userId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  metadata: InterceptMetadataSchema.optional(),
  tuning: z.object({
    entropyThreshold: z.number().min(3).max(4.6).optional(),
    syntacticThreshold: z.number().min(40).max(90).optional(),
    blockedKeywords: z.array(z.string()).optional(),
    forbiddenTopics: z.array(z.string()).optional(),
    regexRules: z.array(z.string()).optional(),
  }).optional(),
});

type InterceptRequest = z.infer<typeof InterceptRequestSchema>;

const ReviewedAdversarialInstructionRequestSchema = z.object({
  logId: z.string().min(1).max(256),
  sanitizedPrompt: z.string().min(1).max(50_000),
  source: InstructionSourceSchema.default('analyst_chat'),
  detectionFlags: z.array(z.string().min(1).max(128)).default([]),
  labels: z.array(z.string().min(1).max(128)).default([]),
  metadata: z.object({
    auditLogId: z.string().min(1).max(256).optional(),
    batchId: z.string().min(1).max(256).optional(),
    expectedVerdict: z.string().min(1).max(64).optional(),
    backendSafeguardVerdict: z.enum(['CLEAN', 'SUSPICIOUS', 'ADVERSARIAL']).optional(),
    source: InstructionSourceSchema.optional(),
  }).strict().optional(),
});

type ReviewedAdversarialInstructionRequest = z.infer<typeof ReviewedAdversarialInstructionRequestSchema>;

interface ReviewedAdversarialInstructionResponse {
  status: 'OBSERVED' | 'UNAVAILABLE';
  recordId: string;
  embedded: boolean;
  chunkCount: number;
  embeddingDurationMs?: number;
}

// Translation proxy contracts used by the Playground language pipeline.
const TranslationProviderSchema = z.enum(['lara']);

const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(20_000),
  provider: TranslationProviderSchema.default('lara'),
  mode: z.enum(['recover_to_english', 'generate_foreign_variant']).default('recover_to_english'),
  targetLang: z.string().min(2).max(16).optional(),
}).strict();

type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

interface TranslateResponse {
  text: string;
  original: string;
  sourceLang: string;
  targetLang: string;
  targetLangName: string;
  provider: TranslateRequest['provider'];
}

export interface InterceptResponse {
  requestId: string;
  status: 'CLEAN' | 'QUEUED' | 'INTERCEPTED' | 'SHIELD_ERROR';
  governanceAction?: 'GLOBAL_PAUSE';
  promptHash?: string;
  isRetry?: boolean;
  retryOfHash?: string;
  sanitizedPrompt: string;
  detectionFlags: string[];
  instructionSimilarity?: ReturnType<typeof summarizeInstructionSimilarity>;
  safeguards: {
    modelId: string;
    verdict: FirewallVerdict;
    analystReasoning: string;
    entropy: number;
    globalEntropy: number;
    syntacticScore: number;
    latencyMs: number;
    instructionEmbeddingDurationMs?: number;
    localPrecheckLatencyMs: number;
    safeguardLatencyMs: number;
    gatewayLatencyMs: number;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  };
  responder?: {
    provider: ResponderProvider;
    modelId: string;
    status: 'COMPLETED' | 'DISABLED_LOCAL_ONLY' | 'REDACTED' | 'WITHHELD';
    latencyMs: number;
    response: string;
    /** OUTPUT_* flags from the output Shield, if it redacted or withheld content. */
    outputDetectionFlags?: string[];
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  };
}

export function buildLocalInspectionInterceptResponse(
  baseResponse: Omit<InterceptResponse, 'responder'>,
): InterceptResponse {
  return {
    ...baseResponse,
    responder: {
      provider: 'openai_compatible',
      modelId: 'local-inspection',
      status: 'DISABLED_LOCAL_ONLY',
      latencyMs: 0,
      response: LOCAL_INSPECTION_RESPONSE_TEXT,
    },
  };
}

export function buildLocalResponderPassthroughInterceptResponse(
  baseResponse: Omit<InterceptResponse, 'responder'>,
): InterceptResponse {
  return {
    ...baseResponse,
    responder: {
      provider: 'openai_compatible',
      modelId: 'local-responder-passthrough',
      status: 'DISABLED_LOCAL_ONLY',
      latencyMs: 0,
      response: LOCAL_RESPONDER_PASSTHROUGH_RESPONSE_TEXT,
    },
  };
}

const TARGET_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  zh: 'Chinese (Simplified)',
  ar: 'Arabic',
  ru: 'Russian',
  ja: 'Japanese',
  hi: 'Hindi',
  ko: 'Korean',
  fa: 'Persian (Farsi)',
  tr: 'Turkish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  pl: 'Polish',
  uk: 'Ukrainian',
};

const LARA_LANGUAGE_CODES: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ar: 'ar-SA',
  ru: 'ru-RU',
  ja: 'ja-JP',
  hi: 'hi-IN',
  ko: 'ko-KR',
  fa: 'fa-IR',
  tr: 'tr-TR',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-PT',
  it: 'it-IT',
  pl: 'pl-PL',
  uk: 'uk-UA',
};

function getTargetLanguageName(langKey: string): string {
  return TARGET_LANGUAGE_NAMES[langKey] ?? langKey;
}

// Cheap preflight guard to avoid sending obviously encoded garbage to translation providers.
function isTextLikelyEncodedForTranslation(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return (
    /(?:%[0-9A-Fa-f]{2}){6,}/.test(text) ||
    /(?:&#(?:x[0-9A-Fa-f]+|\d+);){4,}/.test(text) ||
    /\b(?:0x)?(?:[A-Fa-f0-9]{2}){12,}\b/.test(compact) ||
    /(?:^|[^A-Za-z0-9+/=])[A-Za-z0-9+/]{20,}={0,2}(?=$|[^A-Za-z0-9+/=])/.test(text)
  );
}

let laraTranslator: Translator | null | undefined;

function getLaraTranslator(): Translator | null {
  if (laraTranslator !== undefined) {
    return laraTranslator;
  }

  const accessKeyId = env.LARA_ACCESS_KEY_ID;
  const accessKeySecret = env.LARA_ACCESS_KEY_SECRET;
  const apiBaseUrl = env.LARA_API_BASE_URL;
  if (!accessKeyId || !accessKeySecret) {
    laraTranslator = null;
    return laraTranslator;
  }

  const credentials = new Credentials(accessKeyId, accessKeySecret);
  laraTranslator = new Translator(credentials, {
    ...(apiBaseUrl ? { serverUrl: apiBaseUrl } : {}),
    connectionTimeoutMs: 10_000,
  });
  return laraTranslator;
}

async function translateWithLara(
  text: string,
  options?: { sourceLang?: string | null; targetLang?: string },
): Promise<{ text: string; sourceLang: string }> {
  const translator = getLaraTranslator();
  if (!translator) {
    throw new Error('Lara Translate is not configured. Set LARA_ACCESS_KEY_ID and LARA_ACCESS_KEY_SECRET on the backend.');
  }

  const result = await translator.translate(
    text,
    options?.sourceLang ?? null,
    options?.targetLang ?? 'en-US',
    {
      contentType: 'text/plain',
      style: 'faithful',
      timeoutInMillis: 10_000,
    },
  );

  return {
    text: typeof result.translation === 'string' ? result.translation : text,
    sourceLang: result.sourceLanguage || 'auto',
  };
}

async function translateText(input: TranslateRequest): Promise<TranslateResponse> {
  if (isTextLikelyEncodedForTranslation(input.text)) {
    throw new Error('Translation skipped because the prompt already looks encoded or heavily obfuscated.');
  }
  const requestedTargetLang = input.mode === 'generate_foreign_variant'
    ? (input.targetLang ?? 'es')
    : 'en';
  const laraTargetLang = LARA_LANGUAGE_CODES[requestedTargetLang] ?? LARA_LANGUAGE_CODES.en;
  const laraSourceLang = input.mode === 'generate_foreign_variant' ? LARA_LANGUAGE_CODES.en : null;
  const translated = await translateWithLara(input.text, {
    sourceLang: laraSourceLang,
    targetLang: laraTargetLang,
  });

  return {
    text: translated.text,
    original: input.text,
    sourceLang: translated.sourceLang,
    targetLang: requestedTargetLang,
    targetLangName: getTargetLanguageName(requestedTargetLang),
    provider: 'lara',
  };
}

// Basic hardening middleware:
// - disable x-powered-by
// - apply permissive-but-explicit local CORS rules for dev/demo
// - parse bounded JSON bodies
// - assign a request id and structured start/finish logs
app.disable('x-powered-by');
app.use((req: Request, res: Response, next) => {
  const origin = req.header('origin');
  const allowOrigin = origin ? appEnv === 'dev' || allowedOrigins.includes(origin) : false;

  if (origin && allowOrigin) {
    res.header('access-control-allow-origin', origin);
    res.header('vary', 'Origin');
  }
  res.header('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.header('access-control-allow-headers', 'authorization,content-type,x-counter-spy-user-id');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
app.use(express.json({ limit: '256kb' }));

// Fixed-window rate limiter keyed by bearer token / client IP so a leaked token
// cannot be used to flood the safeguard/responder LLMs. Exempt: /healthz, and
// GET requests for the analyst console itself (the HTML shell + static assets) —
// loading a page fans out into many asset requests and must not burn the quota
// that protects the LLM-backed /v1 routes.
app.use(createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  exempt: (req) => req.path === '/healthz' || ((req.method === 'GET' || req.method === 'HEAD') && req.path !== '/v1' && !req.path.startsWith('/v1/')),
  onLimited: (req) => emitMetricIncrement('ratelimit.dropped', { path: req.path, method: req.method }),
}));

app.use((req: Request, res: Response, next) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  res.locals.requestId = requestId;
  // Correlate the auto-instrumented HTTP server span with our request id.
  trace.getActiveSpan()?.setAttribute('counterspy.request_id', requestId);

  log('info', 'request_started', {
    requestId,
    method: req.method,
    path: req.path,
  });

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    requestDurationHistogram.record(durationMs, {
      'http.request.method': req.method,
      'http.route': req.path,
      'http.response.status_code': res.statusCode,
    });
    log('info', 'request_finished', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
});

// The CTF game surface (/v1/ctf/sam-spade/*) belongs to the standalone
// sam-spade-service (services/sam-spade). Clients (the CTF frontend) call it
// directly via their own proxy / VITE_* config; the gateway 404s those paths.
// /v1/ctf/review-artifacts stays here — it's the bridge the analyst console
// reads from for CTF activity mirroring.
app.use((req: Request, res: Response, next) => {
  const isCtfGamePath = req.path === '/v1/ctf/sam-spade' || req.path.startsWith('/v1/ctf/sam-spade/');
  if (isCtfGamePath) {
    res.status(404).json({ error: 'Sam Spade routes are served by the standalone sam-spade-service container; this gateway does not proxy them.' });
    return;
  }
  next();
});

app.get('/healthz', (_req: Request, res: Response) => {
  const embeddingsRuntime = getInstructionEmbeddingsRuntimeConfig();
  res.status(200).json({
    ok: true,
    service: 'counter-spy-backend',
    environment: appEnv,
    safeguards: {
      provider: 'openai_compatible',
      configured: Boolean(env.SAFEGUARDS_API_BASE_URL && safeguardsModelId),
      modelId: safeguardsModelId || null,
      baseUrl: env.SAFEGUARDS_API_BASE_URL || null,
    },
    responder: {
      provider: responderProvider,
      configured: Boolean((env.RESPONDER_API_BASE_URL || env.LLM_API_BASE_URL || responderProvider === 'gemini') && (env.RESPONDER_API_KEY || env.LLM_API_KEY) && responderModelId),
      modelId: responderModelId || null,
      baseUrl: env.RESPONDER_API_BASE_URL || env.LLM_API_BASE_URL || (responderProvider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : null),
    },
    translation: {
      provider: 'lara',
      configured: Boolean(env.LARA_ACCESS_KEY_ID && env.LARA_ACCESS_KEY_SECRET && env.LARA_API_BASE_URL),
      baseUrl: env.LARA_API_BASE_URL || null,
    },
    instructionMonitor: {
      provider: 'postgres_pgvector',
      enabled: instructionMonitorConfig.INSTRUCTION_MONITOR_ENABLED,
      configured: Boolean(getInstructionMonitorConnectionString()),
      embeddingDimensions: instructionMonitorConfig.INSTRUCTION_MONITOR_EMBEDDING_DIMENSIONS,
      embeddings: {
        enabled: env.INSTRUCTION_MONITOR_EMBEDDINGS_ENABLED,
        configured: Boolean(embeddingsRuntime.baseUrl),
        source: embeddingsRuntime.source,
        baseUrl: embeddingsRuntime.baseUrl ? getOpenAiCompatibleEmbeddingsEndpoint(embeddingsRuntime.baseUrl) : null,
        modelId: embeddingsRuntime.modelId || null,
        maxChunks: env.INSTRUCTION_MONITOR_EMBEDDINGS_MAX_CHUNKS,
      },
    },
  });
});

// Analyst review route:
// stores only explicit Reviewed + Adversarial audit decisions in the pgvector
// corpus. The monitor still enforces the same invariant internally.
app.post('/v1/instruction-monitor/reviewed-adversarial', requireBackendAuth, async (
  req: AuthenticatedRequest,
  res: Response<ReviewedAdversarialInstructionResponse | { error: string }>,
) => {
  const parsed = ReviewedAdversarialInstructionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid reviewed adversarial instruction request.' });
    return;
  }

  try {
    const observation = await observeReviewedAdversarialInstruction(parsed.data);
    if (!observation) {
      res.status(503).json({ error: 'Instruction monitor is unavailable.' });
      return;
    }
    res.json({
      status: 'OBSERVED',
      recordId: observation.record.id,
      embedded: observation.embedded,
      chunkCount: observation.chunkCount,
      ...(observation.embeddingDurationMs !== undefined ? { embeddingDurationMs: observation.embeddingDurationMs } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to store reviewed adversarial instruction.';
    log('warn', 'reviewed_adversarial_instruction_observe_failed', {
      logId: parsed.data.logId,
      error: message,
    });
    res.status(409).json({ error: message });
  }
});

app.get('/v1/instruction-monitor/records/:identifier', requireBackendAuth, async (
  req: AuthenticatedRequest,
  res: Response<Awaited<ReturnType<PgvectorInstructionMonitor['lookupRecord']>> | { error: string }>,
) => {
  const rawIdentifier = req.params.identifier;
  const identifier = (Array.isArray(rawIdentifier) ? rawIdentifier[0] : rawIdentifier)?.trim();
  if (!identifier || identifier.length > 256) {
    res.status(400).json({ error: 'Invalid instruction record identifier.' });
    return;
  }

  try {
    const monitor = await getInstructionMonitor();
    if (!monitor) {
      res.status(503).json({ error: 'Instruction monitor is unavailable.' });
      return;
    }
    const record = await monitor.lookupRecord(identifier);
    if (!record) {
      res.status(404).json({ error: 'Instruction record was not found.' });
      return;
    }
    res.json(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to look up instruction record.';
    log('warn', 'instruction_record_lookup_failed', { identifier, error: message });
    res.status(500).json({ error: message });
  }
});

// Firewall intercept route:
// validates input, sanitizes the prompt, and returns a governed decision that the
// frontend can treat as clean, queued, or intercepted without calling a model directly.
app.post('/v1/intercept', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<InterceptResponse | { error: string; upstreamStatus?: number }>) => {
  const parsed = InterceptRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid intercept request.' });
    return;
  }

  const requestId = crypto.randomUUID();
  const gatewayStartedAt = Date.now();
  const input = parsed.data;
  const sanitization = sanitizePrompt(input.prompt, input.tuning);
  const instructionSimilarityEvaluation = input.metadata?.instructionSimilarityEnabled === false
    ? undefined
    : await evaluateInstructionSimilarity({ requestId, input, sanitization });
  const instructionSimilarity = instructionSimilarityEvaluation?.result;
  const instructionEmbeddingDurationMs = instructionSimilarityEvaluation?.embeddingDurationMs;
  const instructionSimilarityRisk = instructionSimilarity?.highestRisk ?? 'low';
  const instructionSimilaritySummary = summarizeInstructionSimilarity(instructionSimilarity);
  const effectiveLocalVerdict = instructionSimilarityRisk === 'high' || sanitization.verdict === 'ADVERSARIAL'
    ? 'ADVERSARIAL'
    : instructionSimilarityRisk === 'medium' || sanitization.verdict === 'SUSPICIOUS'
      ? 'SUSPICIOUS'
      : 'CLEAN';
  const effectiveDetectionFlags = instructionSimilarityRisk === 'low'
    ? sanitization.detectionFlags
    : Array.from(new Set([
        ...sanitization.detectionFlags,
        'INSTRUCTION_SIMILARITY_MATCH',
        `INSTRUCTION_SIMILARITY_${instructionSimilarityRisk.toUpperCase()}`,
      ]));
  const instructionSimilarityReason = instructionSimilarityRisk === 'low'
    ? ''
    : ` Similarity monitor found ${instructionSimilarityRisk}-risk overlap with stored instruction hash ${shortHash(instructionSimilarity?.matches[0]?.targetHash)}.`;
  const retryTag = tagRetry(sanitization.sanitized, gatewayStartedAt);
  const providerLlmRoutingEnabled = input.metadata?.providerLlmRoutingEnabled !== false;
  const responderLlmRoutingEnabled =
    providerLlmRoutingEnabled &&
    input.metadata?.responderLlmRoutingEnabled !== false;
  const localStatus = effectiveLocalVerdict === 'ADVERSARIAL'
    ? 'INTERCEPTED'
    : effectiveLocalVerdict === 'SUSPICIOUS'
      ? 'QUEUED'
      : 'CLEAN';
  const requiresGlobalPause = effectiveDetectionFlags.includes('ReDoS_ATTEMPT_DETECTED');

  const baseResponse: Omit<InterceptResponse, 'responder'> = {
    requestId,
    status: localStatus,
    ...(requiresGlobalPause ? { governanceAction: 'GLOBAL_PAUSE' } : {}),
    ...retryTag,
    sanitizedPrompt: sanitization.sanitized,
    detectionFlags: effectiveDetectionFlags,
    ...(instructionSimilaritySummary ? { instructionSimilarity: instructionSimilaritySummary } : {}),
    safeguards: {
      modelId: safeguardsModelId,
      verdict: effectiveLocalVerdict,
      analystReasoning: `${sanitization.analystReasoning}${instructionSimilarityReason}`,
      entropy: sanitization.entropy,
      globalEntropy: sanitization.globalEntropy,
      syntacticScore: sanitization.syntacticScore,
      latencyMs: sanitization.latencyMs,
      ...(instructionEmbeddingDurationMs !== undefined ? { instructionEmbeddingDurationMs } : {}),
      localPrecheckLatencyMs: sanitization.latencyMs,
      safeguardLatencyMs: 0,
      gatewayLatencyMs: Date.now() - gatewayStartedAt,
    },
  };

  if (effectiveLocalVerdict !== 'CLEAN') {
    interceptVerdictCounter.add(1, { status: localStatus, judge_verdict: effectiveLocalVerdict, stage: 'local' });
    log('info', 'intercept_local_decision', {
      requestId,
      promptHash: retryTag.promptHash,
      isRetry: retryTag.isRetry,
      retryOfHash: retryTag.retryOfHash,
      localVerdict: effectiveLocalVerdict,
      gatewayAction: localStatus,
      detectionFlags: effectiveDetectionFlags,
    });
    res.status(effectiveLocalVerdict === 'ADVERSARIAL' ? 403 : 202).json(baseResponse);
    return;
  }

  if (!providerLlmRoutingEnabled) {
    res.status(200).json(buildLocalInspectionInterceptResponse(baseResponse));
    return;
  }

  // A request-supplied safeguard key is a credential override; only honor it in dev.
  const requestedSafeguardApiKey = input.metadata?.safeguardApiKey;
  if (requestedSafeguardApiKey && appEnv !== 'dev') {
    log('warn', 'safeguard_api_key_override_ignored', { requestId, reason: 'request-supplied safeguard credential overrides are disabled outside dev.' });
  }
  const effectiveSafeguardApiKey = appEnv === 'dev' ? requestedSafeguardApiKey : undefined;

  let safeguardResponse = baseResponse;
  try {
    const safeguardResult = await generateSafeguardVerdict(
      sanitization.sanitized,
      sanitization,
      {
        apiKey: effectiveSafeguardApiKey,
        ...(input.metadata?.safeguardEffectivePrompt !== undefined
          ? { systemPrompt: input.metadata.safeguardEffectivePrompt }
          : {}),
      },
    );

    safeguardResponse = {
      ...baseResponse,
      status: safeguardResult.verdict === 'CLEAN'
        ? 'CLEAN'
        : safeguardResult.verdict === 'SUSPICIOUS'
          ? 'QUEUED'
          : 'INTERCEPTED',
      detectionFlags: safeguardResult.verdict === 'CLEAN'
        ? baseResponse.detectionFlags
        : Array.from(new Set([...baseResponse.detectionFlags, `SAFEGUARD_${safeguardResult.verdict}`])),
      safeguards: {
        ...baseResponse.safeguards,
        modelId: safeguardResult.modelId,
        verdict: safeguardResult.verdict,
        analystReasoning: safeguardResult.analystReasoning,
        latencyMs: Date.now() - gatewayStartedAt,
        localPrecheckLatencyMs: sanitization.latencyMs,
        safeguardLatencyMs: safeguardResult.latencyMs,
        gatewayLatencyMs: Date.now() - gatewayStartedAt,
        ...(safeguardResult.usage ? { usage: safeguardResult.usage } : {}),
      },
    };

    if (safeguardResult.verdict !== 'CLEAN') {
      emitSafeguardDecisionObservability({
        requestId,
        retryTag,
        responseShape: safeguardResult.responseShape,
        judgeVerdict: safeguardResult.verdict,
        gatewayAction: safeguardResponse.status,
        rawReasoningTrace: safeguardResult.rawReasoningTrace,
        latencyMs: safeguardResult.latencyMs,
      });
      res.status(safeguardResponse.status === 'QUEUED' ? 202 : 403).json(safeguardResponse);
      return;
    }
    emitSafeguardDecisionObservability({
      requestId,
      retryTag,
      responseShape: safeguardResult.responseShape,
      judgeVerdict: safeguardResult.verdict,
      gatewayAction: safeguardResponse.status,
      rawReasoningTrace: safeguardResult.rawReasoningTrace,
      latencyMs: safeguardResult.latencyMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Safeguard request failed.';
    const safeguardLatencyMs = Date.now() - gatewayStartedAt;
    const shieldResponse: Omit<InterceptResponse, 'responder'> = {
      ...baseResponse,
      status: 'SHIELD_ERROR',
      detectionFlags: Array.from(new Set([
        ...baseResponse.detectionFlags,
        error instanceof SafeguardTimeoutError ? 'SAFEGUARD_TIMEOUT' : 'SAFEGUARD_ERROR',
        'FAIL_SECURE',
      ])),
      safeguards: {
        ...baseResponse.safeguards,
        verdict: 'ADVERSARIAL',
        analystReasoning: error instanceof SafeguardTimeoutError
          ? 'Safeguard LLM timed out; traffic failed closed and requires manual review.'
          : 'Safeguard LLM failed; traffic failed closed and requires manual review.',
        latencyMs: safeguardLatencyMs,
        localPrecheckLatencyMs: sanitization.latencyMs,
        safeguardLatencyMs,
        gatewayLatencyMs: Date.now() - gatewayStartedAt,
      },
    };
    log('warn', 'safeguard_failed', {
      requestId,
      error: message,
      modelId: safeguardsModelId,
      gatewayAction: shieldResponse.status,
      latencyMs: safeguardLatencyMs,
    });
    res.status(202).json(shieldResponse);
    return;
  }

  if (!responderLlmRoutingEnabled) {
    res.status(200).json(buildLocalResponderPassthroughInterceptResponse({
      ...safeguardResponse,
      safeguards: {
        ...safeguardResponse.safeguards,
        gatewayLatencyMs: Date.now() - gatewayStartedAt,
      },
    }));
    return;
  }

  try {
    const responderResult = await generateResponderOutput(
      sanitization.sanitized,
    );
    const shielded = applyResponderOutputShield(responderResult, {
      requestId,
      route: 'intercept',
      ...(input.tuning?.blockedKeywords ? { blockedKeywords: input.tuning.blockedKeywords } : {}),
    });

    const response: InterceptResponse = {
      ...safeguardResponse,
      ...(shielded.outputDetectionFlags.length > 0
        ? { detectionFlags: Array.from(new Set([...safeguardResponse.detectionFlags, ...shielded.outputDetectionFlags])) }
        : {}),
      responder: shielded.responder,
    };

    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Responder request failed.';
    log('warn', 'responder_failed', {
      requestId,
      error: message,
      modelId: responderModelId,
      provider: responderProvider,
    });
    res.status(502).json({
      error: message,
      upstreamStatus: error instanceof UpstreamResponderError ? error.status : undefined,
    });
  }
});

// Analysis routes: run the deterministic Shield only — no safeguard/responder LLM,
// no instruction-similarity lookup, no provider egress. This is the server-side
// home of what the browser used to compute locally (redaction, entropy, syntactic
// complexity, decode telemetry, verdict bands), so the analyst console can preview
// and inspect sanitization without shipping the engine to the client.
const AnalyzePromptRequestSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  tuning: z.object({
    entropyThreshold: z.number().min(3).max(4.6).optional(),
    syntacticThreshold: z.number().min(40).max(90).optional(),
    blockedKeywords: z.array(z.string()).optional(),
    forbiddenTopics: z.array(z.string()).optional(),
    regexRules: z.array(z.string()).optional(),
  }).optional(),
});

app.post('/v1/analyze', requireBackendAuth, (req: AuthenticatedRequest, res: Response<BackendSanitizationResult | { error: string }>) => {
  const parsed = AnalyzePromptRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid analyze request.' });
    return;
  }
  res.status(200).json(sanitizePrompt(parsed.data.prompt, parsed.data.tuning));
});

const AnalyzeOutputRequestSchema = z.object({
  text: z.string().max(50_000),
  blockedKeywords: z.array(z.string()).optional(),
});

app.post('/v1/analyze/output', requireBackendAuth, (req: AuthenticatedRequest, res: Response<OutputSanitizationResult | { error: string }>) => {
  const parsed = AnalyzeOutputRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid output analyze request.' });
    return;
  }
  res.status(200).json(sanitizeOutput(parsed.data.text, { blockedKeywords: parsed.data.blockedKeywords }));
});

// Full prompt analysis for the Playground: deterministic Shield sanitization +
// standalone syntactic-complexity scoring + the research-only feature vector, in
// one round-trip. Same engines as /v1/analyze, no LLM/egress.
const AnalyzeFullRequestSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  tuning: z.object({
    entropyThreshold: z.number().min(3).max(4.6).optional(),
    syntacticThreshold: z.number().min(40).max(90).optional(),
    blockedKeywords: z.array(z.string()).optional(),
    forbiddenTopics: z.array(z.string()).optional(),
    regexRules: z.array(z.string()).optional(),
  }).optional(),
});

app.post('/v1/analyze/full', requireBackendAuth, (req: AuthenticatedRequest, res: Response<{ sanitization: BackendSanitizationResult; syntactic: ReturnType<typeof analyzeSyntacticComplexity>; featureVector: ReturnType<typeof buildPromptFeatureVector> } | { error: string }>) => {
  const parsed = AnalyzeFullRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid analyze request.' });
    return;
  }
  const { prompt, tuning } = parsed.data;
  const entropyThreshold = tuning?.entropyThreshold ?? 4.0;
  const syntacticThreshold = tuning?.syntacticThreshold ?? 65;
  const sanitization = sanitizePrompt(prompt, tuning);
  const syntactic = analyzeSyntacticComplexity(prompt, syntacticThreshold);
  const featureVector = buildPromptFeatureVector({ prompt, sanitization, entropyThreshold, syntacticThreshold, syntactic });
  res.status(200).json({ sanitization, syntactic, featureVector });
});

// Obfuscation lab: GET returns the technique catalog (metadata only — the
// transform functions don't cross the wire); POST returns generated variants —
// one technique by id, or a whole category ('all' for everything).
app.get('/v1/analyze/obfuscate', requireBackendAuth, (_req: AuthenticatedRequest, res: Response) => {
  res.status(200).json({
    categories: OBFUSCATION_CATEGORIES,
    techniques: OBFUSCATION_TECHNIQUES.map(({ id, name, category, atlasId }) => ({ id, name, category, atlasId })),
  });
});

const ObfuscateRequestSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  techniqueId: z.string().min(1).optional(),
  category: z.enum(['all', 'encoding', 'cipher', 'unicode', 'injection', 'language']).optional(),
});

app.post('/v1/analyze/obfuscate', requireBackendAuth, (req: AuthenticatedRequest, res: Response) => {
  const parsed = ObfuscateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid obfuscation request.' });
    return;
  }
  const { prompt, techniqueId, category } = parsed.data;
  let variants: ObfuscatedVariant[];
  if (techniqueId) {
    const variant = applyObfuscationTechnique(prompt, techniqueId);
    variants = variant ? [variant] : [];
  } else {
    variants = generateObfuscationVariants(prompt, (category ?? 'all') as ObfuscationCategory | 'all');
  }
  res.status(200).json({
    variants: variants.map((v) => ({
      technique: { id: v.technique.id, name: v.technique.name, category: v.technique.category, atlasId: v.technique.atlasId },
      result: v.result,
    })),
  });
});

// Heuristic spelling normalization (the deterministic mode only — the LanguageTool
// mode is intentionally not exposed; it would make an outbound HTTP call).
const NormalizeRequestSchema = z.object({
  text: z.string().max(50_000),
});

app.post('/v1/analyze/normalize', requireBackendAuth, (req: AuthenticatedRequest, res: Response<NormalizationResult | { error: string }>) => {
  const parsed = NormalizeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid normalize request.' });
    return;
  }
  res.status(200).json(normalizeWithHeuristicSync(parsed.data.text));
});

// Audit-log store (Postgres-backed; Phase 3 of the server-hosted rewrite). The
// analyst console is rewired to read/write these in a follow-up; for now this is
// additive. Per-user write keying is the authenticated caller; reads return the
// shared trail (optionally filtered). Returns 503 when no DATABASE_URL is configured.
function requireAuditStore(res: Response): boolean {
  if (isAuditStoreConfigured()) return true;
  res.status(503).json({ error: 'Audit log store is not configured (set AUDIT_DATABASE_URL or DATABASE_URL).' });
  return false;
}

const AppendAuditLogRequestSchema = z.object({
  sanitizedPrompt: z.string(),
  detectionFlags: z.array(z.string()),
}).passthrough();

app.post('/v1/audit-logs', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<AuditLogRow | { error: string }>) => {
  if (!requireAuditStore(res)) return;
  const callerId = getAuthenticatedCallerId(req, res);
  if (!callerId) return;
  const parsed = AppendAuditLogRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid audit log payload.' });
    return;
  }
  try {
    const row = await appendAuditLog(callerId, parsed.data as Record<string, unknown>);
    res.status(201).json(row);
  } catch (error) {
    log('warn', 'audit_log_append_failed', { requestId: res.locals.requestId, error: error instanceof Error ? error.message : 'append error' });
    res.status(500).json({ error: 'Failed to store audit log.' });
  }
});

const ListAuditLogsQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  sinceTimestamp: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

app.get('/v1/audit-logs', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<{ logs: AuditLogRow[] } | { error: string }>) => {
  if (!requireAuditStore(res)) return;
  const parsed = ListAuditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid audit log query.' });
    return;
  }
  try {
    const logs = await listAuditLogs({
      ...(parsed.data.userId ? { userId: parsed.data.userId } : {}),
      ...(parsed.data.sinceTimestamp ? { sinceTimestamp: parsed.data.sinceTimestamp } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    });
    res.status(200).json({ logs });
  } catch (error) {
    log('warn', 'audit_log_list_failed', { requestId: res.locals.requestId, error: error instanceof Error ? error.message : 'list error' });
    res.status(500).json({ error: 'Failed to read audit logs.' });
  }
});

app.patch('/v1/audit-logs/:id', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<AuditLogRow | { error: string }>) => {
  if (!requireAuditStore(res)) return;
  if (!getAuthenticatedCallerId(req, res)) return;
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: 'Invalid audit log id.' });
    return;
  }
  const parsed = z.record(z.string(), z.unknown()).safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'Invalid audit log patch.' });
    return;
  }
  try {
    const row = await patchAuditLog(id, parsed.data);
    if (!row) {
      res.status(404).json({ error: 'Audit log not found.' });
      return;
    }
    res.status(200).json(row);
  } catch (error) {
    log('warn', 'audit_log_patch_failed', { requestId: res.locals.requestId, error: error instanceof Error ? error.message : 'patch error' });
    res.status(500).json({ error: 'Failed to update audit log.' });
  }
});

const ClearAuditLogsQuerySchema = z.object({ userId: z.string().min(1).optional() });

app.delete('/v1/audit-logs', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<{ deleted: number } | { error: string }>) => {
  if (!requireAuditStore(res)) return;
  if (!getAuthenticatedCallerId(req, res)) return;
  const parsed = ClearAuditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid clear query.' });
    return;
  }
  try {
    const deleted = await clearAuditLogs(parsed.data.userId ? { userId: parsed.data.userId } : {});
    res.status(200).json({ deleted });
  } catch (error) {
    log('warn', 'audit_log_clear_failed', { requestId: res.locals.requestId, error: error instanceof Error ? error.message : 'clear error' });
    res.status(500).json({ error: 'Failed to clear audit logs.' });
  }
});

// /v1/metrics/aggregate — Phase 3 step 3.
//
// Runs `detectThreatSpikes` + `calculateFalsePositiveMetrics` over the audit-log
// rows in Postgres so the analyst console's Metrics view doesn't need its own
// Firestore audit-log query plus client-side analytics. The two analytics
// functions live in backend/src/analysis/{anomalyDetector,metrics}.ts (moved
// from src/lib/ in this step). The endpoint reads through `listAuditLogs`
// (capped at 5000 rows to keep response latency bounded), applies an
// "effective detection level" mapping per the operator-supplied
// `entropyThreshold` so the analytics agree with what the dashboard renders,
// then runs the two pure analytics over the resulting arrays.
//
// Display-side bucketing (24-hour threat trend chart, severity stacked chart,
// operational metrics, latency P95, etc.) stays client-side in ThreatDashboard
// for now — only the two named modules moved.
const SUSPICIOUS_ENTROPY_THRESHOLD_FOR_METRICS = 3.8;

function getEffectiveDetectionLevelForMetrics(
  baseDetectionLevel: number,
  entropy: number,
  configuredEntropyThreshold: number | undefined,
): number {
  if (typeof configuredEntropyThreshold === 'number' && Number.isFinite(entropy)) {
    if (entropy > configuredEntropyThreshold) return Math.max(baseDetectionLevel, 3);
    if (entropy > SUSPICIOUS_ENTROPY_THRESHOLD_FOR_METRICS) return Math.max(baseDetectionLevel, 2);
  }
  return baseDetectionLevel;
}

const MetricsAggregateRequestSchema = z.object({
  sinceTimestamp: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  entropyThreshold: z.number().min(3).max(4.6).optional(),
  limit: z.number().int().min(1).max(5000).optional(),
}).strict();

interface MetricsAggregateResponse {
  anomaly: ReturnType<typeof detectThreatSpikes>;
  fpr: ReturnType<typeof calculateFalsePositiveMetrics>;
  sampleSize: number;
}

app.post('/v1/metrics/aggregate', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<MetricsAggregateResponse | { error: string }>) => {
  // Validate the request body first so malformed inputs always 400 even if the
  // audit store happens to be unconfigured (which would 503 below).
  const parsed = MetricsAggregateRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid metrics aggregate request.' });
    return;
  }
  if (!requireAuditStore(res)) return;
  if (!getAuthenticatedCallerId(req, res)) return;
  const { sinceTimestamp, source, entropyThreshold, limit } = parsed.data;
  // Default window: last 24 hours, which is what the Metrics dashboard renders.
  const effectiveSinceTimestamp = sinceTimestamp ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const rows = await listAuditLogs({
      sinceTimestamp: effectiveSinceTimestamp,
      limit: limit ?? 1000,
    });
    const threatLogs: ThreatLog[] = [];
    const metricsLogs: AuditLogMetrics[] = [];
    for (const row of rows) {
      const record = row.record as Record<string, unknown>;
      if (source && source !== 'all' && record.source !== source) continue;
      const baseDetectionLevel = typeof record.detectionLevel === 'number' ? record.detectionLevel : 0;
      const entropy = typeof record.entropy === 'number' ? record.entropy : 0;
      const effectiveDetectionLevel = getEffectiveDetectionLevelForMetrics(baseDetectionLevel, entropy, entropyThreshold);
      // Anomaly detection only cares about threat-level rows (>=2).
      if (effectiveDetectionLevel >= 2) {
        threatLogs.push({
          userId: row.userId,
          detectionLevel: effectiveDetectionLevel,
          timestamp: new Date(row.timestamp),
        });
      }
      // FPR/FNR uses the full window (reviewed + unreviewed; the metrics
      // module filters reviewed-only inside).
      metricsLogs.push({
        id: row.id,
        detectionLevel: effectiveDetectionLevel,
        resultantSeverity: typeof record.resultantSeverity === 'string' ? record.resultantSeverity as AuditLogMetrics['resultantSeverity'] : undefined,
        reviewed: record.reviewed === true,
      });
    }
    const anomaly = detectThreatSpikes(threatLogs);
    const fpr = calculateFalsePositiveMetrics(metricsLogs);
    res.status(200).json({ anomaly, fpr, sampleSize: rows.length });
  } catch (error) {
    log('warn', 'metrics_aggregate_failed', { requestId: res.locals.requestId, error: error instanceof Error ? error.message : 'aggregate error' });
    res.status(500).json({ error: 'Failed to aggregate metrics.' });
  }
});

// Governance config (HITL toggle, Global Pause, entropy / syntactic thresholds).
// Phase 3 step 4: this doc used to live in Firestore (`config/governance`); it now
// rides on the shared `app_config` table via the configStore. PUT is currently
// gated only by the shared bearer token + caller-id header — admin-only role
// enforcement is deferred to step 3 (user_profiles), where the role check
// primitive will be added and back-applied here.
function requireConfigStore(res: Response): boolean {
  if (isConfigStoreConfigured()) return true;
  res.status(503).json({ error: 'App config store is not configured (set APP_CONFIG_DATABASE_URL or DATABASE_URL).' });
  return false;
}

const GovernanceConfigSchema = z.object({
  isHitlActive: z.boolean(),
  isGlobalPause: z.boolean(),
  // Floor matches the frontend's SUSPICIOUS_ENTROPY_THRESHOLD (3.8) and the
  // sanitizer's hard-coded suspicious band. Ceiling matches the analyst console
  // slider range. The metrics-aggregate route clamps the same way.
  entropyThreshold: z.number().min(3).max(4.6),
  syntacticThreshold: z.number().min(40).max(90),
}).strict();
type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  isHitlActive: false,
  isGlobalPause: false,
  entropyThreshold: 4.0,
  syntacticThreshold: 65,
};

const GOVERNANCE_CONFIG_KEY = 'governance';

app.get('/v1/governance', requireBackendAuth, async (_req: AuthenticatedRequest, res: Response<GovernanceConfig | { error: string }>) => {
  if (!requireConfigStore(res)) return;
  try {
    const row = await getConfig<unknown>(GOVERNANCE_CONFIG_KEY);
    if (!row) {
      // No row yet: return the defaults rather than seeding on read, so a stale
      // GET doesn't write back arbitrary values. The first PUT (which the UI
      // does on any toggle change) materializes the row.
      res.status(200).json(DEFAULT_GOVERNANCE_CONFIG);
      return;
    }
    const parsed = GovernanceConfigSchema.safeParse(row.value);
    if (!parsed.success) {
      // Stored value drifted from the schema (older app version, manual edit).
      // Fall back to defaults rather than 500ing the dashboard.
      log('warn', 'governance_config_parse_failed', { requestId: res.locals.requestId, error: parsed.error.message });
      res.status(200).json(DEFAULT_GOVERNANCE_CONFIG);
      return;
    }
    res.status(200).json(parsed.data);
  } catch (error) {
    log('warn', 'governance_config_get_failed', { requestId: res.locals.requestId, error: error instanceof Error ? error.message : 'get error' });
    res.status(500).json({ error: 'Failed to read governance config.' });
  }
});

app.put('/v1/governance', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<GovernanceConfig | { error: string }>) => {
  // Validate body first so malformed inputs always 400, even when the store
  // happens to be unconfigured (same ordering as /v1/metrics/aggregate).
  const parsed = GovernanceConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid governance config.' });
    return;
  }
  if (!requireConfigStore(res)) return;
  const callerId = getAuthenticatedCallerId(req, res);
  if (!callerId) return;
  try {
    const row = await putConfig<GovernanceConfig>(GOVERNANCE_CONFIG_KEY, parsed.data, callerId);
    res.status(200).json(row.value);
  } catch (error) {
    log('warn', 'governance_config_put_failed', { requestId: res.locals.requestId, error: error instanceof Error ? error.message : 'put error' });
    res.status(500).json({ error: 'Failed to update governance config.' });
  }
});

// System configuration (safeguard / firewall / responder / Sam Spade prompts +
// blocked keywords / forbidden topics / regex rules / guardrails policy).
// Phase 3 step 4: this doc used to live at Firestore `config/system`; it now
// rides on the same Postgres app_config table as governance, keyed `system`.
// The frontend owns normalization (parseSystemConfig migrates legacy field
// names and bundled defaults); the backend just validates the normalized
// 9-field shape and stores the JSON.
//
// Auth posture matches /v1/governance: shared-bearer + caller-id header today.
// Admin-only role enforcement is deferred to step 3 of this plan
// (user_profiles), where the role-check primitive will land and back-apply
// here.
const SystemConfigSchema = z.object({
  safeguardEffectivePromptOverride: z.string(),
  firewallPrompt: z.string(),
  responderPrompt: z.string(),
  samSpadePersonaPrompt: z.string(),
  samSpadeScenarioPrompt: z.string(),
  guardrailsPolicy: z.string(),
  blockedKeywords: z.string(),
  forbiddenTopics: z.string(),
  regexRules: z.string(),
});
type SystemConfigDto = z.infer<typeof SystemConfigSchema>;

const SYSTEM_CONFIG_KEY = 'system';

app.get('/v1/system-config', requireBackendAuth, async (_req: AuthenticatedRequest, res: Response<SystemConfigDto | null | { error: string }>) => {
  if (!requireConfigStore(res)) return;
  try {
    const row = await getConfig<unknown>(SYSTEM_CONFIG_KEY);
    if (!row) {
      // No row yet: return null so the frontend uses DEFAULT_SYSTEM_CONFIG
      // (which holds the bundled prompt blobs). First PUT materializes the row.
      res.status(200).json(null);
      return;
    }
    const parsed = SystemConfigSchema.safeParse(row.value);
    if (!parsed.success) {
      // Stored value drifted from the schema (older app version, manual edit).
      // Return null so the frontend falls back to defaults rather than 500ing
      // the admin dialog.
      log('warn', 'system_config_parse_failed', { requestId: res.locals.requestId, error: parsed.error.message });
      res.status(200).json(null);
      return;
    }
    res.status(200).json(parsed.data);
  } catch (error) {
    log('warn', 'system_config_get_failed', { requestId: res.locals.requestId, error: error instanceof Error ? error.message : 'get error' });
    res.status(500).json({ error: 'Failed to read system config.' });
  }
});

app.put('/v1/system-config', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<SystemConfigDto | { error: string }>) => {
  // Validate body first so malformed inputs always 400 (matches /v1/governance).
  const parsed = SystemConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid system config.' });
    return;
  }
  if (!requireConfigStore(res)) return;
  const callerId = getAuthenticatedCallerId(req, res);
  if (!callerId) return;
  try {
    const row = await putConfig<SystemConfigDto>(SYSTEM_CONFIG_KEY, parsed.data, callerId);
    res.status(200).json(row.value);
  } catch (error) {
    log('warn', 'system_config_put_failed', { requestId: res.locals.requestId, error: error instanceof Error ? error.message : 'put error' });
    res.status(500).json({ error: 'Failed to update system config.' });
  }
});

// Translation proxy route:
// keeps provider keys on the server side and gives the Playground a single stable
// API shape no matter which translation vendor is in use.
app.post('/v1/translate', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<TranslateResponse | { error: string }>) => {
  const parsed = TranslateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid translation request.' });
    return;
  }

  try {
    const translation = await translateText(parsed.data);
    res.status(200).json(translation);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation request failed.';
    log('warn', 'translation_failed', {
      requestId: res.locals.requestId,
      provider: parsed.data.provider,
      error: message,
    });
    res.status(502).json({ error: message });
  }
});

// Sam Spade review-artifact feed.
// The standalone CTF frontend POSTs each turn's review artifact here so the main
// Counter-Spy frontend (which no longer drives the CTF API) can poll for them and
// mirror CTF activity into its Audit/Metrics surfaces. Backed by SQLite
// (backend/src/ctf/reviewArtifactStore.ts) so a restart doesn't drop the queue.
const CtfReviewArtifactIngestSchema = z.object({ artifact: SamSpadeReviewArtifactSchema }).strict();
const CtfReviewArtifactListQuerySchema = z.object({
  sinceTimestamp: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
}).partial();

app.post('/v1/ctf/review-artifacts', requireBackendAuth, (req: AuthenticatedRequest, res: Response<{ ok: true } | { error: string }>) => {
  const parsed = CtfReviewArtifactIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid review artifact payload.' });
    return;
  }
  const artifact = parsed.data.artifact;
  appendCtfReviewArtifact(artifact);
  emitMetricIncrement('ctf.review_artifact', { action: artifact.action, detectionLevel: artifact.detectionLevel, escalated: artifact.escalationRecommended });
  log('info', 'ctf_review_artifact', {
    requestId: res.locals.requestId,
    artifactRequestId: artifact.requestId,
    sessionId: artifact.sessionId,
    action: artifact.action,
    detectionLevel: artifact.detectionLevel,
    escalationRecommended: artifact.escalationRecommended,
    detectionFlags: artifact.detectionFlags,
  });
  res.status(202).json({ ok: true });
});

app.get('/v1/ctf/review-artifacts', requireBackendAuth, (req: AuthenticatedRequest, res: Response<{ artifacts: SamSpadeReviewArtifact[] } | { error: string }>) => {
  const parsed = CtfReviewArtifactListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid review artifact query.' });
    return;
  }
  const artifacts = listCtfReviewArtifacts({
    ...(parsed.data.sinceTimestamp ? { sinceTimestamp: parsed.data.sinceTimestamp } : {}),
    ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
  });
  res.status(200).json({ artifacts });
});

// Analyst console: server-render the React app and serve its built assets from the
// gateway itself. Mounted after every /v1 route (so API paths win) and before the
// JSON 404 handler.
mountWebApp(app, { isDev: appEnv === 'dev' });
// Best-effort: create the audit_logs table at boot if Postgres is configured.
// The /v1/audit-logs routes 503 when it isn't, so this never blocks startup.
void initAuditStore().catch((error) => log('warn', 'audit_store_init_failed', { error: error instanceof Error ? error.message : 'init error' }));
// Same pattern for the app_config table that backs governance + system config.
void initConfigStore().catch((error) => log('warn', 'config_store_init_failed', { error: error instanceof Error ? error.message : 'init error' }));

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found.' });
});

export { app };

if (process.env.COUNTER_SPY_DISABLE_SERVER_LISTEN !== 'true') {
  app.listen(port, '0.0.0.0', () => {
    log('info', 'backend_listening', {
      port,
      safeguardsModelId,
      responderModelId,
    });
  });
}

/**
 * Frontend client for the local Counter-Spy backend.
 * Centralizes fetch calls, runtime response validation, and the shared Sam Spade
 * session contracts so the UI does not hard-code backend payload shapes.
 */
import { z } from 'zod';

const BACKEND_INTERCEPT_TIMEOUT_MS = 45_000;

// Zod schemas keep backend responses honest before they enter React state.
const BackendInterceptResponseSchema = z.object({
  requestId: z.string(),
  status: z.enum(['CLEAN', 'QUEUED', 'INTERCEPTED', 'SHIELD_ERROR']),
  governanceAction: z.literal('GLOBAL_PAUSE').optional(),
  sanitizedPrompt: z.string(),
  detectionFlags: z.array(z.string()),
  instructionSimilarity: z.object({
    highestRisk: z.enum(['medium', 'high']),
    matchCount: z.number(),
    topMatch: z.object({
      targetId: z.string(),
      targetHash: z.string(),
      source: z.enum(['analyst_chat', 'bulk_ingest', 'ctf_chat', 'ctf_solve', 'playground', 'system']),
      targetVerdict: z.enum(['CLEAN', 'SUSPICIOUS', 'ADVERSARIAL']).nullable(),
      risk: z.enum(['low', 'medium', 'high']),
      matchReasons: z.array(z.string()),
      hammingDistance: z.number(),
      hammingDistance2gram: z.number(),
      hammingDistance4gram: z.number(),
      cosineSimilarity: z.number().nullable(),
      maxChunkSimilarity: z.number().nullable(),
      attentionPooledChunkSimilarity: z.number().nullable(),
      sandwichDelta: z.number().nullable(),
    }).optional(),
  }).optional(),
  safeguards: z.object({
    modelId: z.string(),
    verdict: z.enum(['CLEAN', 'SUSPICIOUS', 'ADVERSARIAL']),
    analystReasoning: z.string(),
    entropy: z.number(),
    globalEntropy: z.number(),
    syntacticScore: z.number(),
    latencyMs: z.number(),
    instructionEmbeddingDurationMs: z.number().optional(),
    localPrecheckLatencyMs: z.number().optional(),
    safeguardLatencyMs: z.number().optional(),
    gatewayLatencyMs: z.number().optional(),
    usage: z.object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    }).optional(),
  }),
  responder: z.object({
    provider: z.enum(['openai_compatible', 'gemini']).optional(),
    modelId: z.string(),
    status: z.enum(['COMPLETED', 'DISABLED_LOCAL_ONLY']),
    latencyMs: z.number(),
    response: z.string(),
    usage: z.object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    }).optional(),
  }).optional(),
});

const BackendTranslateResponseSchema = z.object({
  text: z.string(),
  original: z.string(),
  sourceLang: z.string(),
  targetLang: z.string(),
  targetLangName: z.string(),
  provider: z.enum(['lara']),
});

const BackendHealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  environment: z.string(),
  safeguards: z.object({
    provider: z.literal('openai_compatible'),
    configured: z.boolean(),
    modelId: z.string().nullable(),
    baseUrl: z.string().nullable(),
  }).optional(),
  responder: z.object({
    provider: z.enum(['openai_compatible', 'gemini']).optional(),
    configured: z.boolean(),
    modelId: z.string().nullable(),
    baseUrl: z.string().nullable(),
  }).optional(),
  translation: z.object({
    provider: z.literal('lara'),
    configured: z.boolean(),
    baseUrl: z.string().nullable(),
  }).optional(),
});

const ReviewedAdversarialInstructionResponseSchema = z.object({
  status: z.literal('OBSERVED'),
  recordId: z.string(),
  embedded: z.boolean(),
  chunkCount: z.number(),
  embeddingDurationMs: z.number().optional(),
});

const InstructionMonitorRecordSchema = z.object({
  id: z.string(),
  source: z.enum(['analyst_chat', 'bulk_ingest', 'ctf_chat', 'ctf_solve', 'playground', 'system']),
  rawText: z.string(),
  normalizedText: z.string(),
  sha256: z.string(),
  sha256Loose: z.string(),
  simhash: z.string(),
  simhash2gram: z.string(),
  simhash4gram: z.string(),
  verdict: z.enum(['CLEAN', 'SUSPICIOUS', 'ADVERSARIAL']).nullable(),
  detectionFlags: z.array(z.string()),
  reviewed: z.boolean(),
  labels: z.array(z.string()),
  seedPack: z.string().nullable(),
  seedVersion: z.string().nullable(),
  seedSource: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  chunks: z.array(z.object({
    chunkIndex: z.number(),
    chunkText: z.string(),
    chunkHash: z.string().nullable(),
    intentScore: z.number(),
  })),
});

const SamSpadeMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['player', 'npc', 'system']),
  text: z.string(),
  createdAt: z.string(),
  reviewDisposition: z.enum(['clean', 'intercepted', 'queued']),
});

const SamSpadeReviewArtifactSchema = z.object({
  requestId: z.string(),
  sessionId: z.string(),
  source: z.literal('ctf_chat'),
  action: z.enum(['message', 'solve']),
  timestamp: z.string(),
  sanitizedPrompt: z.string(),
  detectionFlags: z.array(z.string()),
  entropy: z.number(),
  globalEntropy: z.number(),
  suspiciousChunks: z.array(z.string()),
  detectionLevel: z.enum(['Clean', 'Informational', 'Suspicious', 'Adversarial']),
  escalationRecommended: z.boolean(),
  response: z.string(),
  analystReasoning: z.string(),
  latencyMs: z.number(),
  decodeTelemetry: z.enum(['plain_text', 'single_hop_decode', 'recursive_decode']),
  status: z.enum(['REVIEWED', 'PENDING_REVIEW']),
  responderPromptProfile: z.literal('sam_spade_ctf').optional(),
  responderProvider: z.enum(['openai_compatible', 'gemini']).optional(),
  responderModel: z.string().optional(),
  responderStatus: z.string().optional(),
  responderLatencyMs: z.number().optional(),
});

const SamSpadeSessionSchema = z.object({
  sessionId: z.string(),
  caseId: z.string(),
  ownerUserId: z.string(),
  status: z.enum(['ACTIVE', 'SOLVED', 'INTERCEPTED']),
  createdAt: z.string(),
  updatedAt: z.string(),
  solvedAt: z.string().optional(),
  messages: z.array(SamSpadeMessageSchema),
  lastReview: SamSpadeReviewArtifactSchema.optional(),
});

const SamSpadeSessionResponseSchema = z.object({
  session: SamSpadeSessionSchema,
});

const SamSpadeMessageResponseSchema = z.object({
  session: SamSpadeSessionSchema,
  review: SamSpadeReviewArtifactSchema,
});

const SamSpadeSolveResponseSchema = z.object({
  session: SamSpadeSessionSchema,
  solved: z.boolean(),
  evaluation: z.string(),
  review: SamSpadeReviewArtifactSchema,
});

export interface BackendInterceptResponse {
  requestId: string;
  status: 'CLEAN' | 'QUEUED' | 'INTERCEPTED' | 'SHIELD_ERROR';
  governanceAction?: 'GLOBAL_PAUSE';
  sanitizedPrompt: string;
  detectionFlags: string[];
  instructionSimilarity?: {
    highestRisk: 'medium' | 'high';
    matchCount: number;
    topMatch?: {
      targetId: string;
      targetHash: string;
      source: 'analyst_chat' | 'bulk_ingest' | 'ctf_chat' | 'ctf_solve' | 'playground' | 'system';
      targetVerdict: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL' | null;
      risk: 'low' | 'medium' | 'high';
      matchReasons: string[];
      hammingDistance: number;
      hammingDistance2gram: number;
      hammingDistance4gram: number;
      cosineSimilarity: number | null;
      maxChunkSimilarity: number | null;
      attentionPooledChunkSimilarity: number | null;
      sandwichDelta: number | null;
    };
  };
  safeguards: {
    modelId: string;
    verdict: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL';
    analystReasoning: string;
    entropy: number;
    globalEntropy: number;
    syntacticScore: number;
    latencyMs: number;
    instructionEmbeddingDurationMs?: number;
    localPrecheckLatencyMs?: number;
    safeguardLatencyMs?: number;
    gatewayLatencyMs?: number;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  };
  responder?: {
    provider?: 'openai_compatible' | 'gemini';
    modelId: string;
    status: 'COMPLETED' | 'DISABLED_LOCAL_ONLY';
    latencyMs: number;
    response: string;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  };
}

export interface BackendTranslateResponse {
  text: string;
  original: string;
  sourceLang: string;
  targetLang: string;
  targetLangName: string;
  provider: 'lara';
}

export interface BackendHealthResponse {
  ok: boolean;
  service: string;
  environment: string;
  safeguards?: {
    provider: 'openai_compatible';
    configured: boolean;
    modelId: string | null;
    baseUrl: string | null;
  };
  responder?: {
    provider?: 'openai_compatible' | 'gemini';
    configured: boolean;
    modelId: string | null;
    baseUrl: string | null;
  };
  translation?: {
    provider: 'lara';
    configured: boolean;
    baseUrl: string | null;
  };
}

export interface ReviewedAdversarialInstructionResponse {
  status: 'OBSERVED';
  recordId: string;
  embedded: boolean;
  chunkCount: number;
  embeddingDurationMs?: number;
}

export type InstructionMonitorRecord = z.infer<typeof InstructionMonitorRecordSchema>;

export interface SamSpadeMessage {
  id: string;
  role: 'player' | 'npc' | 'system';
  text: string;
  createdAt: string;
  reviewDisposition: 'clean' | 'intercepted' | 'queued';
}

export interface SamSpadeReviewArtifact {
  requestId: string;
  sessionId: string;
  source: 'ctf_chat';
  action: 'message' | 'solve';
  timestamp: string;
  sanitizedPrompt: string;
  detectionFlags: string[];
  entropy: number;
  globalEntropy: number;
  suspiciousChunks: string[];
  detectionLevel: 'Clean' | 'Informational' | 'Suspicious' | 'Adversarial';
  escalationRecommended: boolean;
  response: string;
  analystReasoning: string;
  latencyMs: number;
  decodeTelemetry: 'plain_text' | 'single_hop_decode' | 'recursive_decode';
  status: 'REVIEWED' | 'PENDING_REVIEW';
  responderPromptProfile?: 'sam_spade_ctf';
  responderProvider?: 'openai_compatible' | 'gemini';
  responderModel?: string;
  responderStatus?: string;
  responderLatencyMs?: number;
}

export interface SamSpadeSession {
  sessionId: string;
  caseId: string;
  ownerUserId: string;
  status: 'ACTIVE' | 'SOLVED' | 'INTERCEPTED';
  createdAt: string;
  updatedAt: string;
  solvedAt?: string;
  messages: SamSpadeMessage[];
  lastReview?: SamSpadeReviewArtifact;
}

// Resolve the configured backend base URL, trimming a trailing slash if present.
export function getBackendApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '';
}

// Fall back to same-origin calls when the frontend is using the local Vite proxy.
function resolveBackendUrl(path: string) {
  const apiBaseUrl = getBackendApiBaseUrl();
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
}

type BackendRequestMetadata = {
  localReviewMode?: boolean;
  source?: 'analyst_chat' | 'bulk_ingest' | 'ctf_chat' | 'ctf_solve' | 'playground' | 'system';
  providerLlmRoutingEnabled?: boolean;
  responderLlmRoutingEnabled?: boolean;
  instructionSimilarityEnabled?: boolean;
  safeguardApiKey?: string;
  safeguardEffectivePrompt?: string;
  instructionEmbedding?: number[];
  instructionChunks?: Array<{
    text: string;
    embedding: number[];
    intentScore?: number;
  }>;
};

type SamSpadeRequestMetadata = {
  localReviewMode?: boolean;
  providerLlmRoutingEnabled?: boolean;
  responderLlmRoutingEnabled?: boolean;
  safeguardEffectivePrompt?: string;
};

function getProtectedHeaders(callerUserId?: string): HeadersInit {
  const token = import.meta.env.VITE_BACKEND_BEARER_TOKEN?.trim();
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(callerUserId ? { 'x-counter-spy-user-id': callerUserId } : {}),
  };
}

async function fetchJsonWithTimeout(path: string, init?: RequestInit, timeoutMs: number = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(resolveBackendUrl(path), {
      ...init,
      signal: controller.signal,
    });
    const payload: unknown = await response.json();
    return { response, payload };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out while contacting the Counter-Spy backend.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Submit one prompt to the backend firewall intercept path.
export async function interceptPrompt(input: {
  prompt: string;
  userId?: string;
  sessionId?: string;
  metadata?: BackendRequestMetadata;
  tuning?: {
    entropyThreshold?: number;
    syntacticThreshold?: number;
    blockedKeywords?: string[];
    forbiddenTopics?: string[];
    regexRules?: string[];
  };
}): Promise<BackendInterceptResponse> {
  const { response, payload } = await fetchJsonWithTimeout('/v1/intercept', {
    method: 'POST',
    headers: getProtectedHeaders(input.userId),
    body: JSON.stringify(input),
  }, BACKEND_INTERCEPT_TIMEOUT_MS);

  if (!response.ok) {
    const interceptPayload = BackendInterceptResponseSchema.safeParse(payload);
    if (response.status === 403 && interceptPayload.success) {
      return interceptPayload.data;
    }

    const errorPayload = z.object({
      error: z.string(),
      upstreamStatus: z.number().optional(),
    }).safeParse(payload);
    const statusLabel = errorPayload.success && errorPayload.data.upstreamStatus
      ? `upstream ${errorPayload.data.upstreamStatus}`
      : `HTTP ${response.status}`;
    throw new Error(errorPayload.success
      ? `${errorPayload.data.error} (${statusLabel})`
      : `Backend intercept request failed (${statusLabel}).`);
  }

  return BackendInterceptResponseSchema.parse(payload);
}

// --- Deterministic Shield analysis (server-side; mirrors backend/src/security/sanitizer.ts) ---

export const FIREWALL_VERDICTS = ['CLEAN', 'SUSPICIOUS', 'ADVERSARIAL'] as const;
export type FirewallVerdict = (typeof FIREWALL_VERDICTS)[number];

const BackendSanitizationResultSchema = z.object({
  original: z.string(),
  sanitized: z.string(),
  detectionFlags: z.array(z.string()),
  redactions: z.array(z.string()),
  entropy: z.number(),
  globalEntropy: z.number(),
  syntacticScore: z.number(),
  suspiciousChunks: z.array(z.string()),
  verdict: z.enum(FIREWALL_VERDICTS),
  analystReasoning: z.string(),
  latencyMs: z.number(),
  decodeTelemetry: z.enum(['plain_text', 'single_hop_decode', 'recursive_decode']),
});
export type BackendSanitizationResult = z.infer<typeof BackendSanitizationResultSchema>;

const BackendOutputSanitizationResultSchema = z.object({
  original: z.string(),
  sanitized: z.string(),
  redactions: z.array(z.string()),
  detectionFlags: z.array(z.string()),
  blockedKeywordHits: z.array(z.string()),
  highRiskLeak: z.boolean(),
  tripped: z.boolean(),
});
export type BackendOutputSanitizationResult = z.infer<typeof BackendOutputSanitizationResultSchema>;

export interface AnalyzePromptTuning {
  entropyThreshold?: number;
  syntacticThreshold?: number;
  blockedKeywords?: string[];
  forbiddenTopics?: string[];
  regexRules?: string[];
}

// Run the deterministic Shield on a prompt (redaction, entropy, syntactic
// complexity, decode telemetry, verdict bands) — no LLM, no instruction-similarity
// lookup. Used for the live sanitization preview and analyst inspection.
export async function analyzePrompt(prompt: string, tuning?: AnalyzePromptTuning): Promise<BackendSanitizationResult> {
  const response = await fetch(resolveBackendUrl('/v1/analyze'), {
    method: 'POST',
    headers: getProtectedHeaders(),
    body: JSON.stringify({ prompt, ...(tuning ? { tuning } : {}) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : `Backend analyze failed (HTTP ${response.status}).`);
  }
  return BackendSanitizationResultSchema.parse(payload);
}

// Run the deterministic output Shield on model/tool output (redaction + blocked
// keyword + high-risk-leak detection). No LLM, no provider egress.
export async function analyzeOutput(text: string, blockedKeywords?: string[]): Promise<BackendOutputSanitizationResult> {
  const response = await fetch(resolveBackendUrl('/v1/analyze/output'), {
    method: 'POST',
    headers: getProtectedHeaders(),
    body: JSON.stringify({ text, ...(blockedKeywords ? { blockedKeywords } : {}) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : `Backend output analyze failed (HTTP ${response.status}).`);
  }
  return BackendOutputSanitizationResultSchema.parse(payload);
}

export async function lookupInstructionMonitorRecord(
  identifier: string,
  callerUserId?: string,
): Promise<InstructionMonitorRecord> {
  const response = await fetch(resolveBackendUrl(`/v1/instruction-monitor/records/${encodeURIComponent(identifier)}`), {
    method: 'GET',
    headers: getProtectedHeaders(callerUserId),
  });

  const payload: unknown = await response.json();
  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : `Instruction record lookup failed (HTTP ${response.status}).`);
  }

  return InstructionMonitorRecordSchema.parse(payload);
}

// Send one translation request through the backend so provider keys stay server-side.
export async function translatePromptViaBackend(input: {
  text: string;
  provider?: 'lara';
  mode?: 'recover_to_english' | 'generate_foreign_variant';
  targetLang?: string;
}): Promise<BackendTranslateResponse> {
  const response = await fetch(resolveBackendUrl('/v1/translate'), {
    method: 'POST',
    headers: getProtectedHeaders(),
    body: JSON.stringify(input),
  });

  const payload: unknown = await response.json();

  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Backend translation request failed.');
  }

  return BackendTranslateResponseSchema.parse(payload);
}

// Check whether the backend is alive before promising provider-backed features in the UI.
export async function checkBackendHealth(): Promise<BackendHealthResponse> {
  const response = await fetch(resolveBackendUrl('/healthz'));
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error('Backend health check failed.');
  }

  return BackendHealthResponseSchema.parse(payload);
}

export async function observeReviewedAdversarialInstruction(input: {
  logId: string;
  sanitizedPrompt: string;
  source?: 'analyst_chat' | 'bulk_ingest' | 'ctf_chat' | 'ctf_solve' | 'playground' | 'system';
  detectionFlags?: string[];
  labels?: string[];
  metadata?: {
    auditLogId?: string;
    batchId?: string;
    expectedVerdict?: string;
    backendSafeguardVerdict?: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL';
    source?: 'analyst_chat' | 'bulk_ingest' | 'ctf_chat' | 'ctf_solve' | 'playground' | 'system';
  };
}): Promise<ReviewedAdversarialInstructionResponse> {
  const { response, payload } = await fetchJsonWithTimeout('/v1/instruction-monitor/reviewed-adversarial', {
    method: 'POST',
    headers: getProtectedHeaders(),
    body: JSON.stringify(input),
  }, BACKEND_INTERCEPT_TIMEOUT_MS);

  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Failed to store reviewed adversarial instruction.');
  }

  return ReviewedAdversarialInstructionResponseSchema.parse(payload);
}

// Start a fresh Sam Spade session.
export async function createSamSpadeSession(input?: {
  caseId?: string;
  callerUserId?: string;
}): Promise<SamSpadeSession> {
  const { response, payload } = await fetchJsonWithTimeout('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: getProtectedHeaders(input?.callerUserId),
    body: JSON.stringify(input?.caseId ? { caseId: input.caseId } : {}),
  });
  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Failed to create Sam Spade session.');
  }

  return SamSpadeSessionResponseSchema.parse(payload).session;
}

export async function getSamSpadeSession(sessionId: string, callerUserId?: string): Promise<SamSpadeSession> {
  const { response, payload } = await fetchJsonWithTimeout(`/v1/ctf/sam-spade/session/${sessionId}`, {
    headers: getProtectedHeaders(callerUserId),
  });

  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Failed to fetch Sam Spade session.');
  }

  return SamSpadeSessionResponseSchema.parse(payload).session;
}

export async function sendSamSpadeMessage(input: {
  sessionId: string;
  prompt: string;
  callerUserId?: string;
  metadata?: SamSpadeRequestMetadata;
  tuning?: {
    entropyThreshold?: number;
    syntacticThreshold?: number;
    blockedKeywords?: string[];
    forbiddenTopics?: string[];
    regexRules?: string[];
  };
}): Promise<{ session: SamSpadeSession; review: SamSpadeReviewArtifact }> {
  const { callerUserId, ...body } = input;
  const { response, payload } = await fetchJsonWithTimeout('/v1/ctf/sam-spade/message', {
    method: 'POST',
    headers: getProtectedHeaders(callerUserId),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Failed to submit Sam Spade message.');
  }

  return SamSpadeMessageResponseSchema.parse(payload);
}

export async function solveSamSpadeCase(input: {
  sessionId: string;
  theory: string;
  callerUserId?: string;
  metadata?: SamSpadeRequestMetadata;
  tuning?: {
    entropyThreshold?: number;
    syntacticThreshold?: number;
    blockedKeywords?: string[];
    forbiddenTopics?: string[];
    regexRules?: string[];
  };
}): Promise<{ session: SamSpadeSession; solved: boolean; evaluation: string; review: SamSpadeReviewArtifact }> {
  const { callerUserId, ...body } = input;
  const { response, payload } = await fetchJsonWithTimeout('/v1/ctf/sam-spade/solve', {
    method: 'POST',
    headers: getProtectedHeaders(callerUserId),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Failed to solve Sam Spade case.');
  }

  return SamSpadeSolveResponseSchema.parse(payload);
}

const CtfReviewArtifactsResponseSchema = z.object({
  artifacts: z.array(SamSpadeReviewArtifactSchema),
});

// Poll the gateway's in-memory review-artifact feed. Used by the main Counter-Spy
// frontend to surface CTF activity generated by the standalone CTF frontend.
export async function getCtfReviewArtifacts(options?: {
  sinceTimestamp?: string;
  limit?: number;
}): Promise<SamSpadeReviewArtifact[]> {
  const params = new URLSearchParams();
  if (options?.sinceTimestamp) params.set('sinceTimestamp', options.sinceTimestamp);
  if (options?.limit) params.set('limit', String(options.limit));
  const query = params.toString();
  const { response, payload } = await fetchJsonWithTimeout(
    `/v1/ctf/review-artifacts${query ? `?${query}` : ''}`,
    { headers: getProtectedHeaders() },
  );
  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Failed to fetch CTF review artifacts.');
  }
  return CtfReviewArtifactsResponseSchema.parse(payload).artifacts;
}

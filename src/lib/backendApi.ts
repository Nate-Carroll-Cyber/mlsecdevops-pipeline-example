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
  metadata?: Record<string, unknown>;
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
    headers: {
      'content-type': 'application/json',
    },
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

// Send one translation request through the backend so provider keys stay server-side.
export async function translatePromptViaBackend(input: {
  text: string;
  provider?: 'lara';
  mode?: 'recover_to_english' | 'generate_foreign_variant';
  targetLang?: string;
  runtimeConfig?: {
    baseUrl?: string;
    accessKeyId?: string;
    apiKey?: string;
  };
}): Promise<BackendTranslateResponse> {
  const response = await fetch(resolveBackendUrl('/v1/translate'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
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

// Start a fresh Sam Spade session.
export async function createSamSpadeSession(input?: {
  caseId?: string;
}): Promise<SamSpadeSession> {
  const { response, payload } = await fetchJsonWithTimeout('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input ?? {}),
  });
  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Failed to create Sam Spade session.');
  }

  return SamSpadeSessionResponseSchema.parse(payload).session;
}

export async function getSamSpadeSession(sessionId: string): Promise<SamSpadeSession> {
  const { response, payload } = await fetchJsonWithTimeout(`/v1/ctf/sam-spade/session/${sessionId}`);

  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Failed to fetch Sam Spade session.');
  }

  return SamSpadeSessionResponseSchema.parse(payload).session;
}

export async function sendSamSpadeMessage(input: {
  sessionId: string;
  prompt: string;
  metadata?: Record<string, unknown>;
  tuning?: {
    entropyThreshold?: number;
    syntacticThreshold?: number;
    blockedKeywords?: string[];
    forbiddenTopics?: string[];
    regexRules?: string[];
  };
}): Promise<{ session: SamSpadeSession; review: SamSpadeReviewArtifact }> {
  const { response, payload } = await fetchJsonWithTimeout('/v1/ctf/sam-spade/message', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
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
  tuning?: {
    entropyThreshold?: number;
    syntacticThreshold?: number;
    blockedKeywords?: string[];
    forbiddenTopics?: string[];
    regexRules?: string[];
  };
}): Promise<{ session: SamSpadeSession; solved: boolean; evaluation: string; review: SamSpadeReviewArtifact }> {
  const { response, payload } = await fetchJsonWithTimeout('/v1/ctf/sam-spade/solve', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errorPayload = z.object({ error: z.string() }).safeParse(payload);
    throw new Error(errorPayload.success ? errorPayload.data.error : 'Failed to solve Sam Spade case.');
  }

  return SamSpadeSolveResponseSchema.parse(payload);
}

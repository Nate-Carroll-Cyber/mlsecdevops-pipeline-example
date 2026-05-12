/**
 * Minimal client for the Counter-Spy gateway from the standalone Sam Spade CTF
 * frontend. The gateway reverse-proxies /v1/ctf/sam-spade/* to the standalone CTF
 * service and handles /v1/ctf/review-artifacts itself.
 */

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

const PLAYER_STORAGE_KEY = 'counterspy_ctf_player_id';
const SESSION_STORAGE_KEY = 'counterspy_ctf_session_id';
const DEFAULT_CASE_ID = 'case-067';

function apiBase(): string {
  return import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '';
}

export function getPlayerId(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('player')?.trim();
  if (fromQuery) {
    try { window.localStorage.setItem(PLAYER_STORAGE_KEY, fromQuery); } catch { /* ignore */ }
    return fromQuery;
  }
  let id: string | null = null;
  try { id = window.localStorage.getItem(PLAYER_STORAGE_KEY); } catch { /* ignore */ }
  if (!id) {
    id = (crypto.randomUUID?.() ?? `ctf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try { window.localStorage.setItem(PLAYER_STORAGE_KEY, id); } catch { /* ignore */ }
  }
  return id;
}

export function getStoredSessionId(): string | null {
  try { return window.localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
}
export function setStoredSessionId(sessionId: string | null): void {
  try {
    if (sessionId) window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch { /* ignore */ }
}

function headers(callerUserId: string): HeadersInit {
  const token = import.meta.env.VITE_BACKEND_BEARER_TOKEN?.trim();
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    'x-counter-spy-user-id': callerUserId,
  };
}

async function call<T>(path: string, init: RequestInit, callerUserId: string): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers: { ...headers(callerUserId), ...(init.headers ?? {}) } });
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) {
    const message = (payload as { error?: string })?.error ?? `Counter-Spy backend returned ${response.status}.`;
    throw new Error(message);
  }
  return payload as T;
}

export async function createSession(callerUserId: string): Promise<SamSpadeSession> {
  const { session } = await call<{ session: SamSpadeSession }>(
    '/v1/ctf/sam-spade/session',
    { method: 'POST', body: JSON.stringify({ caseId: DEFAULT_CASE_ID }) },
    callerUserId,
  );
  return session;
}

export async function getSession(sessionId: string, callerUserId: string): Promise<SamSpadeSession> {
  const { session } = await call<{ session: SamSpadeSession }>(
    `/v1/ctf/sam-spade/session/${encodeURIComponent(sessionId)}`,
    { method: 'GET' },
    callerUserId,
  );
  return session;
}

export async function sendMessage(sessionId: string, prompt: string, callerUserId: string): Promise<{ session: SamSpadeSession; review: SamSpadeReviewArtifact }> {
  return call<{ session: SamSpadeSession; review: SamSpadeReviewArtifact }>(
    '/v1/ctf/sam-spade/message',
    { method: 'POST', body: JSON.stringify({ sessionId, prompt }) },
    callerUserId,
  );
}

export async function solveCase(sessionId: string, theory: string, callerUserId: string): Promise<{ session: SamSpadeSession; solved: boolean; evaluation: string; review: SamSpadeReviewArtifact }> {
  return call<{ session: SamSpadeSession; solved: boolean; evaluation: string; review: SamSpadeReviewArtifact }>(
    '/v1/ctf/sam-spade/solve',
    { method: 'POST', body: JSON.stringify({ sessionId, theory }) },
    callerUserId,
  );
}

// Push a review artifact into the gateway so the main Counter-Spy frontend can
// surface this CTF turn in its Audit/Metrics views (and observability). Best-effort.
export async function postReviewArtifact(artifact: SamSpadeReviewArtifact, callerUserId: string): Promise<void> {
  try {
    await call<{ ok: boolean }>(
      '/v1/ctf/review-artifacts',
      { method: 'POST', body: JSON.stringify({ artifact }) },
      callerUserId,
    );
  } catch {
    // Non-fatal: gameplay continues even if the review-artifact feed is down.
  }
}

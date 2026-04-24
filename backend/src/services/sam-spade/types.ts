/**
 * Shared Sam Spade service contracts.
 * These types define the session, message, and review shapes used by the
 * backend service, frontend API client, and downstream review surfaces.
 */
import type { BackendSanitizationResult } from '../../security/sanitizer.js';

export type SamSpadeSessionStatus = 'ACTIVE' | 'SOLVED' | 'INTERCEPTED';
export type SamSpadeMessageRole = 'player' | 'npc' | 'system';

// One conversational turn inside a Sam Spade session.
export interface SamSpadeSessionMessage {
  id: string;
  role: SamSpadeMessageRole;
  text: string;
  createdAt: string;
  reviewDisposition: 'clean' | 'intercepted' | 'queued';
}

// Review artifact mirrored into Analyst Chat and Audit Logs after each action.
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
  decodeTelemetry: BackendSanitizationResult['decodeTelemetry'];
  status: 'REVIEWED' | 'PENDING_REVIEW';
  responderPromptProfile?: 'sam_spade_ctf';
  responderProvider?: 'openai_compatible' | 'gemini';
  responderModel?: string;
  responderStatus?: string;
  responderLatencyMs?: number;
}

// Full persisted session state for the CTF experience.
export interface SamSpadeSessionRecord {
  sessionId: string;
  caseId: string;
  status: SamSpadeSessionStatus;
  createdAt: string;
  updatedAt: string;
  solvedAt?: string;
  messages: SamSpadeSessionMessage[];
  lastReview?: SamSpadeReviewArtifact;
}

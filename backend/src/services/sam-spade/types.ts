/**
 * Shared Sam Spade service contracts.
 * These types define the session, message, and review shapes used by the
 * backend service, frontend API client, and downstream review surfaces.
 */
import { z } from 'zod';
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
  ownerUserId: string;
  status: SamSpadeSessionStatus;
  createdAt: string;
  updatedAt: string;
  solvedAt?: string;
  messages: SamSpadeSessionMessage[];
  lastReview?: SamSpadeReviewArtifact;
}

// Runtime validation for persisted session payloads. The store deserializes
// untrusted bytes off disk, so every read is checked against this schema before
// it re-enters the request path; a malformed/tampered row is treated as missing.
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
}).passthrough();

export const SamSpadeSessionRecordSchema = z.object({
  sessionId: z.string().min(1),
  caseId: z.string().min(1),
  ownerUserId: z.string().min(1),
  status: z.enum(['ACTIVE', 'SOLVED', 'INTERCEPTED']),
  createdAt: z.string(),
  updatedAt: z.string(),
  solvedAt: z.string().optional(),
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['player', 'npc', 'system']),
    text: z.string(),
    createdAt: z.string(),
    reviewDisposition: z.enum(['clean', 'intercepted', 'queued']),
  })),
  lastReview: SamSpadeReviewArtifactSchema.optional(),
}).passthrough();

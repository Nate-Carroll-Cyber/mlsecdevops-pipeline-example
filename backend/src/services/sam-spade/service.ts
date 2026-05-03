/**
 * Sam Spade gameplay orchestration.
 * This module owns session creation, guarded message handling, simple NPC reply
 * logic, solve evaluation, and review artifact construction.
 */
import { sanitizePrompt, type BackendSanitizationResult } from '../../security/sanitizer.js';
import type { FirewallVerdict } from '../../security/sanitizer.js';
import { samSpadeConfig } from './config.js';
import { getStoredSession, saveStoredSession } from './store.js';
import type { SamSpadeReviewArtifact, SamSpadeSessionMessage, SamSpadeSessionRecord } from './types.js';

const SAM_SPADE_BLOCKED_RESPONSE = 'Bad content.';
const SAM_SPADE_SENSITIVE_REDACTIONS = new Set([
  'EMAIL',
  'PHONE',
  'ADDRESS',
  'ZIPCODE',
  'MAC_ADDRESS',
  'IP_ADDRESS',
  'CREDIT_CARD',
  'SSN',
  'AWS_KEY',
  'PRIVATE_KEY',
  'API_KEY',
  'JWT',
  'CANARY_TOKEN',
  'SECRET_KEY',
]);

function nowIso() {
  return new Date().toISOString();
}

// Convert the backend sanitizer verdict into the UI/review severity vocabulary.
function toDetectionLevel(sanitization: BackendSanitizationResult): SamSpadeReviewArtifact['detectionLevel'] {
  if (sanitization.verdict === 'ADVERSARIAL') return 'Adversarial';
  if (sanitization.verdict === 'SUSPICIOUS') return 'Suspicious';
  if (sanitization.redactions.length > 0) return 'Informational';
  return 'Clean';
}

function hasSensitiveGameplayExposure(sanitization: BackendSanitizationResult): boolean {
  return sanitization.redactions.some((redaction) => SAM_SPADE_SENSITIVE_REDACTIONS.has(redaction));
}

export function shouldInterceptSamSpadeIntake(
  sanitization: BackendSanitizationResult,
  externalVerdict?: FirewallVerdict,
): boolean {
  return sanitization.verdict !== 'CLEAN' ||
    (externalVerdict !== undefined && externalVerdict !== 'CLEAN') ||
    hasSensitiveGameplayExposure(sanitization);
}

function getReviewDetectionFlags(
  sanitization: BackendSanitizationResult,
  effectiveVerdict: FirewallVerdict,
  sensitiveGameplayExposure: boolean,
): string[] {
  const flags = new Set(sanitization.detectionFlags);
  if (effectiveVerdict !== sanitization.verdict) {
    flags.add(`SAFEGUARD_${effectiveVerdict}`);
  }
  if (sensitiveGameplayExposure) {
    flags.add('SENSITIVE_DATA_EXPOSURE');
  }
  return [...flags];
}

function getReviewDetectionLevel(
  sanitization: BackendSanitizationResult,
  effectiveVerdict: FirewallVerdict,
  sensitiveGameplayExposure: boolean,
): SamSpadeReviewArtifact['detectionLevel'] {
  if (effectiveVerdict !== sanitization.verdict) {
    return effectiveVerdict === 'ADVERSARIAL' ? 'Adversarial' : 'Suspicious';
  }
  if (sensitiveGameplayExposure) {
    return 'Suspicious';
  }
  return toDetectionLevel(sanitization);
}

// Start a fresh case session with the opening noir line already on the timeline.
export function createSamSpadeSession(caseId = samSpadeConfig.SAM_SPADE_DEFAULT_CASE_ID): SamSpadeSessionRecord {
  const createdAt = nowIso();
  const sessionId = crypto.randomUUID();
  const openingMessage: SamSpadeSessionMessage = {
    id: crypto.randomUUID(),
    role: 'npc',
    text: "What do you want? Make it quick, I don't have all day.",
    createdAt,
    reviewDisposition: 'clean',
  };

  const session: SamSpadeSessionRecord = {
    sessionId,
    caseId,
    status: 'ACTIVE',
    createdAt,
    updatedAt: createdAt,
    messages: [openingMessage],
  };

  saveStoredSession(session);
  return session;
}

// Read a session from persistence for resume/review flows.
export function getSamSpadeSession(sessionId: string): SamSpadeSessionRecord | null {
  return getStoredSession(sessionId);
}

// Process one player question through the firewall before producing any NPC reply.
export function submitSamSpadeMessage(args: {
  sessionId: string;
  prompt: string;
  npcResponse?: string;
  externalVerdict?: FirewallVerdict;
  externalReasoning?: string;
  responderTelemetry?: {
    promptProfile: 'sam_spade_ctf';
    provider?: 'openai_compatible' | 'gemini';
    modelId: string;
    status: string;
    latencyMs: number;
  };
  tuning?: {
    entropyThreshold?: number;
    syntacticThreshold?: number;
  };
}): { session: SamSpadeSessionRecord; review: SamSpadeReviewArtifact } {
  const session = getStoredSession(args.sessionId);
  if (!session) {
    throw new Error('Sam Spade session not found.');
  }

  const requestId = crypto.randomUUID();
  const submittedAt = nowIso();
  const sanitization = sanitizePrompt(args.prompt, args.tuning);
  const effectiveVerdict = args.externalVerdict ?? sanitization.verdict;
  const sensitiveGameplayExposure = hasSensitiveGameplayExposure(sanitization);
  const intercepted = shouldInterceptSamSpadeIntake(sanitization, args.externalVerdict);
  // Record the player turn using the sanitized text that downstream review sees.
  const reviewDisposition: SamSpadeSessionMessage['reviewDisposition'] = intercepted ? 'intercepted' : 'clean';
  const playerMessage: SamSpadeSessionMessage = {
    id: crypto.randomUUID(),
    role: 'player',
    text: sanitization.sanitized,
    createdAt: submittedAt,
    reviewDisposition,
  };

  let npcResponse = args.npcResponse?.trim() || 'Sam Spade has no answer on the wire yet.';
  let reviewStatus: SamSpadeReviewArtifact['status'] = 'REVIEWED';
  let analystReasoning = sanitization.analystReasoning;

  if (intercepted) {
    // If the firewall blocks the turn, gameplay pauses and review takes over.
    session.status = 'INTERCEPTED';
    reviewStatus = 'PENDING_REVIEW';
    npcResponse = SAM_SPADE_BLOCKED_RESPONSE;
    analystReasoning = [
      args.externalReasoning || sanitization.analystReasoning,
      sensitiveGameplayExposure ? 'Sensitive data exposure was blocked before Sam Spade gameplay.' : '',
      'Sam Spade CTF intake was intercepted before downstream gameplay.',
    ].filter(Boolean).join(' ');
  } else {
    session.status = 'ACTIVE';
    analystReasoning = `${sanitization.analystReasoning} Sam Spade CTF intake cleared the guardrails and produced an NPC response.`;
  }

  // Append both the player turn and the NPC/system reply to the session transcript.
  const npcMessage: SamSpadeSessionMessage = {
    id: crypto.randomUUID(),
    role: intercepted ? 'system' : 'npc',
    text: npcResponse,
    createdAt: nowIso(),
    reviewDisposition: intercepted ? 'queued' : 'clean',
  };

  session.messages = [...session.messages, playerMessage, npcMessage];
  session.updatedAt = npcMessage.createdAt;

  // Mirror the same action into the shared review artifact format.
  const review: SamSpadeReviewArtifact = {
    requestId,
    sessionId: session.sessionId,
    source: 'ctf_chat',
    action: 'message',
    timestamp: npcMessage.createdAt,
    sanitizedPrompt: sanitization.sanitized,
    detectionFlags: getReviewDetectionFlags(sanitization, effectiveVerdict, sensitiveGameplayExposure),
    entropy: sanitization.entropy,
    globalEntropy: sanitization.globalEntropy,
    suspiciousChunks: sanitization.suspiciousChunks,
    detectionLevel: getReviewDetectionLevel(sanitization, effectiveVerdict, sensitiveGameplayExposure),
    escalationRecommended: intercepted,
    response: npcResponse,
    analystReasoning,
    latencyMs: sanitization.latencyMs,
    decodeTelemetry: sanitization.decodeTelemetry,
    status: reviewStatus,
    ...(args.responderTelemetry && !intercepted ? {
      responderPromptProfile: args.responderTelemetry.promptProfile,
      responderProvider: args.responderTelemetry.provider,
      responderModel: args.responderTelemetry.modelId,
      responderStatus: args.responderTelemetry.status,
      responderLatencyMs: args.responderTelemetry.latencyMs,
    } : {}),
  };

  session.lastReview = review;
  saveStoredSession(session);
  return { session, review };
}

// Evaluate a submitted case theory through the same governed pipeline as normal turns.
export function solveSamSpadeCase(args: {
  sessionId: string;
  theory: string;
  tuning?: {
    entropyThreshold?: number;
    syntacticThreshold?: number;
  };
}): { session: SamSpadeSessionRecord; solved: boolean; evaluation: string; review: SamSpadeReviewArtifact } {
  const session = getStoredSession(args.sessionId);
  if (!session) {
    throw new Error('Sam Spade session not found.');
  }

  const submittedAt = nowIso();
  const requestId = crypto.randomUUID();
  const sanitization = sanitizePrompt(args.theory, args.tuning);
  const sensitiveGameplayExposure = hasSensitiveGameplayExposure(sanitization);
  const intercepted = shouldInterceptSamSpadeIntake(sanitization);
  const theoryMessage: SamSpadeSessionMessage = {
    id: crypto.randomUUID(),
    role: 'player',
    text: sanitization.sanitized,
    createdAt: submittedAt,
    reviewDisposition: intercepted ? 'intercepted' : 'clean',
  };

  const normalizedTheory = sanitization.sanitized.toLowerCase();
  const solved =
    normalizedTheory.includes('wonderly') ||
    normalizedTheory.includes('eddy street') ||
    normalizedTheory.includes('false lining');

  // Produce a simple solve verdict for the current demo rule set.
  let evaluation = solved
    ? 'Case closed. The theory lines up with the witness trail and the hidden ledger path.'
    : 'Not enough yet. The solution needs a stronger link between the witness, the hiding place, and the motive.';

  let reviewStatus: SamSpadeReviewArtifact['status'] = 'REVIEWED';
  let analystReasoning = `${sanitization.analystReasoning} Sam Spade theory submission was evaluated against the case outcome logic.`;
  if (intercepted) {
    evaluation = SAM_SPADE_BLOCKED_RESPONSE;
    reviewStatus = 'PENDING_REVIEW';
    analystReasoning = [
      sanitization.analystReasoning,
      sensitiveGameplayExposure ? 'Sensitive data exposure was blocked before Sam Spade solve evaluation.' : '',
      'Sam Spade theory submission was intercepted before solve evaluation.',
    ].filter(Boolean).join(' ');
  }

  session.status = intercepted ? 'INTERCEPTED' : solved ? 'SOLVED' : session.status;
  session.updatedAt = nowIso();
  if (!intercepted && solved) {
    session.solvedAt = session.updatedAt;
  }

  // The solve action is also written back into the visible transcript.
  const evaluationMessage: SamSpadeSessionMessage = {
    id: crypto.randomUUID(),
    role: 'system',
    text: evaluation,
    createdAt: session.updatedAt,
    reviewDisposition: intercepted ? 'queued' : solved ? 'clean' : 'queued',
  };

  session.messages = [
    ...session.messages,
    theoryMessage,
    evaluationMessage,
  ];

  const review: SamSpadeReviewArtifact = {
    requestId,
    sessionId: session.sessionId,
    source: 'ctf_chat',
    action: 'solve',
    timestamp: session.updatedAt,
    sanitizedPrompt: sanitization.sanitized,
    detectionFlags: getReviewDetectionFlags(sanitization, sanitization.verdict, sensitiveGameplayExposure),
    entropy: sanitization.entropy,
    globalEntropy: sanitization.globalEntropy,
    suspiciousChunks: sanitization.suspiciousChunks,
    detectionLevel: intercepted
      ? getReviewDetectionLevel(sanitization, sanitization.verdict, sensitiveGameplayExposure)
      : solved
        ? 'Informational'
        : 'Clean',
    escalationRecommended: intercepted,
    response: evaluation,
    analystReasoning,
    latencyMs: sanitization.latencyMs,
    decodeTelemetry: sanitization.decodeTelemetry,
    status: reviewStatus,
  };

  session.lastReview = review;
  saveStoredSession(session);
  return { session, solved: !intercepted && solved, evaluation, review };
}

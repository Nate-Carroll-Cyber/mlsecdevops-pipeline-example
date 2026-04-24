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
    provider: 'openai_compatible' | 'gemini';
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
  const intercepted = sanitization.verdict !== 'CLEAN' || effectiveVerdict !== 'CLEAN';
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
    npcResponse = effectiveVerdict === 'ADVERSARIAL'
      ? "You’re leaning too hard on the wrong words. Come back when your questions sound less like a break-in."
      : "That line of questioning’s too blunt. Dress it up, work the edges, and try again.";
    analystReasoning = `${args.externalReasoning || sanitization.analystReasoning} Sam Spade CTF intake was intercepted before downstream gameplay.`;
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
    detectionFlags: effectiveVerdict === sanitization.verdict
      ? sanitization.detectionFlags
      : Array.from(new Set([...sanitization.detectionFlags, `SAFEGUARD_${effectiveVerdict}`])),
    entropy: sanitization.entropy,
    globalEntropy: sanitization.globalEntropy,
    suspiciousChunks: sanitization.suspiciousChunks,
    detectionLevel: effectiveVerdict === sanitization.verdict
      ? toDetectionLevel(sanitization)
      : effectiveVerdict === 'ADVERSARIAL'
        ? 'Adversarial'
        : 'Suspicious',
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
  const intercepted = sanitization.verdict !== 'CLEAN';
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
    evaluation = sanitization.verdict === 'ADVERSARIAL'
      ? 'Theory submission intercepted before case evaluation. Try again without adversarial framing.'
      : 'Theory submission queued for review before case evaluation. Tighten the language and try again.';
    reviewStatus = 'PENDING_REVIEW';
    analystReasoning = `${sanitization.analystReasoning} Sam Spade theory submission was intercepted before solve evaluation.`;
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
    detectionFlags: sanitization.detectionFlags,
    entropy: sanitization.entropy,
    globalEntropy: sanitization.globalEntropy,
    suspiciousChunks: sanitization.suspiciousChunks,
    detectionLevel: intercepted
      ? toDetectionLevel(sanitization)
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

/**
 * Sam Spade gameplay orchestration.
 * This module owns session creation, guarded message handling, simple NPC reply
 * logic, solve evaluation, and review artifact construction.
 */
import { sanitizePrompt, type BackendSanitizationResult } from '../../security/sanitizer.js';
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

// Lightweight deterministic NPC responses used until a richer game engine exists.
function inferNpcReply(prompt: string, turnCount: number): string {
  const lowerPrompt = prompt.toLowerCase();

  if (/(name|who (was|is) she|woman|girl|witness)/.test(lowerPrompt)) {
    return "You’re asking about the dame already? Slow down. People in this town wear aliases like overcoats, and neither keeps you warm for long.";
  }

  if (/(ledger|book|records|evidence|documents|proof)/.test(lowerPrompt)) {
    return "Everybody wants the paper trail. Funny thing about ledgers: they never stay where amateurs expect to find them.";
  }

  if (/(where|location|address|hotel|room|office|safe)/.test(lowerPrompt)) {
    return "If I handed out addresses that easy, I’d be out of business by lunch. Ask better and maybe I’ll tell you what kind of room matters.";
  }

  if (/(why|motive|risk|afraid|danger|threat)/.test(lowerPrompt)) {
    return "Now you’re getting somewhere. Fear makes people sloppy, but only after you’ve named what they’re afraid of losing.";
  }

  if (/(contradiction|doesn'?t add up|lie|lying|story)/.test(lowerPrompt)) {
    return "Everybody lies. The trick is spotting which lie costs them the most to keep telling.";
  }

  if (turnCount <= 1) {
    return "You came to a detective with questions and no angle. Start with motive, risk, or what somebody stood to lose.";
  }

  return "You’re circling it. Follow the witness, the ledger, and the lie that keeps both in motion.";
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
}): { session: SamSpadeSessionRecord; review: SamSpadeReviewArtifact } {
  const session = getStoredSession(args.sessionId);
  if (!session) {
    throw new Error('Sam Spade session not found.');
  }

  const requestId = crypto.randomUUID();
  const submittedAt = nowIso();
  const sanitization = sanitizePrompt(args.prompt);
  const intercepted = sanitization.verdict !== 'CLEAN';
  // Record the player turn using the sanitized text that downstream review sees.
  const reviewDisposition: SamSpadeSessionMessage['reviewDisposition'] = intercepted ? 'intercepted' : 'clean';
  const playerMessage: SamSpadeSessionMessage = {
    id: crypto.randomUUID(),
    role: 'player',
    text: sanitization.sanitized,
    createdAt: submittedAt,
    reviewDisposition,
  };

  let npcResponse = inferNpcReply(sanitization.sanitized, session.messages.filter((message) => message.role === 'player').length + 1);
  let reviewStatus: SamSpadeReviewArtifact['status'] = 'REVIEWED';
  let analystReasoning = sanitization.analystReasoning;

  if (intercepted) {
    // If the firewall blocks the turn, gameplay pauses and review takes over.
    session.status = 'INTERCEPTED';
    reviewStatus = 'PENDING_REVIEW';
    npcResponse = sanitization.verdict === 'ADVERSARIAL'
      ? "You’re leaning too hard on the wrong words. Come back when your questions sound less like a break-in."
      : "That line of questioning’s too blunt. Dress it up, work the edges, and try again.";
    analystReasoning = `${sanitization.analystReasoning} Sam Spade CTF intake was intercepted before downstream gameplay.`;
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
    detectionFlags: sanitization.detectionFlags,
    entropy: sanitization.entropy,
    globalEntropy: sanitization.globalEntropy,
    suspiciousChunks: sanitization.suspiciousChunks,
    detectionLevel: toDetectionLevel(sanitization),
    escalationRecommended: intercepted,
    response: npcResponse,
    analystReasoning,
    latencyMs: sanitization.latencyMs,
    decodeTelemetry: sanitization.decodeTelemetry,
    status: reviewStatus,
  };

  session.lastReview = review;
  saveStoredSession(session);
  return { session, review };
}

// Evaluate a submitted case theory through the same governed pipeline as normal turns.
export function solveSamSpadeCase(args: {
  sessionId: string;
  theory: string;
}): { session: SamSpadeSessionRecord; solved: boolean; evaluation: string; review: SamSpadeReviewArtifact } {
  const session = getStoredSession(args.sessionId);
  if (!session) {
    throw new Error('Sam Spade session not found.');
  }

  const submittedAt = nowIso();
  const requestId = crypto.randomUUID();
  const sanitization = sanitizePrompt(args.theory);
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

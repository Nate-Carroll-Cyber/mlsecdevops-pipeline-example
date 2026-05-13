/**
 * Shared CTF review-artifact contract for the gateway.
 * The standalone CTF frontend POSTs each turn's review artifact to
 * /v1/ctf/review-artifacts; this schema validates the payload and is also
 * the type the SQLite-backed reviewArtifactStore stores.
 *
 * The full Sam Spade gameplay contract lives in services/sam-spade; the
 * gateway only needs the review-artifact shape for the bridge endpoint.
 */
import { z } from 'zod';

export const SamSpadeReviewArtifactSchema = z.object({
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

export type SamSpadeReviewArtifact = z.infer<typeof SamSpadeReviewArtifactSchema>;

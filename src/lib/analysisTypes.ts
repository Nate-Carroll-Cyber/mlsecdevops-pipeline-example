/**
 * Shared analysis shapes and constants for the analyst console.
 *
 * These are *data shapes / thresholds only* — no detection logic lives here. The
 * deterministic Shield itself runs server-side (backend/src/security/sanitizer.ts);
 * the console receives BackendSanitizationResult / OutputSanitizationResult over
 * /v1/analyze and adapts them onto the shapes below (see runPromptShield /
 * runOutputShield in App.tsx).
 */

// Severity bands the console renders. The backend speaks FirewallVerdict
// ('CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL'); CLEAN + redactions maps to INFORMATIONAL.
export enum DetectionLevel {
  CLEAN = 0,
  INFORMATIONAL = 1,
  SUSPICIOUS = 2,
  ADVERSARIAL = 3,
}

// Entropy band floor (mirrors backend/src/security/sanitizer.ts). Entropy <= this
// is "allowed"; above it is "suspicious"; above the configured threshold is
// "adversarial". Do not change without review (see CLAUDE.md).
export const SUSPICIOUS_ENTROPY_THRESHOLD = 3.8;

export type DecodeTelemetry = 'plain_text' | 'single_hop_decode' | 'recursive_decode';

// Prompt-side sanitization result as the console works with it.
export interface SanitizationResult {
  original: string;
  sanitized: string;
  redactions: string[];
  entropy: number;
  globalEntropy: number;
  suspiciousChunks: string[];
  isPotentiallyAdversarial: boolean;
  detectionLevel: DetectionLevel;
  latencyMs: number;
  syntacticScore: number;
  decodeTelemetry: DecodeTelemetry;
}

// Output-side governance pass result as the console works with it.
export interface OutputSanitizationResult {
  sanitized: string;
  triggeredEscalation: boolean;
  redactions: string[];
  decodeTelemetry: DecodeTelemetry;
}

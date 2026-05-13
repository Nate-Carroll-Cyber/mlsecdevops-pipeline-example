/**
 * Public Sam Spade service entry point.
 * Re-exports the gameplay functions and shared types so callers only need one import.
 */
export {
  createSamSpadeSession,
  getSamSpadeSession,
  shouldInterceptSamSpadeIntake,
  solveSamSpadeCase,
  submitSamSpadeMessage,
} from './service.js';

export type {
  SamSpadeReviewArtifact,
  SamSpadeSessionMessage,
  SamSpadeSessionRecord,
  SamSpadeSessionStatus,
} from './types.js';

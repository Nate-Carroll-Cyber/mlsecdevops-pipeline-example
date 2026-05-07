export { instructionMonitorConfig, getInstructionMonitorConnectionString } from './config.js';
export { chunkText, fingerprintInstruction, heuristicIntentScore } from './fingerprint.js';
export { classifyInstructionRisk, PgvectorInstructionMonitor } from './service.js';
export type {
  InstructionChunkInput,
  InstructionMatch,
  InstructionMonitorCompareResult,
  InstructionMonitorInput,
  InstructionRecord,
  InstructionRisk,
  InstructionSource,
} from './types.js';

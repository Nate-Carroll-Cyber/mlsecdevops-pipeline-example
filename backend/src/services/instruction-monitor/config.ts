import { z } from 'zod';

const InstructionMonitorEnvSchema = z.object({
  INSTRUCTION_MONITOR_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? false : value.toLowerCase() !== 'false'),
  INSTRUCTION_MONITOR_DATABASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url().optional(),
  INSTRUCTION_MONITOR_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(4096).default(768),
  INSTRUCTION_MONITOR_COMPARE_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  INSTRUCTION_MONITOR_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  INSTRUCTION_MONITOR_HAMMING_THRESHOLD: z.coerce.number().int().min(0).max(64).default(12),
  INSTRUCTION_MONITOR_CHUNK_QUERY_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
});

export const instructionMonitorConfig = InstructionMonitorEnvSchema.parse(process.env);

export function getInstructionMonitorConnectionString() {
  return instructionMonitorConfig.INSTRUCTION_MONITOR_DATABASE_URL || instructionMonitorConfig.DATABASE_URL;
}

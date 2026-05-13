/**
 * Sam Spade service configuration.
 * Parses the dedicated env surface for the CTF flow so the future service split
 * can move without dragging the whole backend config shape with it.
 */
import { z } from 'zod';

// Validate and coerce the Sam Spade env vars once at boot time.
const SamSpadeEnvSchema = z.object({
  SAM_SPADE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === undefined ? true : value.toLowerCase() !== 'false'),
  SAM_SPADE_DEFAULT_CASE_ID: z.string().min(1).default('case-067'),
  SAM_SPADE_STORE_PATH: z.string().min(1).default('services/sam-spade/data/sam-spade.db'),
  SAM_SPADE_SERVICE_PORT: z.coerce.number().int().min(1).max(65535).default(18120),
});

// Export a single typed config object that the rest of the service can trust.
export const samSpadeConfig = SamSpadeEnvSchema.parse(process.env);

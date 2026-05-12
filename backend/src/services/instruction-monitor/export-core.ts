import 'dotenv/config';
import { resolve } from 'node:path';
import { instructionMonitorConfig, getInstructionMonitorConnectionString } from './config.js';
import { PgvectorInstructionMonitor } from './service.js';

const outputPath = resolve(process.cwd(), process.argv[2] ?? 'seeds/pgvector/core.json');
const seedVersionArg = process.argv.find((arg) => arg.startsWith('--seed-version='));
const seedSourceArg = process.argv.find((arg) => arg.startsWith('--seed-source='));
const includeExistingSeedRecords = process.argv.includes('--include-existing-seed-records');
const seedVersion = seedVersionArg?.split('=').slice(1).join('=') || new Date().toISOString().replace(/[:.]/g, '-');
const seedSource = seedSourceArg?.split('=').slice(1).join('=') || 'reviewed-adversarial-export';
const connectionString = getInstructionMonitorConnectionString();

if (!connectionString) {
  throw new Error('Set INSTRUCTION_MONITOR_DATABASE_URL or DATABASE_URL before exporting the instruction-monitor seed.');
}

const monitor = new PgvectorInstructionMonitor({
  connectionString,
  embeddingDimensions: instructionMonitorConfig.INSTRUCTION_MONITOR_EMBEDDING_DIMENSIONS,
  compareLimit: instructionMonitorConfig.INSTRUCTION_MONITOR_COMPARE_LIMIT,
  similarityThreshold: instructionMonitorConfig.INSTRUCTION_MONITOR_SIMILARITY_THRESHOLD,
  hammingThreshold: instructionMonitorConfig.INSTRUCTION_MONITOR_HAMMING_THRESHOLD,
  chunkQueryConcurrency: instructionMonitorConfig.INSTRUCTION_MONITOR_CHUNK_QUERY_CONCURRENCY,
  ...(instructionMonitorConfig.INSTRUCTION_MONITOR_SEED_HMAC_KEY ? { seedHmacKey: instructionMonitorConfig.INSTRUCTION_MONITOR_SEED_HMAC_KEY } : {}),
});

try {
  await monitor.initialize();
  const result = await monitor.exportCoreSeedSnapshotToFile(outputPath, {
    seedVersion,
    seedSource,
    includeExistingSeedRecords,
  });
  console.log(JSON.stringify({
    message: 'instruction_monitor_seed_exported',
    ...result,
  }, null, 2));
} finally {
  await monitor.close();
}

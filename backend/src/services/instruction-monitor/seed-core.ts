import 'dotenv/config';
import { resolve } from 'node:path';
import { instructionMonitorConfig, getInstructionMonitorConnectionString } from './config.js';
import { PgvectorInstructionMonitor } from './service.js';

const seedPath = resolve(process.cwd(), process.argv[2] ?? 'seeds/pgvector/core.json');
const allowChangedSeedRecords = process.argv.includes('--allow-seed-update');
const connectionString = getInstructionMonitorConnectionString();

if (!connectionString) {
  throw new Error('Set INSTRUCTION_MONITOR_DATABASE_URL or DATABASE_URL before importing the instruction-monitor seed.');
}

const monitor = new PgvectorInstructionMonitor({
  connectionString,
  embeddingDimensions: instructionMonitorConfig.INSTRUCTION_MONITOR_EMBEDDING_DIMENSIONS,
  compareLimit: instructionMonitorConfig.INSTRUCTION_MONITOR_COMPARE_LIMIT,
  similarityThreshold: instructionMonitorConfig.INSTRUCTION_MONITOR_SIMILARITY_THRESHOLD,
  hammingThreshold: instructionMonitorConfig.INSTRUCTION_MONITOR_HAMMING_THRESHOLD,
  chunkQueryConcurrency: instructionMonitorConfig.INSTRUCTION_MONITOR_CHUNK_QUERY_CONCURRENCY,
});

try {
  await monitor.initialize();
  const result = await monitor.importSeedSnapshotFromFile(seedPath, { allowChangedSeedRecords });
  console.log(JSON.stringify({
    message: 'instruction_monitor_seed_imported',
    seedPath,
    ...result,
  }, null, 2));
} finally {
  await monitor.close();
}

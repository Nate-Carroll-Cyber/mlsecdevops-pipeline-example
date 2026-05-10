import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import pgvector from 'pgvector/pg';
import { z } from 'zod';
import { fingerprintInstruction } from './fingerprint.js';
import type {
  InstructionMatch,
  InstructionMonitorCompareResult,
  InstructionMonitorInput,
  InstructionRecord,
  InstructionRecordLookup,
  InstructionRisk,
} from './types.js';

type MonitorOptions = {
  connectionString: string;
  embeddingDimensions?: number;
  compareLimit?: number;
  similarityThreshold?: number;
  hammingThreshold?: number;
  chunkQueryConcurrency?: number;
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
};

type CandidatePartial = {
  targetId: string;
  targetHash?: string;
  source?: string;
  targetVerdict?: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL' | null;
  exactMatch?: boolean;
  looseExactMatch?: boolean;
  hammingDistance?: number;
  hammingDistance2gram?: number;
  hammingDistance4gram?: number;
  cosineSimilarity?: number;
  maxChunkSimilarity?: number;
  attentionPooledChunkSimilarity?: number;
};

type ChunkAcc = {
  maxSim: number;
  weightedSum: number;
  weightSum: number;
};

const SeedChunkSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  chunkText: z.string(),
  chunkHash: z.string().regex(/^[a-f0-9]{64}$/),
  embedding: z.array(z.number()),
  intentScore: z.number().min(0).max(1).default(1),
});

const SeedRecordSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['analyst_chat', 'bulk_ingest', 'ctf_chat', 'ctf_solve', 'playground', 'system']),
  rawText: z.string(),
  normalizedText: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sha256Loose: z.string().regex(/^[a-f0-9]{64}$/),
  simhash: z.string(),
  simhash2gram: z.string(),
  simhash4gram: z.string(),
  embedding: z.array(z.number()).nullable(),
  verdict: z.enum(['CLEAN', 'SUSPICIOUS', 'ADVERSARIAL']),
  detectionFlags: z.array(z.string()).default([]),
  reviewed: z.literal(true),
  labels: z.array(z.string()).default([]),
  matchPolicy: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  chunks: z.array(SeedChunkSchema).default([]),
  seedRecordHash: z.string().regex(/^[a-f0-9]{64}$/),
});

const SeedSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  seedPack: z.literal('core'),
  seedVersion: z.string().min(1),
  seedSource: z.string().min(1),
  exportedAt: z.string().min(1),
  embeddingDimensions: z.number().int().positive(),
  records: z.array(SeedRecordSchema),
  seedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type InstructionSeedImportResult = {
  seedPack: 'core';
  seedVersion: string;
  seedSnapshotHash: string;
  insertedRecords: number;
  skippedRecords: number;
  insertedChunks: number;
};

export type InstructionSeedExportResult = {
  seedPack: 'core';
  seedVersion: string;
  seedSnapshotHash: string;
  exportedRecords: number;
  exportedChunks: number;
  outputPath: string;
};

export class PgvectorInstructionMonitor {
  private readonly pool: Pool;
  private readonly registeredClients = new WeakSet<PoolClient>();
  private readonly embeddingDimensions: number;
  private readonly compareLimit: number;
  private readonly similarityThreshold: number;
  private readonly hammingThreshold: number;
  private readonly chunkQueryConcurrency: number;

  constructor(options: MonitorOptions) {
    this.embeddingDimensions = options.embeddingDimensions ?? 768;
    this.compareLimit = options.compareLimit ?? 10;
    this.similarityThreshold = options.similarityThreshold ?? 0.78;
    this.hammingThreshold = options.hammingThreshold ?? 12;
    this.chunkQueryConcurrency = options.chunkQueryConcurrency ?? 4;
    this.pool = new Pool({
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: 'counter-spy-instruction-monitor',
      ...options.poolConfig,
      connectionString: options.connectionString,
    });
  }

  async initialize(): Promise<void> {
    await this.withClient(async (client) => {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await this.registerVectorTypes(client);
      await client.query(this.schemaSql());
    }, { registerVectorTypes: false });
  }

  async observe(input: InstructionMonitorInput): Promise<InstructionRecord> {
    const record = fingerprintInstruction(input);
    this.assertEmbeddingDimensions(record.embedding, 'embedding');
    record.chunks?.forEach((chunk, index) => this.assertEmbeddingDimensions(chunk.embedding, `chunks[${index}].embedding`));
    if (!isReviewedAdversarialRecord(record)) return record;

    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const existing = await client.query<{ seed_immutable: boolean }>(
          'SELECT seed_immutable FROM instruction_records WHERE id = $1 FOR UPDATE',
          [record.id],
        );
        if (existing.rows[0]?.seed_immutable) {
          throw new Error(`Instruction record ${record.id} is an immutable seed record and cannot be overwritten.`);
        }

        await client.query(
          `INSERT INTO instruction_records
             (id, source, raw_text, normalized_text, sha256, sha256_loose,
              simhash, simhash_2gram, simhash_4gram, embedding, verdict, detection_flags,
              reviewed, labels, seed_metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   $13, $14, $15)
           ON CONFLICT (id) DO UPDATE SET
             source = EXCLUDED.source,
             raw_text = EXCLUDED.raw_text,
             normalized_text = EXCLUDED.normalized_text,
             sha256 = EXCLUDED.sha256,
             sha256_loose = EXCLUDED.sha256_loose,
             simhash = EXCLUDED.simhash,
             simhash_2gram = EXCLUDED.simhash_2gram,
             simhash_4gram = EXCLUDED.simhash_4gram,
             embedding = EXCLUDED.embedding,
             verdict = EXCLUDED.verdict,
             detection_flags = EXCLUDED.detection_flags,
             reviewed = EXCLUDED.reviewed,
             labels = EXCLUDED.labels,
             seed_metadata = EXCLUDED.seed_metadata,
             updated_at = NOW()`,
          [
            record.id,
            record.source,
            record.raw,
            record.normalized,
            record.sha256,
            record.sha256Loose,
            record.simhash.toString(),
            record.simhash2gram.toString(),
            record.simhash4gram.toString(),
            record.embedding ? pgvector.toSql(record.embedding) : null,
            record.verdict ?? null,
            record.detectionFlags ?? [],
            record.reviewed ?? false,
            record.labels ?? [],
            JSON.stringify(record.metadata ?? {}),
          ],
        );

        await client.query('DELETE FROM instruction_chunks WHERE instruction_id = $1', [record.id]);
	        for (let i = 0; i < (record.chunks?.length ?? 0); i++) {
	          const chunk = record.chunks?.[i];
	          if (!chunk) continue;
	          const chunkHash = createHash('sha256').update(chunk.text).digest('hex');
	          await client.query(
	            `INSERT INTO instruction_chunks
	               (instruction_id, chunk_index, chunk_text, chunk_hash, embedding, intent_score)
	             VALUES ($1, $2, $3, $4, $5, $6)`,
	            [record.id, i, chunk.text, chunkHash, pgvector.toSql(chunk.embedding), chunk.intentScore ?? 1],
	          );
	        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    return record;
  }

  async importSeedSnapshotFromFile(path: string, options: { allowChangedSeedRecords?: boolean } = {}): Promise<InstructionSeedImportResult> {
    const raw = await readFile(path, 'utf8');
    return this.importSeedSnapshot(JSON.parse(raw), options);
  }

  async importSeedSnapshot(input: unknown, options: { allowChangedSeedRecords?: boolean } = {}): Promise<InstructionSeedImportResult> {
    const snapshot = SeedSnapshotSchema.parse(input);
    if (snapshot.embeddingDimensions !== this.embeddingDimensions) {
      throw new Error(`Seed snapshot embeddingDimensions ${snapshot.embeddingDimensions} does not match monitor dimensions ${this.embeddingDimensions}.`);
    }

    const snapshotHash = hashSeedSnapshot(snapshot);
    if (snapshotHash !== snapshot.seedSnapshotHash) {
      throw new Error(`Seed snapshot hash mismatch. Expected ${snapshot.seedSnapshotHash}, calculated ${snapshotHash}.`);
    }

    for (const record of snapshot.records) {
      if (record.verdict !== 'ADVERSARIAL') {
        throw new Error(`Seed record ${record.id} is ${record.verdict}; only reviewed ADVERSARIAL records may be imported.`);
      }
      this.assertEmbeddingDimensions(record.embedding ?? undefined, `seed ${record.id}.embedding`);
      for (const chunk of record.chunks) {
        this.assertEmbeddingDimensions(chunk.embedding, `seed ${record.id}.chunks[${chunk.chunkIndex}].embedding`);
      }
      const recordHash = hashSeedRecord(record);
      if (recordHash !== record.seedRecordHash) {
        throw new Error(`Seed record ${record.id} hash mismatch. Expected ${record.seedRecordHash}, calculated ${recordHash}.`);
      }
    }

    let insertedRecords = 0;
    let skippedRecords = 0;
    let insertedChunks = 0;

    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        for (const record of snapshot.records) {
          const existing = await client.query<{ seed_record_hash: string | null; seed_immutable: boolean }>(
            'SELECT seed_record_hash, seed_immutable FROM instruction_records WHERE id = $1 FOR UPDATE',
            [record.id],
          );
          const row = existing.rows[0];
          if (row) {
            if (row.seed_record_hash === record.seedRecordHash) {
              skippedRecords += 1;
              continue;
            }
            if (!options.allowChangedSeedRecords) {
              throw new Error(`Instruction seed record ${record.id} exists with different content. Refusing to overwrite without explicit migration permission.`);
            }
          }

          await client.query(
            `INSERT INTO instruction_records
               (id, source, raw_text, normalized_text, sha256, sha256_loose,
                simhash, simhash_2gram, simhash_4gram, embedding, verdict, detection_flags,
                seed_pack, seed_version, seed_record_hash, seed_snapshot_hash, seed_immutable,
                seed_imported_at, seed_source, reviewed, labels, match_policy, seed_metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     $13, $14, $15, $16, TRUE, NOW(), $17, TRUE, $18, $19, $20)
             ON CONFLICT (id) DO UPDATE SET
               source = EXCLUDED.source,
               raw_text = EXCLUDED.raw_text,
               normalized_text = EXCLUDED.normalized_text,
               sha256 = EXCLUDED.sha256,
               sha256_loose = EXCLUDED.sha256_loose,
               simhash = EXCLUDED.simhash,
               simhash_2gram = EXCLUDED.simhash_2gram,
               simhash_4gram = EXCLUDED.simhash_4gram,
               embedding = EXCLUDED.embedding,
               verdict = EXCLUDED.verdict,
               detection_flags = EXCLUDED.detection_flags,
               seed_pack = EXCLUDED.seed_pack,
               seed_version = EXCLUDED.seed_version,
               seed_record_hash = EXCLUDED.seed_record_hash,
               seed_snapshot_hash = EXCLUDED.seed_snapshot_hash,
               seed_immutable = TRUE,
               seed_imported_at = NOW(),
               seed_source = EXCLUDED.seed_source,
               reviewed = TRUE,
               labels = EXCLUDED.labels,
               match_policy = EXCLUDED.match_policy,
               seed_metadata = EXCLUDED.seed_metadata,
               updated_at = NOW()`,
            [
              record.id,
              record.source,
              record.rawText,
              record.normalizedText,
              record.sha256,
              record.sha256Loose,
              record.simhash,
              record.simhash2gram,
              record.simhash4gram,
              record.embedding ? pgvector.toSql(record.embedding) : null,
              record.verdict,
              record.detectionFlags,
              snapshot.seedPack,
              snapshot.seedVersion,
              record.seedRecordHash,
              snapshot.seedSnapshotHash,
              snapshot.seedSource,
              record.labels,
              JSON.stringify(record.matchPolicy),
              JSON.stringify(record.metadata),
            ],
          );

          await client.query('DELETE FROM instruction_chunks WHERE instruction_id = $1', [record.id]);
          for (const chunk of record.chunks) {
            await client.query(
              `INSERT INTO instruction_chunks
                 (instruction_id, chunk_index, chunk_text, chunk_hash, embedding, intent_score)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [record.id, chunk.chunkIndex, chunk.chunkText, chunk.chunkHash, pgvector.toSql(chunk.embedding), chunk.intentScore],
            );
            insertedChunks += 1;
          }
          if (!row) insertedRecords += 1;
        }

        await client.query(
          `INSERT INTO instruction_seed_imports
             (seed_pack, seed_version, seed_snapshot_hash, seed_source, schema_version, record_count, imported_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (seed_pack, seed_version, seed_snapshot_hash) DO NOTHING`,
          [snapshot.seedPack, snapshot.seedVersion, snapshot.seedSnapshotHash, snapshot.seedSource, snapshot.schemaVersion, snapshot.records.length],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    return {
      seedPack: snapshot.seedPack,
      seedVersion: snapshot.seedVersion,
      seedSnapshotHash: snapshot.seedSnapshotHash,
      insertedRecords,
      skippedRecords,
      insertedChunks,
    };
  }

  async exportCoreSeedSnapshotToFile(path: string, options: {
    seedVersion: string;
    seedSource: string;
    includeExistingSeedRecords?: boolean;
  }): Promise<InstructionSeedExportResult> {
    const snapshot = await this.exportCoreSeedSnapshot(options);
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return {
      seedPack: snapshot.seedPack,
      seedVersion: snapshot.seedVersion,
      seedSnapshotHash: snapshot.seedSnapshotHash,
      exportedRecords: snapshot.records.length,
      exportedChunks: snapshot.records.reduce((count, record) => count + record.chunks.length, 0),
      outputPath: path,
    };
  }

  async exportCoreSeedSnapshot(options: {
    seedVersion: string;
    seedSource: string;
    includeExistingSeedRecords?: boolean;
  }): Promise<z.infer<typeof SeedSnapshotSchema>> {
    const recordResult = await this.pool.query<{
      id: string;
      source: string;
      raw_text: string;
      normalized_text: string;
      sha256: string;
      sha256_loose: string;
      simhash: string;
      simhash_2gram: string;
      simhash_4gram: string;
      embedding: number[] | string | null;
      verdict: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL';
      detection_flags: string[];
      reviewed: boolean;
      labels: string[];
      match_policy: Record<string, unknown>;
      seed_metadata: Record<string, unknown>;
    }>(
	      `WITH eligible_records AS (
	         SELECT id, source, raw_text, normalized_text, sha256, sha256_loose,
	                simhash, simhash_2gram, simhash_4gram, embedding, verdict,
	                detection_flags, reviewed, labels, match_policy, seed_metadata, created_at
	         FROM instruction_records
	         WHERE verdict = 'ADVERSARIAL'
	           AND reviewed = TRUE
	           AND ($1::boolean OR seed_pack IS NULL)
	       ),
	       deduped_records AS (
	         SELECT DISTINCT ON (sha256)
	                id, source, raw_text, normalized_text, sha256, sha256_loose,
	                simhash, simhash_2gram, simhash_4gram, embedding, verdict,
	                detection_flags, reviewed, labels, match_policy, seed_metadata
	         FROM eligible_records
	         ORDER BY sha256, (embedding IS NULL), created_at, id
	       )
	       SELECT id, source, raw_text, normalized_text, sha256, sha256_loose,
	              simhash::text, simhash_2gram::text, simhash_4gram::text, embedding,
	              verdict, detection_flags, reviewed, labels, match_policy, seed_metadata
	       FROM deduped_records
	       ORDER BY id`,
	      [options.includeExistingSeedRecords === true],
	    );

    const records = [];
    for (const row of recordResult.rows) {
      const chunkResult = await this.pool.query<{
        chunk_index: number;
        chunk_text: string;
        chunk_hash: string | null;
        embedding: number[] | string;
        intent_score: number | string;
      }>(
        `SELECT chunk_index, chunk_text, chunk_hash, embedding, intent_score
         FROM instruction_chunks
         WHERE instruction_id = $1
         ORDER BY chunk_index`,
        [row.id],
      );

      const chunks = chunkResult.rows.map((chunk) => {
        const chunkText = chunk.chunk_text;
        return {
          chunkIndex: chunk.chunk_index,
          chunkText,
          chunkHash: chunk.chunk_hash ?? createHash('sha256').update(chunkText).digest('hex'),
          embedding: parseVectorValue(chunk.embedding),
          intentScore: Number(chunk.intent_score),
        };
      });

      const recordWithoutHash = {
        id: row.id,
        source: this.toInstructionSource(row.source),
        rawText: row.raw_text,
        normalizedText: row.normalized_text,
        sha256: row.sha256,
        sha256Loose: row.sha256_loose,
        simhash: row.simhash,
        simhash2gram: row.simhash_2gram,
        simhash4gram: row.simhash_4gram,
        embedding: row.embedding === null ? null : parseVectorValue(row.embedding),
        verdict: row.verdict,
        detectionFlags: row.detection_flags ?? [],
        reviewed: true as const,
        labels: row.labels ?? [],
        matchPolicy: row.match_policy ?? {},
        metadata: row.seed_metadata ?? {},
        chunks,
      };
      records.push({
        ...recordWithoutHash,
        seedRecordHash: hashSeedRecord(recordWithoutHash),
      });
    }

    const snapshotWithoutHash = {
      schemaVersion: 1 as const,
      seedPack: 'core' as const,
      seedVersion: options.seedVersion,
      seedSource: options.seedSource,
      exportedAt: new Date().toISOString(),
      embeddingDimensions: this.embeddingDimensions,
      records,
    };

    return {
      ...snapshotWithoutHash,
      seedSnapshotHash: hashSeedSnapshot(snapshotWithoutHash),
    };
  }

  async compare(record: InstructionRecord): Promise<InstructionMonitorCompareResult> {
    const candidates = new Map<string, CandidatePartial>();
    const chunkAcc = new Map<string, ChunkAcc>();
    const merge = (id: string, data: Omit<CandidatePartial, 'targetId'>) => {
      candidates.set(id, { targetId: id, ...candidates.get(id), ...data });
    };

    const [exactResult, simhashResult, vectorResult] = await Promise.all([
      this.pool.query<{ id: string; sha256: string; source: string; verdict: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL' | null; exact_match: boolean; loose_exact_match: boolean }>(
        `SELECT id, sha256, source, verdict,
                (sha256 = $1) AS exact_match,
                (sha256_loose = $2) AS loose_exact_match
         FROM instruction_records
         WHERE id != $3
           AND (sha256 = $1 OR sha256_loose = $2)`,
        [record.sha256, record.sha256Loose, record.id],
      ),
      this.pool.query<{ id: string; sha256: string; source: string; verdict: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL' | null; dist3: string; dist2: string; dist4: string }>(
        `SELECT id, sha256, source, verdict,
                bit_count(simhash::bit(64)       # $1::bigint::bit(64)) AS dist3,
                bit_count(simhash_2gram::bit(64) # $2::bigint::bit(64)) AS dist2,
                bit_count(simhash_4gram::bit(64) # $3::bigint::bit(64)) AS dist4
         FROM instruction_records
         WHERE id != $4
           AND (
                 bit_count(simhash::bit(64)       # $1::bigint::bit(64)) <= $5
              OR bit_count(simhash_2gram::bit(64) # $2::bigint::bit(64)) <= $5
              OR bit_count(simhash_4gram::bit(64) # $3::bigint::bit(64)) <= $5
               )`,
        [
          record.simhash.toString(),
          record.simhash2gram.toString(),
          record.simhash4gram.toString(),
          record.id,
          this.hammingThreshold,
        ],
      ),
      record.embedding
        ? this.pool.query<{ id: string; sha256: string; source: string; verdict: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL' | null; similarity: string }>(
            `SELECT id, sha256, source, verdict,
                    1 - (embedding <=> $1::vector) AS similarity
             FROM instruction_records
             WHERE id != $2 AND embedding IS NOT NULL
             ORDER BY embedding <=> $1::vector
             LIMIT $3`,
            [pgvector.toSql(record.embedding), record.id, this.compareLimit * 4],
          )
        : Promise.resolve({ rows: [] }),
    ]);

    for (const row of exactResult.rows) {
      merge(row.id, {
        targetHash: row.sha256,
        source: row.source,
        targetVerdict: row.verdict,
        exactMatch: row.exact_match,
        looseExactMatch: row.loose_exact_match,
      });
    }

    for (const row of simhashResult.rows) {
      merge(row.id, {
        targetHash: row.sha256,
        source: row.source,
        targetVerdict: row.verdict,
        hammingDistance: Number(row.dist3),
        hammingDistance2gram: Number(row.dist2),
        hammingDistance4gram: Number(row.dist4),
      });
    }

    for (const row of vectorResult.rows) {
      const similarity = Number(row.similarity);
      if (similarity >= this.similarityThreshold) {
        merge(row.id, {
          targetHash: row.sha256,
          source: row.source,
          targetVerdict: row.verdict,
          cosineSimilarity: similarity,
        });
      }
    }

    const chunkRows = await this.runChunkQueries(record);
    for (const row of chunkRows) {
      const incomingIntent = record.chunks?.[row.incomingIndex]?.intentScore ?? 1;
      const weight = incomingIntent * Number(row.intent_score);
      const acc = chunkAcc.get(row.instruction_id) ?? { maxSim: 0, weightedSum: 0, weightSum: 0 };
      acc.maxSim = Math.max(acc.maxSim, Number(row.similarity));
      acc.weightedSum += Number(row.similarity) * weight;
      acc.weightSum += weight;
      chunkAcc.set(row.instruction_id, acc);
      merge(row.instruction_id, {
        targetHash: row.target_hash,
        source: row.source,
        targetVerdict: row.verdict,
      });
    }

    for (const [id, acc] of chunkAcc) {
      const attentionPooled = acc.weightSum > 0 ? acc.weightedSum / acc.weightSum : null;
      if (
        acc.maxSim >= this.similarityThreshold ||
        (attentionPooled !== null && attentionPooled >= 0.70) ||
        acc.maxSim >= 0.72
      ) {
        merge(id, {
          maxChunkSimilarity: acc.maxSim,
          attentionPooledChunkSimilarity: attentionPooled ?? undefined,
        });
      }
    }

    const matches = Array.from(candidates.values())
      .map((partial): InstructionMatch => {
        const maxChunkSimilarity = partial.maxChunkSimilarity ?? null;
        const cosineSimilarity = partial.cosineSimilarity ?? null;
        const match: InstructionMatch = {
          targetId: partial.targetId,
          targetHash: partial.targetHash ?? partial.targetId,
          source: this.toInstructionSource(partial.source),
          targetVerdict: partial.targetVerdict ?? null,
          exactMatch: partial.exactMatch ?? false,
          looseExactMatch: partial.looseExactMatch ?? false,
          hammingDistance: partial.hammingDistance ?? 64,
          hammingDistance2gram: partial.hammingDistance2gram ?? 64,
          hammingDistance4gram: partial.hammingDistance4gram ?? 64,
          cosineSimilarity,
          maxChunkSimilarity,
          attentionPooledChunkSimilarity: partial.attentionPooledChunkSimilarity ?? null,
          sandwichDelta: maxChunkSimilarity !== null && cosineSimilarity !== null ? maxChunkSimilarity - cosineSimilarity : null,
          risk: 'low',
        };
        match.risk = classifyInstructionRisk(match);
        return match;
      })
      .filter((match) => match.risk !== 'low')
      .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk])
      .slice(0, this.compareLimit);

    return {
      matches,
      highestRisk: matches[0]?.risk ?? 'low',
    };
  }

  async compareAndObserve(input: InstructionMonitorInput): Promise<InstructionMonitorCompareResult> {
    const record = fingerprintInstruction(input);
    const result = await this.compare(record);
    await this.observe(input);
    return result;
  }

  async lookupRecord(identifier: string): Promise<InstructionRecordLookup | null> {
    const recordResult = await this.pool.query<{
      id: string;
      source: string;
      raw_text: string;
      normalized_text: string;
      sha256: string;
      sha256_loose: string;
      simhash: string;
      simhash_2gram: string;
      simhash_4gram: string;
      verdict: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL' | null;
      detection_flags: string[];
      reviewed: boolean;
      labels: string[];
      seed_pack: string | null;
      seed_version: string | null;
      seed_source: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, source, raw_text, normalized_text, sha256, sha256_loose,
              simhash::text, simhash_2gram::text, simhash_4gram::text,
              verdict, detection_flags, reviewed, labels, seed_pack, seed_version,
              seed_source, created_at, updated_at
       FROM instruction_records
       WHERE id = $1 OR sha256 = $1 OR sha256_loose = $1
       LIMIT 1`,
      [identifier],
    );
    const row = recordResult.rows[0];
    if (!row) return null;

    const chunkResult = await this.pool.query<{
      chunk_index: number;
      chunk_text: string;
      chunk_hash: string | null;
      intent_score: number | string;
    }>(
      `SELECT chunk_index, chunk_text, chunk_hash, intent_score
       FROM instruction_chunks
       WHERE instruction_id = $1
       ORDER BY chunk_index`,
      [row.id],
    );

    return {
      id: row.id,
      source: this.toInstructionSource(row.source),
      rawText: row.raw_text,
      normalizedText: row.normalized_text,
      sha256: row.sha256,
      sha256Loose: row.sha256_loose,
      simhash: row.simhash,
      simhash2gram: row.simhash_2gram,
      simhash4gram: row.simhash_4gram,
      verdict: row.verdict,
      detectionFlags: row.detection_flags ?? [],
      reviewed: row.reviewed,
      labels: row.labels ?? [],
      seedPack: row.seed_pack,
      seedVersion: row.seed_version,
      seedSource: row.seed_source,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      chunks: chunkResult.rows.map((chunk) => ({
        chunkIndex: chunk.chunk_index,
        chunkText: chunk.chunk_text,
        chunkHash: chunk.chunk_hash,
        intentScore: Number(chunk.intent_score),
      })),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async runChunkQueries(record: InstructionRecord) {
    type ChunkRow = {
      incomingIndex: number;
      instruction_id: string;
      target_hash: string;
      source: string;
      verdict: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL' | null;
      similarity: string;
      intent_score: string;
    };
    const rows: ChunkRow[] = [];
    const chunks = record.chunks ?? [];

    for (let i = 0; i < chunks.length; i += this.chunkQueryConcurrency) {
      const batch = chunks.slice(i, i + this.chunkQueryConcurrency);
      const batchRows = await Promise.all(batch.map(async (chunk, offset) => {
        const incomingIndex = i + offset;
        const result = await this.pool.query<Omit<ChunkRow, 'incomingIndex'>>(
          `SELECT c.instruction_id,
                  r.sha256 AS target_hash,
                  r.source,
                  r.verdict,
                  1 - (c.embedding <=> $1::vector) AS similarity,
                  c.intent_score
           FROM instruction_chunks c
           JOIN instruction_records r ON r.id = c.instruction_id
           WHERE c.instruction_id != $2
           ORDER BY c.embedding <=> $1::vector
           LIMIT $3`,
          [pgvector.toSql(chunk.embedding), record.id, this.compareLimit * 4],
        );
        return result.rows.map((row) => ({ ...row, incomingIndex }));
      }));
      rows.push(...batchRows.flat());
    }

    return rows;
  }

  private async withClient<T>(
    fn: (client: PoolClient) => Promise<T>,
    options: { registerVectorTypes?: boolean } = {},
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      if (options.registerVectorTypes !== false) await this.registerVectorTypes(client);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private async registerVectorTypes(client: PoolClient): Promise<void> {
    if (this.registeredClients.has(client)) return;
    await pgvector.registerTypes(client);
    this.registeredClients.add(client);
  }

  private schemaSql() {
    return `
CREATE TABLE IF NOT EXISTS instruction_records (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  raw_text        TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  sha256_loose    TEXT NOT NULL,
  simhash         BIGINT NOT NULL,
  simhash_2gram   BIGINT NOT NULL,
  simhash_4gram   BIGINT NOT NULL,
	  embedding       vector(${this.embeddingDimensions}),
	  verdict         TEXT,
	  detection_flags TEXT[] NOT NULL DEFAULT '{}',
	  seed_pack       TEXT,
	  seed_version    TEXT,
	  seed_record_hash TEXT,
	  seed_snapshot_hash TEXT,
	  seed_immutable  BOOLEAN NOT NULL DEFAULT FALSE,
	  seed_imported_at TIMESTAMPTZ,
	  seed_source     TEXT,
	  reviewed        BOOLEAN NOT NULL DEFAULT FALSE,
	  labels          TEXT[] NOT NULL DEFAULT '{}',
	  match_policy    JSONB NOT NULL DEFAULT '{}'::jsonb,
	  seed_metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
	  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

CREATE TABLE IF NOT EXISTS instruction_chunks (
  id              BIGSERIAL PRIMARY KEY,
	  instruction_id  TEXT NOT NULL REFERENCES instruction_records(id) ON DELETE CASCADE,
	  chunk_index     INTEGER NOT NULL,
	  chunk_text      TEXT NOT NULL,
	  chunk_hash      TEXT,
	  embedding       vector(${this.embeddingDimensions}) NOT NULL,
	  intent_score    REAL NOT NULL DEFAULT 1,
	  UNIQUE (instruction_id, chunk_index)
	);

CREATE TABLE IF NOT EXISTS instruction_seed_imports (
  id                 BIGSERIAL PRIMARY KEY,
  seed_pack          TEXT NOT NULL,
  seed_version       TEXT NOT NULL,
  seed_snapshot_hash TEXT NOT NULL,
  seed_source        TEXT NOT NULL,
  schema_version     INTEGER NOT NULL,
  record_count       INTEGER NOT NULL,
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (seed_pack, seed_version, seed_snapshot_hash)
);

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS seed_pack TEXT;
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS seed_version TEXT;
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS seed_record_hash TEXT;
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS seed_snapshot_hash TEXT;
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS seed_immutable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS seed_imported_at TIMESTAMPTZ;
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS seed_source TEXT;
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS reviewed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS match_policy JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE instruction_records ADD COLUMN IF NOT EXISTS seed_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE instruction_chunks ADD COLUMN IF NOT EXISTS chunk_hash TEXT;

	CREATE INDEX IF NOT EXISTS idx_instruction_sha256 ON instruction_records (sha256);
	CREATE INDEX IF NOT EXISTS idx_instruction_sha256_loose ON instruction_records (sha256_loose);
CREATE INDEX IF NOT EXISTS idx_instruction_seed_pack ON instruction_records (seed_pack);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instruction_seed_record_hash
  ON instruction_records (seed_pack, seed_record_hash)
  WHERE seed_pack IS NOT NULL;
	CREATE INDEX IF NOT EXISTS idx_instruction_embedding_hnsw
  ON instruction_records USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_instruction_chunks_embedding_hnsw
  ON instruction_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_instruction_chunks_instruction_id
  ON instruction_chunks (instruction_id);
`;
  }

  private assertEmbeddingDimensions(embedding: number[] | undefined, label: string) {
    if (embedding && embedding.length !== this.embeddingDimensions) {
      throw new Error(`${label} must contain ${this.embeddingDimensions} dimensions.`);
    }
  }

  private toInstructionSource(source: string | undefined): InstructionMatch['source'] {
    if (
      source === 'analyst_chat' ||
      source === 'bulk_ingest' ||
      source === 'ctf_chat' ||
      source === 'ctf_solve' ||
      source === 'playground' ||
      source === 'system'
    ) {
      return source;
    }
    return 'system';
  }
}

const RISK_ORDER: Record<InstructionRisk, number> = { high: 0, medium: 1, low: 2 };

export function classifyInstructionRisk(
  match: Pick<
    InstructionMatch,
    | 'exactMatch'
    | 'looseExactMatch'
    | 'hammingDistance'
    | 'hammingDistance2gram'
    | 'hammingDistance4gram'
    | 'cosineSimilarity'
    | 'maxChunkSimilarity'
    | 'attentionPooledChunkSimilarity'
    | 'sandwichDelta'
    | 'targetVerdict'
  >,
): InstructionRisk {
  const bestHamming = Math.min(match.hammingDistance, match.hammingDistance2gram, match.hammingDistance4gram);
  const hasFingerprintMatch = match.exactMatch || match.looseExactMatch || bestHamming <= 12;
  const hasSemanticMatch =
    (match.cosineSimilarity !== null && match.cosineSimilarity > 0.78) ||
    (match.attentionPooledChunkSimilarity !== null && match.attentionPooledChunkSimilarity > 0.70) ||
    (match.maxChunkSimilarity !== null && match.maxChunkSimilarity > 0.72) ||
    (
      match.sandwichDelta !== null &&
      match.sandwichDelta > 0.20 &&
      match.maxChunkSimilarity !== null &&
      match.maxChunkSimilarity > 0.72
    );

  if (match.targetVerdict === 'ADVERSARIAL' && hasFingerprintMatch) return 'high';
  if (hasSemanticMatch) return 'medium';
  if (match.targetVerdict === 'CLEAN') return 'low';
  if (hasFingerprintMatch) return 'medium';

  return 'low';
}

function isReviewedAdversarialRecord(record: InstructionRecord): boolean {
  return record.verdict === 'ADVERSARIAL' && record.reviewed === true;
}

function hashSeedRecord(record: Omit<z.infer<typeof SeedRecordSchema>, 'seedRecordHash'>): string {
  return sha256Canonical({
    chunks: record.chunks,
    detectionFlags: record.detectionFlags,
    embedding: record.embedding,
    id: record.id,
    labels: record.labels,
    matchPolicy: record.matchPolicy,
    metadata: record.metadata,
    normalizedText: record.normalizedText,
    rawText: record.rawText,
    reviewed: record.reviewed,
    sha256: record.sha256,
    sha256Loose: record.sha256Loose,
    simhash: record.simhash,
    simhash2gram: record.simhash2gram,
    simhash4gram: record.simhash4gram,
    source: record.source,
    verdict: record.verdict,
  });
}

function hashSeedSnapshot(snapshot: Omit<z.infer<typeof SeedSnapshotSchema>, 'seedSnapshotHash'>): string {
  return sha256Canonical({
    embeddingDimensions: snapshot.embeddingDimensions,
    exportedAt: snapshot.exportedAt,
    records: snapshot.records.map((record) => ({
      id: record.id,
      seedRecordHash: record.seedRecordHash,
    })),
    schemaVersion: snapshot.schemaVersion,
    seedPack: snapshot.seedPack,
    seedSource: snapshot.seedSource,
    seedVersion: snapshot.seedVersion,
  });
}

function parseVectorValue(value: number[] | string): number[] {
  if (Array.isArray(value)) return value.map(Number);
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .filter(Boolean)
    .map(Number);
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

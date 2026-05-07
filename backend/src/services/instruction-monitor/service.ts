import { Pool, type PoolClient, type PoolConfig } from 'pg';
import pgvector from 'pgvector/pg';
import { fingerprintInstruction } from './fingerprint.js';
import type {
  InstructionMatch,
  InstructionMonitorCompareResult,
  InstructionMonitorInput,
  InstructionRecord,
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

export class PgvectorInstructionMonitor {
  private readonly pool: Pool;
  private readonly registeredClients = new WeakSet<PoolClient>();
  private readonly embeddingDimensions: number;
  private readonly compareLimit: number;
  private readonly similarityThreshold: number;
  private readonly hammingThreshold: number;
  private readonly chunkQueryConcurrency: number;

  constructor(options: MonitorOptions) {
    this.embeddingDimensions = options.embeddingDimensions ?? 1536;
    this.compareLimit = options.compareLimit ?? 10;
    this.similarityThreshold = options.similarityThreshold ?? 0.78;
    this.hammingThreshold = options.hammingThreshold ?? 12;
    this.chunkQueryConcurrency = options.chunkQueryConcurrency ?? 4;
    this.pool = new Pool({
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

    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO instruction_records
             (id, source, raw_text, normalized_text, sha256, sha256_loose,
              simhash, simhash_2gram, simhash_4gram, embedding, verdict, detection_flags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
          ],
        );

        await client.query('DELETE FROM instruction_chunks WHERE instruction_id = $1', [record.id]);
        for (let i = 0; i < (record.chunks?.length ?? 0); i++) {
          const chunk = record.chunks?.[i];
          if (!chunk) continue;
          await client.query(
            `INSERT INTO instruction_chunks
               (instruction_id, chunk_index, chunk_text, embedding, intent_score)
             VALUES ($1, $2, $3, $4, $5)`,
            [record.id, i, chunk.text, pgvector.toSql(chunk.embedding), chunk.intentScore ?? 1],
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
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instruction_chunks (
  id              BIGSERIAL PRIMARY KEY,
  instruction_id  TEXT NOT NULL REFERENCES instruction_records(id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL,
  chunk_text      TEXT NOT NULL,
  embedding       vector(${this.embeddingDimensions}) NOT NULL,
  intent_score    REAL NOT NULL DEFAULT 1,
  UNIQUE (instruction_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_instruction_sha256 ON instruction_records (sha256);
CREATE INDEX IF NOT EXISTS idx_instruction_sha256_loose ON instruction_records (sha256_loose);
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

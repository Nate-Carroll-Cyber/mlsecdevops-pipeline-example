export type InstructionSource =
  | 'analyst_chat'
  | 'bulk_ingest'
  | 'ctf_chat'
  | 'ctf_solve'
  | 'playground'
  | 'system';

export type InstructionRisk = 'low' | 'medium' | 'high';

export type InstructionChunkInput = {
  text: string;
  embedding: number[];
  intentScore?: number;
};

export type InstructionMonitorInput = {
  id: string;
  source: InstructionSource;
  text: string;
  embedding?: number[];
  chunks?: InstructionChunkInput[];
  verdict?: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL';
  detectionFlags?: string[];
  reviewed?: boolean;
  labels?: string[];
  metadata?: Record<string, unknown>;
};

export type InstructionRecord = {
  id: string;
  source: InstructionSource;
  raw: string;
  normalized: string;
  sha256: string;
  sha256Loose: string;
  simhash: bigint;
  simhash2gram: bigint;
  simhash4gram: bigint;
  embedding?: number[];
  chunks?: InstructionChunkInput[];
  verdict?: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL';
  detectionFlags?: string[];
  reviewed?: boolean;
  labels?: string[];
  metadata?: Record<string, unknown>;
};

export type InstructionMatch = {
  targetId: string;
  targetHash: string;
  source: InstructionSource;
  targetVerdict: 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL' | null;
  exactMatch: boolean;
  looseExactMatch: boolean;
  hammingDistance: number;
  hammingDistance2gram: number;
  hammingDistance4gram: number;
  cosineSimilarity: number | null;
  maxChunkSimilarity: number | null;
  attentionPooledChunkSimilarity: number | null;
  sandwichDelta: number | null;
  risk: InstructionRisk;
};

export type InstructionMonitorCompareResult = {
  matches: InstructionMatch[];
  highestRisk: InstructionRisk;
};

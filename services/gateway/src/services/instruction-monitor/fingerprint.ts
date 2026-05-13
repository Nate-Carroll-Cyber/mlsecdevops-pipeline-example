import { createHash } from 'node:crypto';
import type { InstructionChunkInput, InstructionMonitorInput, InstructionRecord } from './types.js';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your',
  'his', 'her', 'its', 'our', 'their', 'please', 'now', 'just', 'all',
]);

const INJECTION_VERBS = new Set([
  'ignore', 'forget', 'disregard', 'override', 'bypass', 'pretend', 'act',
  'assume', 'roleplay', 'simulate', 'execute', 'reveal', 'leak', 'expose',
]);

const INJECTION_PHRASES = [
  'previous instructions',
  'system prompt',
  'you are now',
  'your new role',
  'from now on',
  'new persona',
  'ignore all',
  'disregard all',
  'forget everything',
  'act as',
  'you must now',
];

export function normalizeInstruction(text: string): string {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' CODE_BLOCK ')
    .replace(/https?:\/\/\S+/g, ' URL ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLoose(normalizedText: string): string {
  return normalizedText
    .split(' ')
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .join(' ');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function toSignedInt64(value: bigint): bigint {
  return value >= 2n ** 63n ? value - 2n ** 64n : value;
}

export function simhash(text: string, shingleSize: number): bigint {
  const tokens = shingle(text, shingleSize);
  const vector = new Array<number>(64).fill(0);

  for (const token of tokens) {
    const hash = createHash('sha256').update(token).digest();
    const value = hash.readBigUInt64BE(0);
    for (let i = 0; i < 64; i++) {
      vector[i] = (vector[i] ?? 0) + (((value >> BigInt(i)) & 1n) ? 1 : -1);
    }
  }

  let result = 0n;
  for (let i = 0; i < 64; i++) {
    if ((vector[i] ?? 0) > 0) result |= 1n << BigInt(i);
  }
  return result;
}

export function chunkText(
  text: string,
  { windowWords = 100, stepWords = 50 }: { windowWords?: number; stepWords?: number } = {},
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= windowWords) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += stepWords) {
    chunks.push(words.slice(i, Math.min(i + windowWords, words.length)).join(' '));
    if (i + windowWords >= words.length) break;
  }
  return chunks;
}

export function heuristicIntentScore(text: string): number {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  let score = 0;

  for (let i = 0; i < Math.min(3, words.length); i++) {
    if (INJECTION_VERBS.has(words[i] ?? '')) {
      score += 0.35;
      break;
    }
  }

  for (const phrase of INJECTION_PHRASES) {
    if (lower.includes(phrase)) {
      score += 0.25;
      break;
    }
  }

  if (words.length <= 20) score += 0.1;
  return Math.min(1, score);
}

export function fingerprintInstruction(input: InstructionMonitorInput): InstructionRecord {
  const normalized = normalizeInstruction(input.text);
  const loose = normalizeLoose(normalized);
  const chunks = input.chunks?.map((chunk): InstructionChunkInput => ({
    ...chunk,
    intentScore: chunk.intentScore ?? heuristicIntentScore(chunk.text),
  }));

  return {
    id: input.id,
    source: input.source,
    raw: input.text,
    normalized,
    sha256: sha256(normalized),
    sha256Loose: sha256(loose),
    simhash: toSignedInt64(simhash(normalized, 3)),
    simhash2gram: toSignedInt64(simhash(normalized, 2)),
    simhash4gram: toSignedInt64(simhash(normalized, 4)),
    embedding: input.embedding,
    chunks,
    verdict: input.verdict,
    detectionFlags: input.detectionFlags,
    reviewed: input.reviewed,
    labels: input.labels,
    metadata: input.metadata,
  };
}

function shingle(text: string, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < size) return words;
  const out: string[] = [];
  for (let i = 0; i <= words.length - size; i++) {
    out.push(words.slice(i, i + size).join(' '));
  }
  return out;
}

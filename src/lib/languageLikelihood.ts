import { normalizeWithoutLeet } from './sanitizerNormalization';

const REDACTED_PLACEHOLDER_REGEX = /\[REDACTED_([A-Z_]+)\]/g;

export const ENGLISH_TRIGRAMS = new Set([
  'the', 'and', 'ing', 'ion', 'tio', 'ent', 'ati', 'for', 'her', 'tha', 'nth',
  'int', 'ere', 'ter', 'est', 'ers', 'hat', 'ate', 'all', 'eth', 'his', 'ver',
  'wit', 'thi', 'oth', 'res', 'ont', 'rea', 'eve', 'not', 'you', 'are', 'was',
  'but', 'use', 'our', 'out', 'str', 'sys', 'pro', 'req', 'sen', 'sho', 'con',
  'ple', 'ase', 'msg', 'ing', 'ide', 'com', 'sec', 'pol', 'tri', 'ans', 'tim',
  'lat', 'gue', 'que', 'log', 'red', 'act', 'exp', 'ect', 'tra', 'ate', 'rom',
]);

export interface LanguageLikelihoodAnalysis {
  trigramHitRate: number;
  bestCaesarShiftTrigramRate: number;
  lowNaturalLanguageLikelihood: boolean;
  tokenCount: number;
  uniqueTokenRate: number;
  averageTokenLength: number;
}

function normalizeForEnglishLikelihood(input: string): string {
  return normalizeWithoutLeet(input)
    .replace(REDACTED_PLACEHOLDER_REGEX, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getEnglishTrigramHitRate(input: string): number {
  const lettersOnly = input.replace(/\s+/g, '');
  if (lettersOnly.length < 12) return 0;

  let total = 0;
  let hits = 0;
  for (let index = 0; index <= lettersOnly.length - 3; index += 1) {
    total += 1;
    if (ENGLISH_TRIGRAMS.has(lettersOnly.slice(index, index + 3))) {
      hits += 1;
    }
  }

  return total > 0 ? hits / total : 0;
}

function shiftCaesarText(input: string, shift: number): string {
  return [...input].map((char) => {
    if (!/[a-z]/.test(char)) return char;
    const base = 'a'.charCodeAt(0);
    const normalized = char.charCodeAt(0) - base;
    return String.fromCharCode(((normalized - shift + 26) % 26) + base);
  }).join('');
}

// Detect alphabetic gibberish that still looks like spaced prose by comparing
// normalized character trigrams and bounded Caesar-shift recovery. This is used
// as an obfuscation-family signal, not as a generic "bad writing" detector.
export function analyzeLanguageLikelihood(input: string): LanguageLikelihoodAnalysis {
  const normalized = normalizeForEnglishLikelihood(input);
  const zeroResult: LanguageLikelihoodAnalysis = {
    trigramHitRate: 0,
    bestCaesarShiftTrigramRate: 0,
    lowNaturalLanguageLikelihood: false,
    tokenCount: 0,
    uniqueTokenRate: 0,
    averageTokenLength: 0,
  };

  if (!normalized) return zeroResult;

  const tokens = normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  if (tokens.length < 4) return zeroResult;

  const vowelishTokens = tokens.filter((token) => /[aeiouy]/.test(token));
  if (vowelishTokens.length / tokens.length < 0.4) {
    return {
      ...zeroResult,
      tokenCount: tokens.length,
      uniqueTokenRate: parseFloat((new Set(tokens).size / tokens.length).toFixed(3)),
      averageTokenLength: parseFloat((tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length).toFixed(1)),
    };
  }

  const uniqueTokenRate = new Set(tokens).size / tokens.length;
  const averageTokenLength = tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length;
  const originalTrigramRate = getEnglishTrigramHitRate(normalized);

  let bestShiftRate = 0;
  for (let shift = 1; shift < 26; shift += 1) {
    bestShiftRate = Math.max(bestShiftRate, getEnglishTrigramHitRate(shiftCaesarText(normalized, shift)));
  }

  const lowNaturalLanguageLikelihood = uniqueTokenRate >= 0.75 &&
    averageTokenLength >= 4.2 &&
    (
      (originalTrigramRate <= 0.035 && bestShiftRate >= 0.16 && bestShiftRate - originalTrigramRate >= 0.08) ||
      (originalTrigramRate <= 0.025 && tokens.length >= 7) ||
      (originalTrigramRate <= 0.005 && bestShiftRate >= 0.07)
    );

  return {
    trigramHitRate: parseFloat(originalTrigramRate.toFixed(3)),
    bestCaesarShiftTrigramRate: parseFloat(bestShiftRate.toFixed(3)),
    lowNaturalLanguageLikelihood,
    tokenCount: tokens.length,
    uniqueTokenRate: parseFloat(uniqueTokenRate.toFixed(3)),
    averageTokenLength: parseFloat(averageTokenLength.toFixed(1)),
  };
}

export function hasLowNaturalLanguageLikelihood(input: string): boolean {
  return analyzeLanguageLikelihood(input).lowNaturalLanguageLikelihood;
}

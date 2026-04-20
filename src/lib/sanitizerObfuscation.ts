/**
 * Obfuscation analysis helpers for the frontend sanitizer.
 *
 * Reader guide:
 * 1. This file defines the decode/transform primitives used to recover hidden text.
 * 2. `extractDecodedSegments(...)` handles bounded recursive decoding for encoded payloads.
 * 3. `extractTransformedSegments(...)` handles non-encoding transforms like leetspeak,
 *    ROT13, and reverse text.
 * 4. `detectStructuralObfuscation(...)` flags wrapper patterns that look evasive even
 *    when they do not directly decode into plain text.
 * 5. `analyzeObfuscationInput(...)` is the main entry point used by `sanitizeInput(...)`.
 */
import { hasCompatibilityGlyphObfuscation, hasLeetspeakObfuscation, normalizeForPolicy, normalizeWithoutLeet } from './sanitizerNormalization';

export type DecodeTelemetry = 'plain_text' | 'single_hop_decode' | 'recursive_decode';

export type ObfuscationSignal =
  | 'URL_ENCODING'
  | 'HTML_ENTITIES'
  | 'UNICODE_ESCAPES'
  | 'COMPATIBILITY_GLYPHS'
  | 'SYMBOL_SUBSTITUTION'
  | 'LEETSPEAK'
  | 'ROT13'
  | 'REVERSE_TEXT'
  | 'NATO_PHONETIC'
  | 'MORSE_CODE'
  | 'BRAILLE'
  | 'REGIONAL_INDICATORS'
  | 'RECURSIVE_DECODE'
  | 'END_SEQUENCE'
  | 'CHUNKING'
  | 'VARIABLE_EXPANSION'
  | 'VERTICAL_TEXT';

const ZERO_WIDTH_CHAR_REGEX = /[\u200B-\u200D\u2060\uFEFF]/g;
const BASE64_SEGMENT_REGEX = /(?:^|[^A-Za-z0-9+/=])([A-Za-z0-9+/]{20,}={0,2})(?=$|[^A-Za-z0-9+/=])/g;
const HEX_SEGMENT_REGEX = /\b(?:0x)?(?:[A-Fa-f0-9]{2}){12,}\b/g;
const URL_SEGMENT_REGEX = /(?:%[0-9A-Fa-f]{2}){6,}/g;
const HTML_ENTITY_SEGMENT_REGEX = /(?:&#(?:x[0-9A-Fa-f]+|\d+);){4,}/g;
const UNICODE_ESCAPE_SEGMENT_REGEX = /(?:(?:\\u[0-9A-Fa-f]{4})|(?:\\x[0-9A-Fa-f]{2})){2,}/g;
const NATO_SEGMENT_REGEX = /\b(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-ray|xray|yankee|zulu)(?:\s+(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-ray|xray|yankee|zulu)){3,}\b/gi;
const MORSE_SEGMENT_REGEX = /(?:[.\-]+(?:\s+[.\-/]+){3,})/g;
const BRAILLE_SEGMENT_REGEX = /(?:[\u2800-\u28FF]+\s*){2,}/gu;
const REGIONAL_INDICATOR_SEGMENT_REGEX = /(?:[\u{1F1E6}-\u{1F1FF}]\s*){2,}/gu;
const MAX_DECODE_DEPTH = 3;
const MAX_DECODE_SEGMENTS = 24;
const END_SEQUENCE_REGEX = /<\/s>|<\|im_end\|>/i;
const CHUNKING_REGEX = /(?:^|\n)Part\s+\d+:\s+/i;
const VARIABLE_EXPANSION_REGEX = /\blet\s+v\d+\s*=|console\.log\(/i;
const VERTICAL_TEXT_REGEX = /^(?:.{1,2}\n){5,}.{1,2}$/m;
const NON_ASCII_REGEX = /[^\x00-\x7F]/;
const COMBINING_MARK_REGEX = /\p{M}/u;
const SYMBOL_LIKE_REGEX = /[\p{S}\p{M}]/u;

const NATO_WORD_TO_CHAR: Record<string, string> = {
  alpha: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f',
  golf: 'g', hotel: 'h', india: 'i', juliet: 'j', kilo: 'k', lima: 'l',
  mike: 'm', november: 'n', oscar: 'o', papa: 'p', quebec: 'q', romeo: 'r',
  sierra: 's', tango: 't', uniform: 'u', victor: 'v', whiskey: 'w',
  'x-ray': 'x', xray: 'x', yankee: 'y', zulu: 'z',
};

const MORSE_TO_CHAR: Record<string, string> = {
  '.-': 'a', '-...': 'b', '-.-.': 'c', '-..': 'd', '.': 'e', '..-.': 'f',
  '--.': 'g', '....': 'h', '..': 'i', '.---': 'j', '-.-': 'k', '.-..': 'l',
  '--': 'm', '-.': 'n', '---': 'o', '.--.': 'p', '--.-': 'q', '.-.': 'r',
  '...': 's', '-': 't', '..-': 'u', '...-': 'v', '.--': 'w', '-..-': 'x',
  '-.--': 'y', '--..': 'z', '/': ' ',
};

const BRAILLE_TO_CHAR: Record<string, string> = {
  '⠁': 'a', '⠃': 'b', '⠉': 'c', '⠙': 'd', '⠑': 'e', '⠋': 'f',
  '⠛': 'g', '⠓': 'h', '⠊': 'i', '⠚': 'j', '⠅': 'k', '⠇': 'l',
  '⠍': 'm', '⠝': 'n', '⠕': 'o', '⠏': 'p', '⠟': 'q', '⠗': 'r',
  '⠎': 's', '⠞': 't', '⠥': 'u', '⠧': 'v', '⠺': 'w', '⠭': 'x',
  '⠽': 'y', '⠵': 'z',
};

// Decode one likely-Base64 segment when it looks long enough and mostly printable.
function decodeBase64Segment(segment: string): string | null {
  if (segment.length % 4 !== 0 || segment.length < 24) return null;

  try {
    const decoded = typeof globalThis.atob === 'function'
      ? globalThis.atob(segment)
      : Buffer.from(segment, 'base64').toString('utf8');
    const printableRatio = decoded.split('').filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    }).length / decoded.length;

    return printableRatio >= 0.85 ? decoded : null;
  } catch {
    return null;
  }
}

// Decode one hex-encoded segment into printable text.
function decodeHexSegment(segment: string): string | null {
  const normalizedSegment = segment.startsWith('0x') ? segment.slice(2) : segment;
  if (normalizedSegment.length % 2 !== 0 || normalizedSegment.length < 24) return null;

  try {
    let decoded = '';
    for (let index = 0; index < normalizedSegment.length; index += 2) {
      decoded += String.fromCharCode(parseInt(normalizedSegment.slice(index, index + 2), 16));
    }
    const printableRatio = decoded.split('').filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    }).length / decoded.length;

    return printableRatio >= 0.85 ? decoded : null;
  } catch {
    return null;
  }
}

// Decode URL-encoded text when it materially changes the segment.
function decodeUrlSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded !== segment ? decoded : null;
  } catch {
    return null;
  }
}

// Decode repeated HTML entity sequences into plain text.
function decodeHtmlEntitySegment(segment: string): string | null {
  try {
    const decoded = segment.replace(/&#(?:x([0-9A-Fa-f]+)|(\d+));/g, (_, hex, decimal) =>
      String.fromCharCode(parseInt(hex || decimal, hex ? 16 : 10)));
    return decoded !== segment ? decoded : null;
  } catch {
    return null;
  }
}

// Decode escaped byte sequences such as \u0072\u0065 or \x72\x65 back into text.
function decodeUnicodeEscapeSegment(segment: string): string | null {
  try {
    const decoded = segment
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return decoded !== segment ? decoded : null;
  } catch {
    return null;
  }
}

// Convert a NATO phonetic sequence back into letters.
function decodeNatoSegment(segment: string): string | null {
  const words = segment.toLowerCase().trim().split(/\s+/);
  if (words.length < 4) return null;
  const decoded = words.map((word) => NATO_WORD_TO_CHAR[word]).join('');
  return decoded && !decoded.includes('undefined') ? decoded : null;
}

// Convert a Morse-code-like sequence back into letters/spaces.
function decodeMorseSegment(segment: string): string | null {
  const tokens = segment.trim().split(/\s+/);
  if (tokens.length < 4) return null;
  const decoded = tokens.map((token) => MORSE_TO_CHAR[token]).join('');
  return decoded && !decoded.includes('undefined') ? decoded : null;
}

// Decode unicode braille cells back into Latin letters for common grade-1 style prompts.
function decodeBrailleSegment(segment: string): string | null {
  const cells = [...segment];
  if (cells.length < 2) return null;
  let makeNextUppercase = false;
  let decoded = '';
  for (const cell of cells) {
    if (cell === ' ') {
      decoded += ' ';
      continue;
    }
    if (cell === '⠠') {
      makeNextUppercase = true;
      continue;
    }
    const nextChar = BRAILLE_TO_CHAR[cell];
    if (!nextChar) return null;
    decoded += makeNextUppercase ? nextChar.toUpperCase() : nextChar;
    makeNextUppercase = false;
  }
  return decoded.trim().replace(/\s+/g, ' ') || null;
}

// Decode regional indicator symbols such as 🇸 🇭 🇴 🇼 into SHOW.
function decodeRegionalIndicatorSegment(segment: string): string | null {
  const codepoints = [...segment].filter((char) => /[\u{1F1E6}-\u{1F1FF}]/u.test(char));
  if (codepoints.length < 2) return null;
  const decoded = codepoints.map((char) => {
    const value = char.codePointAt(0);
    if (value === undefined) return '';
    return String.fromCharCode(65 + (value - 0x1F1E6));
  }).join('');
  return decoded || null;
}

// Flag symbol-heavy or non-ASCII-heavy prompts that look more like encoded
// symbol alphabets than natural text. This complements Shannon entropy, which
// can underrate two-symbol or compatibility-glyph payloads.
function hasSymbolSubstitutionObfuscation(input: string): boolean {
  const meaningfulChars = [...input].filter((char) => !/\s/.test(char));
  if (meaningfulChars.length < 6) return false;

  const interestingChars = meaningfulChars.filter((char) =>
    NON_ASCII_REGEX.test(char) || SYMBOL_LIKE_REGEX.test(char) || COMBINING_MARK_REGEX.test(char)
  );
  if (interestingChars.length < 6) return false;

  const nonAsciiCount = interestingChars.filter((char) => NON_ASCII_REGEX.test(char)).length;
  const symbolLikeCount = interestingChars.filter((char) => SYMBOL_LIKE_REGEX.test(char)).length;
  const combiningCount = interestingChars.filter((char) => COMBINING_MARK_REGEX.test(char)).length;
  const uniqueChars = new Set(interestingChars);

  const interestingRatio = interestingChars.length / meaningfulChars.length;
  const nonAsciiRatio = nonAsciiCount / interestingChars.length;
  const symbolLikeRatio = symbolLikeCount / interestingChars.length;
  const binarySymbolPattern = uniqueChars.size <= 3 && symbolLikeRatio >= 0.6 && interestingChars.length >= 6;

  return binarySymbolPattern ||
    combiningCount >= 2 ||
    (interestingRatio >= 0.25 && nonAsciiRatio >= 0.35 && symbolLikeRatio >= 0.2) ||
    (interestingRatio >= 0.25 && nonAsciiRatio >= 0.7 && uniqueChars.size >= 4);
}

// Main recursive decode walker.
// It explores a bounded queue of candidate segments so we can recover nested
// encodings without letting one prompt explode into unbounded work.
export function extractDecodedSegments(input: string): {
  decodedSegments: string[];
  usedObfuscation: boolean;
  maxDecodeDepth: number;
  signals: ObfuscationSignal[];
} {
  const decodedSegments: string[] = [];
  const seenSegments = new Set<string>();
  const queue: Array<{ value: string; depth: number }> = [{ value: input, depth: 0 }];
  let usedObfuscation = ZERO_WIDTH_CHAR_REGEX.test(input);
  let maxDecodeDepth = 0;
  const signals = new Set<ObfuscationSignal>();

  while (queue.length > 0 && decodedSegments.length < MAX_DECODE_SEGMENTS) {
    const current = queue.shift();
    if (!current || current.depth >= MAX_DECODE_DEPTH) continue;

    const base64Matches = Array.from(
      current.value.matchAll(BASE64_SEGMENT_REGEX),
      (match) => match[1],
    ).filter((match): match is string => Boolean(match));
    for (const match of base64Matches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeBase64Segment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const hexMatches = current.value.match(HEX_SEGMENT_REGEX) || [];
    for (const match of hexMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeHexSegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const urlMatches = current.value.match(URL_SEGMENT_REGEX) || [];
    for (const match of urlMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeUrlSegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('URL_ENCODING');
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const htmlEntityMatches = current.value.match(HTML_ENTITY_SEGMENT_REGEX) || [];
    for (const match of htmlEntityMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeHtmlEntitySegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('HTML_ENTITIES');
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const unicodeEscapeMatches = current.value.match(UNICODE_ESCAPE_SEGMENT_REGEX) || [];
    for (const match of unicodeEscapeMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeUnicodeEscapeSegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('UNICODE_ESCAPES');
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const natoMatches = current.value.match(NATO_SEGMENT_REGEX) || [];
    for (const match of natoMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeNatoSegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('NATO_PHONETIC');
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const morseMatches = current.value.match(MORSE_SEGMENT_REGEX) || [];
    for (const match of morseMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeMorseSegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('MORSE_CODE');
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const brailleMatches = current.value.match(BRAILLE_SEGMENT_REGEX) || [];
    for (const match of brailleMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeBrailleSegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('BRAILLE');
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const regionalMatches = current.value.match(REGIONAL_INDICATOR_SEGMENT_REGEX) || [];
    for (const match of regionalMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeRegionalIndicatorSegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('REGIONAL_INDICATORS');
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }
  }

  return {
    decodedSegments,
    usedObfuscation,
    maxDecodeDepth,
    signals: [...signals],
  };
}

// Recover transform-based obfuscations that are not classic encodings.
// These are useful because policy hits sometimes only appear after a reversible
// transform like ROT13, reverse text, or leetspeak normalization.
export function extractTransformedSegments(input: string): { segments: string[]; signals: ObfuscationSignal[] } {
  const segments: string[] = [];
  const signals: ObfuscationSignal[] = [];
  const baselineNormalized = normalizeWithoutLeet(input);
  const policyNormalized = normalizeForPolicy(input);

  if (hasCompatibilityGlyphObfuscation(input)) {
    segments.push(baselineNormalized);
    signals.push('COMPATIBILITY_GLYPHS');
  }

  if (hasLeetspeakObfuscation(input) && policyNormalized !== baselineNormalized) {
    segments.push(policyNormalized);
    signals.push('LEETSPEAK');
  }

  const rot13Value = input.replace(/[a-zA-Z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + (char.toLowerCase() < 'n' ? 13 : -13)));
  if (rot13Value !== input) {
    segments.push(rot13Value);
    signals.push('ROT13');
  }

  const reversedValue = [...input].reverse().join('');
  if (reversedValue !== input) {
    segments.push(reversedValue);
    signals.push('REVERSE_TEXT');
  }

  return { segments, signals };
}

// Detect evasive structure even when no clean decoded payload falls out.
// These signals are meant to say "this looks wrapped/concealed" rather than
// "we successfully decoded the hidden content."
export function detectStructuralObfuscation(input: string): ObfuscationSignal[] {
  const signals: ObfuscationSignal[] = [];
  if (END_SEQUENCE_REGEX.test(input)) signals.push('END_SEQUENCE');
  if (CHUNKING_REGEX.test(input)) signals.push('CHUNKING');
  if (VARIABLE_EXPANSION_REGEX.test(input)) signals.push('VARIABLE_EXPANSION');
  if (VERTICAL_TEXT_REGEX.test(input)) signals.push('VERTICAL_TEXT');
  if (hasSymbolSubstitutionObfuscation(input)) signals.push('SYMBOL_SUBSTITUTION');
  return signals;
}

export function getDecodeTelemetry(usedObfuscation: boolean, maxDecodeDepth: number): DecodeTelemetry {
  if (!usedObfuscation || maxDecodeDepth === 0) return 'plain_text';
  return maxDecodeDepth > 1 ? 'recursive_decode' : 'single_hop_decode';
}

// High-level obfuscation entry point used by the main sanitizer.
// It merges structural signals, transform recovery, recursive decoding, and
// normalized decoded text into one bounded analysis result.
export function analyzeObfuscationInput(input: string, enabled: boolean): {
  decodedSegments: string[];
  normalizedDecodedSegments: string[];
  structuralSignals: ObfuscationSignal[];
  leetspeakDetected: boolean;
  decodeTelemetry: DecodeTelemetry;
  signals: ObfuscationSignal[];
  usedObfuscation: boolean;
  maxDecodeDepth: number;
} {
  if (!enabled) {
    return {
      decodedSegments: [],
      normalizedDecodedSegments: [],
      structuralSignals: [],
      leetspeakDetected: false,
      decodeTelemetry: 'plain_text',
      signals: [],
      usedObfuscation: false,
      maxDecodeDepth: 0,
    };
  }

  const obfuscationAnalysis = extractDecodedSegments(input);
  return {
    decodedSegments: obfuscationAnalysis.decodedSegments,
    normalizedDecodedSegments: obfuscationAnalysis.decodedSegments.map((segment) => normalizeForPolicy(segment)),
    structuralSignals: detectStructuralObfuscation(input),
    leetspeakDetected: hasLeetspeakObfuscation(input) ||
      obfuscationAnalysis.decodedSegments.some((segment) => hasLeetspeakObfuscation(segment)),
    decodeTelemetry: getDecodeTelemetry(obfuscationAnalysis.usedObfuscation, obfuscationAnalysis.maxDecodeDepth),
    signals: obfuscationAnalysis.signals,
    usedObfuscation: obfuscationAnalysis.usedObfuscation,
    maxDecodeDepth: obfuscationAnalysis.maxDecodeDepth,
  };
}

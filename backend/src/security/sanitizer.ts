export type FirewallVerdict = 'CLEAN' | 'SUSPICIOUS' | 'ADVERSARIAL';

export interface BackendSanitizationResult {
  original: string;
  sanitized: string;
  detectionFlags: string[];
  redactions: string[];
  entropy: number;
  globalEntropy: number;
  syntacticScore: number;
  suspiciousChunks: string[];
  verdict: FirewallVerdict;
  analystReasoning: string;
  latencyMs: number;
  decodeTelemetry: 'plain_text' | 'single_hop_decode' | 'recursive_decode';
}

interface SensitivePattern {
  name: string;
  regex: RegExp;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  { name: 'EMAIL', regex: /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g },
  { name: 'PHONE', regex: /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  { name: 'AWS_KEY', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'PRIVATE_KEY', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'IP_ADDRESS', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: 'CREDIT_CARD', regex: /\b(?:\d[ -]*?){13,16}\b/g },
  { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'API_KEY', regex: /\b[0-9a-fA-F]{32,64}\b/g },
  { name: 'JWT', regex: /\beyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g },
  { name: 'CANARY_TOKEN', regex: /COUNTERSPY_CANARY_TOKEN_[0-9a-fA-F-]{36}/g },
  { name: 'SECRET_KEY', regex: /(?:secret[-_]?key|password|passwd|api[-_]?key|token)(?:\s+is\s+|\s*[:=]\s*|\s+)([^\s]+)/gi },
];

const BLOCKED_KEYWORDS = [
  'ignore all previous instructions',
  'system prompt',
  'ignore instructions',
  'disregard previous',
  'developer mode',
  'prompt injection',
  'jailbreak',
  'do anything now',
];

const OPERATIONAL_KEYWORDS = [
  'ignore', 'override', 'disregard', 'instead', 'regardless',
  'assume', 'hypothetical', 'must', 'always', 'never', 'system',
  'instructions', 'prior', 'forget', 'output format', 'jailbreak',
  'act as', 'simulate', 'pretend', 'from now on', 'developer mode',
  'unfiltered', 'uncensored', 'bypass', 'rules', 'guidelines',
  'policy', 'restriction', 'limitations', 'prompt', 'roleplay',
  'dan', 'sudo', 'admin', 'root', 'system prompt', 'you must',
  'respond as', 'answer as', 'behave as',
];

const ZERO_WIDTH_CHAR_REGEX = /[\u200B-\u200D\u2060\uFEFF]/g;
const BASE64_SEGMENT_REGEX = /(?:^|[^A-Za-z0-9+/=])([A-Za-z0-9+/]{20,}={0,2})(?=$|[^A-Za-z0-9+/=])/g;
const HEX_SEGMENT_REGEX = /\b(?:0x)?(?:[A-Fa-f0-9]{2}){12,}\b/g;
const URL_SEGMENT_REGEX = /(?:%[0-9A-Fa-f]{2}){6,}/g;
const HTML_ENTITY_SEGMENT_REGEX = /(?:&#(?:x[0-9A-Fa-f]+|\d+);){4,}/g;
const NATO_SEGMENT_REGEX = /\b(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-ray|xray|yankee|zulu)(?:\s+(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-ray|xray|yankee|zulu)){3,}\b/gi;
const MORSE_SEGMENT_REGEX = /(?:[.\-]+(?:\s+[.\-/]+){3,})/g;
const MAX_DECODE_DEPTH = 3;
const MAX_DECODE_SEGMENTS = 24;
type DecodeTelemetry = 'plain_text' | 'single_hop_decode' | 'recursive_decode';
type ObfuscationSignal =
  | 'URL_ENCODING'
  | 'HTML_ENTITIES'
  | 'LEETSPEAK'
  | 'ROT13'
  | 'REVERSE_TEXT'
  | 'NATO_PHONETIC'
  | 'MORSE_CODE'
  | 'RECURSIVE_DECODE'
  | 'END_SEQUENCE'
  | 'CHUNKING'
  | 'VARIABLE_EXPANSION'
  | 'VERTICAL_TEXT';
type LanguageSignal = 'FOREIGN_LANGUAGE' | 'MIXED_LANGUAGE' | 'SPELLING_OBFUSCATION';
const END_SEQUENCE_REGEX = /<\/s>|<\|im_end\|>/i;
const CHUNKING_REGEX = /(?:^|\n)Part\s+\d+:\s+/i;
const VARIABLE_EXPANSION_REGEX = /\blet\s+v\d+\s*=|console\.log\(/i;
const VERTICAL_TEXT_REGEX = /^(?:.{1,2}\n){5,}.{1,2}$/m;
const CYRILLIC_REGEX = /[\u0400-\u04FF]/;
const ARABIC_REGEX = /[\u0600-\u06FF]/;
const CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

const COMMON_CORRECTIONS: Record<string, string> = {
  cystem: 'system',
  devloper: 'developer',
  ignroe: 'ignore',
  ignoor: 'ignore',
  ignorre: 'ignore',
  instuctions: 'instructions',
  instructons: 'instructions',
  instrucitons: 'instructions',
  previuos: 'previous',
  previos: 'previous',
  prawmpt: 'prompt',
  promt: 'prompt',
  reavl: 'reveal',
  reveaal: 'reveal',
  reveel: 'reveal',
  systm: 'system',
  sysytem: 'system',
  yoru: 'your',
};

const FOREIGN_LANGUAGE_STOPWORDS: Record<string, string[]> = {
  es: ['ignora', 'instrucciones', 'anteriores', 'revela', 'sistema', 'mensaje', 'secreto'],
  fr: ['ignore', 'instructions', 'precedentes', 'revele', 'systeme', 'message', 'secret'],
  de: ['ignorieren', 'anweisungen', 'vorherigen', 'system', 'aufforderung', 'geheim'],
  pt: ['ignore', 'instrucoes', 'instruções', 'anteriores', 'revele', 'sistema', 'segredo'],
  it: ['ignora', 'istruzioni', 'precedenti', 'rivela', 'sistema', 'segreto'],
  ru: ['игнорируй', 'инструкции', 'предыдущие', 'система', 'секрет'],
};

const FOREIGN_POLICY_TRANSLATIONS: Array<{ regex: RegExp; replacement: string }> = [
  { regex: /ignora(?:r)?\s+las?\s+instrucciones?\s+anteriores?/gi, replacement: 'ignore previous instructions' },
  { regex: /ignora(?:r)?\s+instrucciones?/gi, replacement: 'ignore instructions' },
  { regex: /mensaje\s+del?\s+sistema/gi, replacement: 'system prompt' },
  { regex: /modo\s+desarrollador/gi, replacement: 'developer mode' },
  { regex: /ignore(?:z|r)?\s+les?\s+instructions?\s+pr[eé]c[eé]dentes?/gi, replacement: 'ignore previous instructions' },
  { regex: /message\s+du\s+syst[eè]me/gi, replacement: 'system prompt' },
  { regex: /ignorier(?:e|en)\s+die\s+vorherigen\s+anweisungen/gi, replacement: 'ignore previous instructions' },
  { regex: /system(?:aufforderung|hinweis)/gi, replacement: 'system prompt' },
  { regex: /ignore\s+as\s+instru[cç][oõ]es?\s+anteriores?/gi, replacement: 'ignore previous instructions' },
  { regex: /prompt\s+do\s+sistema/gi, replacement: 'system prompt' },
  { regex: /ignora\s+le\s+istruzioni\s+precedenti/gi, replacement: 'ignore previous instructions' },
  { regex: /prompt\s+di\s+sistema/gi, replacement: 'system prompt' },
  { regex: /игнорируй\s+предыдущие\s+инструкции/gi, replacement: 'ignore previous instructions' },
  { regex: /системн(?:ый|ого)\s+промпт/gi, replacement: 'system prompt' },
];

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

function calculateEntropy(value: string): number {
  if (value.length === 0) return 0;

  const frequencies: Record<string, number> = {};
  for (const char of value) {
    frequencies[char] = (frequencies[char] || 0) + 1;
  }

  return Object.values(frequencies).reduce((sum, frequency) => {
    const probability = frequency / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function analyzeSlidingWindowEntropy(prompt: string) {
  const windowSize = 35;
  const stepSize = 5;
  const threshold = 4.5;
  const globalEntropy = calculateEntropy(prompt);
  let maxEntropy = 0;
  const suspiciousChunks: string[] = [];

  if (prompt.length <= windowSize) {
    maxEntropy = globalEntropy;
    if (globalEntropy >= threshold) suspiciousChunks.push(prompt);
  } else {
    for (let index = 0; index <= prompt.length - windowSize; index += stepSize) {
      const chunk = prompt.substring(index, index + windowSize);
      const entropy = calculateEntropy(chunk);
      maxEntropy = Math.max(maxEntropy, entropy);
      if (entropy >= threshold) suspiciousChunks.push(chunk);
    }
  }

  return {
    globalEntropy,
    maxEntropy,
    suspiciousChunks: [...new Set(suspiciousChunks)],
  };
}

function analyzeSyntacticComplexity(prompt: string): number {
  if (!prompt.trim()) return 0;

  const lowerPrompt = prompt.toLowerCase();
  let constraintCount = 0;

  for (const keyword of OPERATIONAL_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    constraintCount += lowerPrompt.match(regex)?.length || 0;
  }

  const totalWords = prompt.trim().split(/\s+/).length;
  const constraintDensity = totalWords > 0 ? (constraintCount / totalWords) * 100 : 0;
  const specialCharCount = prompt.match(/[^a-zA-Z0-9\s.,!?\-:']/g)?.length || 0;
  const specialCharRatio = (specialCharCount / prompt.length) * 100;
  const sentences = prompt.split(/[.!?]+/).filter((sentence) => sentence.trim().length > 0);
  const avgWordsPerSentence = sentences.length > 0 ? totalWords / sentences.length : totalWords;

  let score = 0;
  score += Math.min(constraintCount * 10, 60);
  score += Math.min(constraintDensity * 15, 40);
  score += Math.min(specialCharRatio * 10, 30);
  if (avgWordsPerSentence > 20) score += 5;
  if (avgWordsPerSentence > 40) score += 10;
  if (avgWordsPerSentence > 60) score += 10;

  return Math.min(parseFloat(score.toFixed(1)), 100);
}

function normalizeWithoutLeet(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(ZERO_WIDTH_CHAR_REGEX, '')
    .normalize('NFKC');
}

function normalizeForPolicy(prompt: string): string {
  return normalizeWithoutLeet(prompt)
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/@/g, 'a');
}

function hasLeetspeakObfuscation(prompt: string): boolean {
  const replacementCount = (prompt.match(/[0134578@]/g) || []).length;
  if (replacementCount < 2 || !/[a-zA-Z]/.test(prompt)) return false;
  return normalizeForPolicy(prompt) !== normalizeWithoutLeet(prompt);
}

function collapseRepeatedLetters(word: string): string {
  return word.replace(/([a-z])\1{2,}/gi, '$1');
}

function normalizeSpellingHeuristic(prompt: string): { text: string; changed: boolean } {
  const corrected = prompt.replace(/\b[\p{L}\p{N}'-]+\b/gu, (token: string) => {
    if (token.length > 30 || /[^\x00-\x7F]/.test(token)) return token;
    const normalized = token.toLowerCase();
    const direct = COMMON_CORRECTIONS[normalized];
    const collapsed = COMMON_CORRECTIONS[collapseRepeatedLetters(normalized)];
    const replacement = direct ?? collapsed;
    if (!replacement || replacement === normalized) return token;
    if (token === token.toUpperCase()) return replacement.toUpperCase();
    if (token[0] && token[0] === token[0].toUpperCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });

  return { text: corrected, changed: corrected !== prompt };
}

function applyForeignPolicyTranslations(input: string): string {
  return FOREIGN_POLICY_TRANSLATIONS.reduce(
    (value, mapping) => value.replace(mapping.regex, mapping.replacement),
    input,
  );
}

function detectLanguageSignals(input: string): {
  isForeignLanguage: boolean;
  isMixedLanguage: boolean;
  translatedCandidate: string | null;
} {
  const normalized = normalizeWithoutLeet(input);
  const hasCyrillic = CYRILLIC_REGEX.test(input);
  const hasArabic = ARABIC_REGEX.test(input);
  const hasCjk = CJK_REGEX.test(input);
  const hasNonLatinScript = hasCyrillic || hasArabic || hasCjk;
  const hasLatinLetters = /[a-z]/i.test(input);
  const scriptFamilies = [hasLatinLetters, hasCyrillic, hasArabic, hasCjk].filter(Boolean).length;
  const foreignStopwordHits = Object.values(FOREIGN_LANGUAGE_STOPWORDS).reduce(
    (count, words) => count + words.filter((word) => normalized.includes(word)).length,
    0,
  );
  const translatedCandidate = applyForeignPolicyTranslations(normalized);
  const translatedChanged = translatedCandidate !== normalized;

  return {
    isForeignLanguage: hasNonLatinScript || foreignStopwordHits >= 2 || translatedChanged,
    isMixedLanguage: scriptFamilies > 1 || (translatedChanged && hasLatinLetters && (hasNonLatinScript || foreignStopwordHits >= 2)),
    translatedCandidate: translatedChanged ? translatedCandidate : null,
  };
}

function decodeBase64Segment(segment: string): string | null {
  if (segment.length % 4 !== 0 || segment.length < 24) return null;

  try {
    const decoded = Buffer.from(segment, 'base64').toString('utf8');
    const printableRatio = decoded.split('').filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    }).length / decoded.length;

    return printableRatio >= 0.85 ? decoded : null;
  } catch {
    return null;
  }
}

function decodeHexSegment(segment: string): string | null {
  const normalizedSegment = segment.startsWith('0x') ? segment.slice(2) : segment;
  if (normalizedSegment.length % 2 !== 0 || normalizedSegment.length < 24) return null;

  try {
    const decoded = Buffer.from(normalizedSegment, 'hex').toString('utf8');
    const printableRatio = decoded.split('').filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    }).length / decoded.length;

    return printableRatio >= 0.85 ? decoded : null;
  } catch {
    return null;
  }
}

function decodeUrlSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded !== segment ? decoded : null;
  } catch {
    return null;
  }
}

function decodeHtmlEntitySegment(segment: string): string | null {
  try {
    const decoded = segment.replace(/&#(?:x([0-9A-Fa-f]+)|(\d+));/g, (_, hex, decimal) =>
      String.fromCharCode(parseInt(hex || decimal, hex ? 16 : 10)));
    return decoded !== segment ? decoded : null;
  } catch {
    return null;
  }
}

function decodeNatoSegment(segment: string): string | null {
  const words = segment.toLowerCase().trim().split(/\s+/);
  if (words.length < 4) return null;
  const decoded = words.map((word) => NATO_WORD_TO_CHAR[word]).join('');
  return decoded && !decoded.includes('undefined') ? decoded : null;
}

function decodeMorseSegment(segment: string): string | null {
  const tokens = segment.trim().split(/\s+/);
  if (tokens.length < 4) return null;
  const decoded = tokens.map((token) => MORSE_TO_CHAR[token]).join('');
  return decoded && !decoded.includes('undefined') ? decoded : null;
}

function extractDecodedSegments(prompt: string): {
  decodedSegments: string[];
  usedObfuscation: boolean;
  maxDecodeDepth: number;
  signals: ObfuscationSignal[];
} {
  const decodedSegments: string[] = [];
  const seenSegments = new Set<string>();
  const queue: Array<{ value: string; depth: number }> = [{ value: prompt, depth: 0 }];
  let usedObfuscation = ZERO_WIDTH_CHAR_REGEX.test(prompt);
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

  }

  return { decodedSegments, usedObfuscation, maxDecodeDepth, signals: [...signals] };
}

function extractTransformedSegments(prompt: string): { segments: string[]; signals: ObfuscationSignal[] } {
  const segments: string[] = [];
  const signals: ObfuscationSignal[] = [];
  const baselineNormalized = normalizeWithoutLeet(prompt);
  const policyNormalized = normalizeForPolicy(prompt);

  if (/[0134578@]/.test(prompt) && policyNormalized !== baselineNormalized) {
    segments.push(policyNormalized);
    signals.push('LEETSPEAK');
  }

  const rot13Value = prompt.replace(/[a-zA-Z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + (char.toLowerCase() < 'n' ? 13 : -13)));
  if (rot13Value !== prompt) {
    segments.push(rot13Value);
    signals.push('ROT13');
  }

  const reversedValue = [...prompt].reverse().join('');
  if (reversedValue !== prompt) {
    segments.push(reversedValue);
    signals.push('REVERSE_TEXT');
  }

  return { segments, signals };
}

function detectStructuralObfuscation(prompt: string): ObfuscationSignal[] {
  const signals: ObfuscationSignal[] = [];
  if (END_SEQUENCE_REGEX.test(prompt)) signals.push('END_SEQUENCE');
  if (CHUNKING_REGEX.test(prompt)) signals.push('CHUNKING');
  if (VARIABLE_EXPANSION_REGEX.test(prompt)) signals.push('VARIABLE_EXPANSION');
  if (VERTICAL_TEXT_REGEX.test(prompt)) signals.push('VERTICAL_TEXT');
  return signals;
}

function getDecodeTelemetry(usedObfuscation: boolean, maxDecodeDepth: number): DecodeTelemetry {
  if (!usedObfuscation || maxDecodeDepth === 0) return 'plain_text';
  return maxDecodeDepth > 1 ? 'recursive_decode' : 'single_hop_decode';
}

export function sanitizePrompt(prompt: string): BackendSanitizationResult {
  const start = performance.now();
  let sanitized = prompt;
  const redactions = new Set<string>();
  const detectionFlags = new Set<string>();

  for (const pattern of SENSITIVE_PATTERNS) {
    if (prompt.match(pattern.regex)) {
      redactions.add(pattern.name);
      detectionFlags.add(pattern.name);
      sanitized = sanitized.replace(pattern.regex, `[REDACTED_${pattern.name}]`);
    }
  }

  const entropyAnalysis = analyzeSlidingWindowEntropy(prompt);
  const syntacticScore = analyzeSyntacticComplexity(prompt);
  const normalized = normalizeForPolicy(prompt);
  const spellingNormalization = normalizeSpellingHeuristic(prompt);
  const normalizedSpellCorrected = normalizeForPolicy(spellingNormalization.text);
  const { decodedSegments, usedObfuscation, maxDecodeDepth, signals: decodedSignals } = extractDecodedSegments(prompt);
  const structuralSignals = detectStructuralObfuscation(prompt);
  const leetspeakDetected =
    hasLeetspeakObfuscation(prompt) || decodedSegments.some((segment) => hasLeetspeakObfuscation(segment));
  const languageSignals = detectLanguageSignals(prompt);
  const normalizedForeignRecovery = languageSignals.translatedCandidate ? normalizeForPolicy(languageSignals.translatedCandidate) : '';
  const normalizedDecodedSegments = decodedSegments.map((segment) => normalizeForPolicy(segment));
  let transformedSignalsUsed: ObfuscationSignal[] = [];
  let normalizedTransformedSegments: string[] = [];
  let decodeTelemetry = getDecodeTelemetry(usedObfuscation, maxDecodeDepth);
  const blockedKeywordHits = BLOCKED_KEYWORDS.filter((keyword) =>
    normalized.includes(keyword) ||
    normalizedDecodedSegments.some((segment) => segment.includes(keyword)) ||
    normalizedSpellCorrected.includes(keyword) ||
    (normalizedForeignRecovery ? normalizedForeignRecovery.includes(keyword) : false)
  );
  const spellingObfuscationDetected = spellingNormalization.changed && blockedKeywordHits.some((keyword) =>
    !normalized.includes(keyword) && normalizedSpellCorrected.includes(keyword)
  );
  if (blockedKeywordHits.length === 0) {
    const rawTransformedAnalysis = extractTransformedSegments(prompt);
    const decodedTransformedAnalysis = {
      segments: decodedSegments.flatMap((segment) => extractTransformedSegments(segment).segments),
      signals: decodedSegments.flatMap((segment) => extractTransformedSegments(segment).signals),
    };
    transformedSignalsUsed = [...rawTransformedAnalysis.signals, ...decodedTransformedAnalysis.signals];
    normalizedTransformedSegments = [
      ...rawTransformedAnalysis.segments,
      ...decodedTransformedAnalysis.segments,
    ].map((segment) => normalizeForPolicy(segment));
    const transformedHits = BLOCKED_KEYWORDS.filter((keyword) =>
      normalizedTransformedSegments.some((segment) => segment.includes(keyword))
    );
    if (transformedHits.length > 0 && usedObfuscation && decodedTransformedAnalysis.segments.length > 0) {
      decodeTelemetry = 'recursive_decode';
    }
    blockedKeywordHits.push(...transformedHits);
  }

  for (const keyword of blockedKeywordHits) {
    detectionFlags.add(`BLOCKED_KEYWORD:${keyword}`);
  }
  if (blockedKeywordHits.length > 0) detectionFlags.add('BLOCKED_KEYWORD');
  if (blockedKeywordHits.length > 0 && usedObfuscation) detectionFlags.add('OBFUSCATED_INSTRUCTION');
  if (blockedKeywordHits.length > 0) {
    for (const signal of [...decodedSignals, ...transformedSignalsUsed]) {
      detectionFlags.add(signal);
      redactions.add(signal);
    }
    if (decodeTelemetry === 'recursive_decode') {
      detectionFlags.add('RECURSIVE_DECODE');
      redactions.add('RECURSIVE_DECODE');
    }
  }
  for (const signal of structuralSignals) {
    detectionFlags.add(signal);
    redactions.add(signal);
  }
  if (leetspeakDetected) {
    detectionFlags.add('LEETSPEAK');
    redactions.add('LEETSPEAK');
  }
  if (languageSignals.isForeignLanguage) {
    detectionFlags.add('FOREIGN_LANGUAGE');
    redactions.add('FOREIGN_LANGUAGE');
  }
  if (languageSignals.isMixedLanguage) {
    detectionFlags.add('MIXED_LANGUAGE');
    redactions.add('MIXED_LANGUAGE');
  }
  if (spellingObfuscationDetected) {
    detectionFlags.add('SPELLING_OBFUSCATION');
    redactions.add('SPELLING_OBFUSCATION');
  }

  if (entropyAnalysis.maxEntropy > 4.5) detectionFlags.add('TOKEN_DILUTION');
  if (syntacticScore >= 65) detectionFlags.add('SYNTACTIC_PROBE');
  if (prompt.length > 2000) detectionFlags.add('EXCESSIVE_LENGTH');

  let verdict: FirewallVerdict = 'CLEAN';
  const reasons: string[] = [];

  if (entropyAnalysis.maxEntropy > 5.5) reasons.push('adversarial entropy threshold exceeded');
  if (syntacticScore >= 90) reasons.push('adversarial syntactic complexity threshold exceeded');
  if (redactions.has('CANARY_TOKEN')) reasons.push('canary token disclosure attempt detected');
  if (redactions.has('PRIVATE_KEY') || redactions.has('AWS_KEY')) reasons.push('high-risk secret material detected');

  if (reasons.length > 0) {
    verdict = 'ADVERSARIAL';
  } else if (
    entropyAnalysis.maxEntropy > 4.5 ||
    syntacticScore >= 65 ||
    blockedKeywordHits.length > 0 ||
    prompt.length > 2000
  ) {
    verdict = 'SUSPICIOUS';
    reasons.push('prompt matched suspicious firewall criteria');
  } else if (languageSignals.isForeignLanguage || spellingObfuscationDetected) {
    reasons.push('prompt triggered lightweight language or spelling recovery analysis');
  } else if (redactions.size > 0) {
    reasons.push('sensitive data was redacted before routing');
  } else {
    reasons.push('no active firewall criteria matched');
  }

  const latencyMs = performance.now() - start;
  if (latencyMs > 100) {
    detectionFlags.add('REDOS_ATTEMPT');
    verdict = 'ADVERSARIAL';
    reasons.push('sanitization latency exceeded fail-secure threshold');
  }

  return {
    original: prompt,
    sanitized,
    detectionFlags: [...detectionFlags],
    redactions: [...redactions],
    entropy: entropyAnalysis.maxEntropy,
    globalEntropy: entropyAnalysis.globalEntropy,
    syntacticScore,
    suspiciousChunks: entropyAnalysis.suspiciousChunks,
    verdict,
    analystReasoning: reasons.join('; '),
    latencyMs,
    decodeTelemetry,
  };
}

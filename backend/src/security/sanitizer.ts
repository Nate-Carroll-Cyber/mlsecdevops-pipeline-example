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

export interface BackendSanitizationTuning {
  entropyThreshold?: number;
  syntacticThreshold?: number;
  blockedKeywords?: string[];
  forbiddenTopics?: string[];
  regexRules?: string[];
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
  { name: 'SECRET_KEY', regex: /(?:secret[-_]?key|password|passwd|api[-_]?key|token)(?:\s+is\s+|\s*[:=]\s*)([^\s]+)/gi },
];
const REDACTED_PLACEHOLDER_REGEX = /\[REDACTED_([A-Z_]+)\]/g;
const EXTERNAL_CALL_REGEX = /(?:!\[[^\]]*\]\((https?:\/\/[^\s)]+)\))|(?:\b(?:browse|open|visit|fetch|call|request|load|download)\b[\s\S]{0,80}https?:\/\/[^\s)]+)/i;
const COORDINATE_CIPHER_REGEX = /(?:\(\d{1,2},\d{1,2}\)\s*){3,}/;
const SANITIZATION_REDOS_LATENCY_THRESHOLD_MS = 1000;

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
const UNICODE_ESCAPE_SEGMENT_REGEX = /(?:(?:\\u[0-9A-Fa-f]{4})|(?:\\x[0-9A-Fa-f]{2})){2,}/g;
const NATO_SEGMENT_REGEX = /\b(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-ray|xray|yankee|zulu)(?:\s+(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-ray|xray|yankee|zulu)){3,}\b/gi;
const MORSE_SEGMENT_REGEX = /(?:[.\-]+(?:\s+[.\-/]+){3,})/g;
const BRAILLE_SEGMENT_REGEX = /(?:[\u2800-\u28FF]+\s*){2,}/gu;
const REGIONAL_INDICATOR_SEGMENT_REGEX = /(?:[\u{1F1E6}-\u{1F1FF}]\s*){2,}/gu;
const MAX_DECODE_DEPTH = 3;
const MAX_DECODE_SEGMENTS = 24;
const SUSPICIOUS_ENTROPY_THRESHOLD = 4.0;
const ADVERSARIAL_ENTROPY_THRESHOLD = 4.8;
type DecodeTelemetry = 'plain_text' | 'single_hop_decode' | 'recursive_decode';
type ObfuscationSignal =
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
type LanguageSignal = 'FOREIGN_LANGUAGE' | 'MIXED_LANGUAGE' | 'SPELLING_OBFUSCATION';
const END_SEQUENCE_REGEX = /<\/s>|<\|im_end\|>/i;
const CHUNKING_REGEX = /(?:^|\n)Part\s+\d+:\s+/i;
const VARIABLE_EXPANSION_REGEX = /\blet\s+v\d+\s*=|console\.log\(/i;
const VERTICAL_TEXT_REGEX = /^(?:.{1,2}\n){5,}.{1,2}$/m;
const NON_ASCII_REGEX = /[^\x00-\x7F]/;
const COMBINING_MARK_REGEX = /\p{M}/u;
const SYMBOL_LIKE_REGEX = /[\p{S}\p{M}]/u;
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
const COMPATIBILITY_GLYPH_REGEX = /[\u2460-\u24FF\u3200-\u32FF\uFF00-\uFFEF]/g;
const CYRILLIC_CONFUSABLES: Record<string, string> = {
  а: 'a', А: 'a', е: 'e', Е: 'e', о: 'o', О: 'o', р: 'p', Р: 'p',
  с: 'c', С: 'c', у: 'y', У: 'y', х: 'x', Х: 'x', і: 'i', І: 'i',
  к: 'k', К: 'k', м: 'm', М: 'm', т: 't', Т: 't', в: 'b', В: 'b',
  н: 'h', Н: 'h',
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

const BRAILLE_TO_CHAR: Record<string, string> = {
  '⠁': 'a', '⠃': 'b', '⠉': 'c', '⠙': 'd', '⠑': 'e', '⠋': 'f',
  '⠛': 'g', '⠓': 'h', '⠊': 'i', '⠚': 'j', '⠅': 'k', '⠇': 'l',
  '⠍': 'm', '⠝': 'n', '⠕': 'o', '⠏': 'p', '⠟': 'q', '⠗': 'r',
  '⠎': 's', '⠞': 't', '⠥': 'u', '⠧': 'v', '⠺': 'w', '⠭': 'x',
  '⠽': 'y', '⠵': 'z',
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

function calculateEntropyRiskBoost(value: string): number {
  const meaningfulChars = [...value].filter((char) => !/\s/.test(char));
  if (meaningfulChars.length < 6) return 0;

  const nonAsciiCount = meaningfulChars.filter((char) => /[^\x00-\x7F]/.test(char)).length;
  const symbolLikeCount = meaningfulChars.filter((char) => /[\p{S}\p{M}]/u.test(char)).length;
  const combiningCount = meaningfulChars.filter((char) => /\p{M}/u.test(char)).length;
  const uniqueChars = new Set(meaningfulChars);

  const nonAsciiRatio = nonAsciiCount / meaningfulChars.length;
  const symbolLikeRatio = symbolLikeCount / meaningfulChars.length;

  let boost = 0;
  if (nonAsciiRatio >= 0.35) boost += 0.35;
  if (symbolLikeRatio >= 0.2) boost += 0.6;
  if (symbolLikeRatio >= 0.4) boost += 0.35;
  if (combiningCount >= 2) boost += 0.65;
  if (uniqueChars.size <= 3 && symbolLikeRatio >= 0.6 && meaningfulChars.length >= 10) boost += 1.1;

  return Math.min(boost, 1.75);
}

function calculateEntropyLanguagePenalty(value: string): number {
  const chars = [...value];
  if (chars.length < 20) return 0;

  const letters = chars.filter((char) => /[a-z]/i.test(char));
  if (letters.length === 0) return 0;

  const meaningfulChars = chars.filter((char) => !/\s/.test(char));
  const letterRatio = letters.length / meaningfulChars.length;
  const whitespaceRatio = chars.filter((char) => /\s/.test(char)).length / chars.length;
  const nonAsciiRatio = meaningfulChars.filter((char) => /[^\x00-\x7F]/.test(char)).length / meaningfulChars.length;
  const symbolLikeRatio = meaningfulChars.filter((char) => /[\p{S}\p{M}]/u.test(char)).length / meaningfulChars.length;
  const digitRatio = meaningfulChars.filter((char) => /\d/.test(char)).length / meaningfulChars.length;
  const vowelRatio = letters.filter((char) => /[aeiou]/i.test(char)).length / letters.length;

  const looksLikePlainProse =
    letterRatio >= 0.55 &&
    whitespaceRatio >= 0.1 &&
    nonAsciiRatio < 0.05 &&
    symbolLikeRatio < 0.08 &&
    digitRatio < 0.2 &&
    vowelRatio >= 0.2 &&
    vowelRatio <= 0.65;

  return looksLikePlainProse ? 1.65 : 0;
}

function normalizeForEntropy(value: string): string {
  const unescaped = value
    .replace(/\\([_<>\[\]])/g, '$1')
    .replace(/\\_/g, '_')
    .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, ' pii email ')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ' pii ip ');

  return unescaped
    .replace(
      /^\s*(?:[\[(<]{1,3}|--)?\s*\/?\s*[A-Z][A-Z0-9]*(?:[ _:-]+[A-Z0-9]+){0,10}\s*(?:[\])>]{1,3})?\s*$/gm,
      ' template header ',
    )
    .replace(/\[\[[A-Z0-9_:-]{3,}\]\]/g, ' template header ')
    .replace(/<[/]?[A-Z0-9_:-]{3,}>/g, ' template header ')
    .replace(/\(([A-Z0-9_:-]{3,})\)/g, ' template header ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasEntropyEscalationContext(value: string): boolean {
  const meaningfulChars = [...value].filter((char) => !/\s/.test(char));
  if (meaningfulChars.length < 6) return false;

  const nonAsciiCount = meaningfulChars.filter((char) => /[^\x00-\x7F]/.test(char)).length;
  const symbolLikeCount = meaningfulChars.filter((char) => /[\p{S}\p{M}]/u.test(char)).length;
  const combiningCount = meaningfulChars.filter((char) => /\p{M}/u.test(char)).length;
  const nonLetterCount = meaningfulChars.filter((char) => /[^a-z]/i.test(char)).length;
  const uniqueChars = new Set(meaningfulChars);

  const nonAsciiRatio = nonAsciiCount / meaningfulChars.length;
  const symbolLikeRatio = symbolLikeCount / meaningfulChars.length;
  const nonLetterRatio = nonLetterCount / meaningfulChars.length;

  return combiningCount >= 1 ||
    nonAsciiRatio >= 0.18 ||
    symbolLikeRatio >= 0.14 ||
    nonLetterRatio >= 0.38 ||
    (uniqueChars.size <= 3 && nonLetterRatio >= 0.7 && meaningfulChars.length >= 8);
}

function analyzeSlidingWindowEntropy(prompt: string, windowSize = 35, stepSize = 5, threshold = SUSPICIOUS_ENTROPY_THRESHOLD) {
  const entropyInput = normalizeForEntropy(prompt);
  const globalEntropy = Math.max(
    0,
    calculateEntropy(entropyInput) + calculateEntropyRiskBoost(entropyInput) - calculateEntropyLanguagePenalty(entropyInput),
  );
  let maxEntropy = 0;
  const suspiciousChunks: string[] = [];

  if (entropyInput.length <= windowSize) {
    maxEntropy = globalEntropy;
    if (globalEntropy >= threshold) suspiciousChunks.push(entropyInput);
  } else {
    for (let index = 0; index <= entropyInput.length - windowSize; index += stepSize) {
      const chunk = entropyInput.substring(index, index + windowSize);
      const entropy = Math.max(
        0,
        calculateEntropy(chunk) + calculateEntropyRiskBoost(chunk) - calculateEntropyLanguagePenalty(chunk),
      );
      maxEntropy = Math.max(maxEntropy, entropy);
      if (entropy >= threshold) suspiciousChunks.push(chunk);
    }
  }

  if (!hasEntropyEscalationContext(entropyInput)) {
    maxEntropy = Math.min(maxEntropy, globalEntropy + 0.6);
  }

  return {
    globalEntropy,
    maxEntropy,
    suspiciousChunks: [...new Set(suspiciousChunks)],
  };
}

function analyzeSyntacticComplexity(prompt: string): number {
  if (!prompt.trim()) return 0;

  const wrapperShellCount =
    (prompt.match(/^\s*(?:[\[(<]{1,3}|--)?\s*\/?\s*[A-Z][A-Z0-9]*(?:[ _:-]+[A-Z0-9]+){0,10}\s*(?:[\])>]{1,3})?\s*$/gm)?.length ?? 0) +
    (prompt.match(/\[\[[A-Z0-9_:-]{3,}\]\]/g)?.length ?? 0) +
    (prompt.match(/<[/]?[A-Z0-9_:-]{3,}>/g)?.length ?? 0) +
    (prompt.match(/\(([A-Z0-9_:-]{3,})\)/g)?.length ?? 0);
  const normalizedPrompt = prompt
    .replace(/\\([_<>\[\]])/g, '$1')
    .replace(/\\_/g, '_')
    .replace(
      /^\s*(?:[\[(<]{1,3}|--)?\s*\/?\s*[A-Z][A-Z0-9]*(?:[ _:-]+[A-Z0-9]+){0,10}\s*(?:[\])>]{1,3})?\s*$/gm,
      ' ',
    )
    .replace(/\[\[[A-Z0-9_:-]{3,}\]\]/g, ' ')
    .replace(/<[/]?[A-Z0-9_:-]{3,}>/g, ' ')
    .replace(/\(([A-Z0-9_:-]{3,})\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const lowerPrompt = normalizedPrompt.toLowerCase();
  const highSignalKeywords = [
    'ignore', 'override', 'disregard', 'forget', 'jailbreak',
    'act as', 'simulate', 'pretend', 'from now on', 'developer mode',
    'unfiltered', 'uncensored', 'bypass', 'roleplay', 'persona',
    'start over', 'new instructions', 'do anything now', 'dan',
    'sudo', 'admin', 'root', 'system prompt', 'core instructions',
    'base instructions', 'respond as', 'answer as', 'reply as', 'behave as',
    'chatgpt', 'openai', 'gemini'
  ];
  const mediumSignalKeywords = [
    'must', 'always', 'never', 'instructions', 'output format',
    'rules', 'guidelines', 'restriction', 'limitations', 'you are',
    'you will', 'you must', 'you cannot', 'you shall'
  ];
  let constraintCount = 0;
  let weightedConstraintScore = 0;

  for (const keyword of highSignalKeywords) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const matches = lowerPrompt.match(regex)?.length || 0;
    constraintCount += matches;
    weightedConstraintScore += matches * 1.4;
  }
  for (const keyword of mediumSignalKeywords) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const matches = lowerPrompt.match(regex)?.length || 0;
    constraintCount += matches;
    weightedConstraintScore += matches * 0.6;
  }

  const totalWords = normalizedPrompt.trim().split(/\s+/).length;
  const constraintDensity = totalWords > 0 ? (constraintCount / totalWords) * 100 : 0;
  const specialCharCount = normalizedPrompt.match(/[^a-zA-Z0-9\s.,!?\-:']/g)?.length || 0;
  const specialCharRatio = normalizedPrompt.length > 0 ? (specialCharCount / normalizedPrompt.length) * 100 : 0;
  const sentences = normalizedPrompt.split(/[.!?]+/).filter((sentence) => sentence.trim().length > 0);
  const avgWordsPerSentence = sentences.length > 0 ? totalWords / sentences.length : totalWords;

  let score = 0;
  score += Math.min(weightedConstraintScore * 10, 60);
  score += Math.min(constraintDensity * 15, 40);
  score += Math.min(specialCharRatio * 10, 30);
  if (avgWordsPerSentence > 20) score += 5;
  if (avgWordsPerSentence > 40) score += 10;
  if (avgWordsPerSentence > 60) score += 10;
  score += Math.min(wrapperShellCount * 8, 12);

  const hasBase64LikeBlob =
    /\b(?:[A-Za-z0-9+/]{20,}={0,2})\b/.test(prompt) &&
    /[A-Z]/.test(prompt) &&
    /[a-z]/.test(prompt) &&
    /(?:\d|[+/=])/.test(prompt);
  const hasEscapeSequenceBlob = /(?:\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|%[0-9a-fA-F]{2}){3,}/.test(prompt);

  if (hasBase64LikeBlob) score += 24;
  if (hasEscapeSequenceBlob) score += 20;
  if (hasLeetspeakObfuscation(prompt)) score += 28;

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
    .replace(/./g, (char) => CYRILLIC_CONFUSABLES[char] ?? char)
    .replace(/[_./\\-]+/g, ' ')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/@/g, 'a')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasCompatibilityGlyphObfuscation(prompt: string): boolean {
  return COMPATIBILITY_GLYPH_REGEX.test(prompt) && normalizeWithoutLeet(prompt) !== prompt.toLowerCase().replace(ZERO_WIDTH_CHAR_REGEX, '');
}

function hasLeetspeakObfuscation(prompt: string): boolean {
  const tokens = prompt.match(/\b[\w@]+\b/g) || [];
  const suspiciousTokens = tokens.filter((token) => {
    const replacementCount = (token.match(/[0134578@]/g) || []).length;
    const hasLetters = /[a-zA-Z]/.test(token);
    const hasLeetishShape = /^[a-zA-Z0-9@]+$/.test(token);
    if (!hasLetters || !hasLeetishShape || replacementCount < 2) return false;
    return normalizeForPolicy(token) !== normalizeWithoutLeet(token);
  });

  return suspiciousTokens.length > 0;
}

function hasSymbolSubstitutionObfuscation(prompt: string): boolean {
  const meaningfulChars = [...prompt].filter((char) => !/\s/.test(char));
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

  return { decodedSegments, usedObfuscation, maxDecodeDepth, signals: [...signals] };
}

function extractTransformedSegments(prompt: string): { segments: string[]; signals: ObfuscationSignal[] } {
  const segments: string[] = [];
  const signals: ObfuscationSignal[] = [];
  const baselineNormalized = normalizeWithoutLeet(prompt);
  const policyNormalized = normalizeForPolicy(prompt);

  if (hasCompatibilityGlyphObfuscation(prompt)) {
    segments.push(baselineNormalized);
    signals.push('COMPATIBILITY_GLYPHS');
  }

  if (hasLeetspeakObfuscation(prompt) && policyNormalized !== baselineNormalized) {
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
  if (hasSymbolSubstitutionObfuscation(prompt)) signals.push('SYMBOL_SUBSTITUTION');
  return signals;
}

function getDecodeTelemetry(usedObfuscation: boolean, maxDecodeDepth: number): DecodeTelemetry {
  if (!usedObfuscation || maxDecodeDepth === 0) return 'plain_text';
  return maxDecodeDepth > 1 ? 'recursive_decode' : 'single_hop_decode';
}

export function sanitizePrompt(prompt: string, tuning: BackendSanitizationTuning = {}): BackendSanitizationResult {
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

  for (const match of prompt.matchAll(REDACTED_PLACEHOLDER_REGEX)) {
    const placeholderName = match[1];
    if (placeholderName) {
      redactions.add(placeholderName);
      detectionFlags.add(placeholderName);
    }
  }

  const suspiciousEntropyThreshold = tuning.entropyThreshold ?? SUSPICIOUS_ENTROPY_THRESHOLD;
  const suspiciousSyntacticThreshold = tuning.syntacticThreshold ?? 65;
  const configuredBlockedKeywords = (tuning.blockedKeywords ?? [])
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  const configuredForbiddenTopics = (tuning.forbiddenTopics ?? [])
    .map((topic) => topic.trim().toLowerCase())
    .filter(Boolean);
  const configuredRegexRules = (tuning.regexRules ?? [])
    .map((rule) => rule.trim())
    .filter(Boolean);
  const blockedKeywordsToCheck = configuredBlockedKeywords.length > 0
    ? configuredBlockedKeywords
    : BLOCKED_KEYWORDS;
  const entropyAnalysis = analyzeSlidingWindowEntropy(prompt, 35, 5, suspiciousEntropyThreshold);
  const entropyContextSuspicious = hasEntropyEscalationContext(prompt) ||
    entropyAnalysis.suspiciousChunks.some((chunk) => hasEntropyEscalationContext(chunk));
  const syntacticScore = analyzeSyntacticComplexity(prompt);
  const normalized = normalizeForPolicy(prompt);
  const spellingNormalization = normalizeSpellingHeuristic(prompt);
  const normalizedSpellCorrected = normalizeForPolicy(spellingNormalization.text);
  const { decodedSegments, usedObfuscation, maxDecodeDepth, signals: decodedSignals } = extractDecodedSegments(prompt);
  const structuralSignals = detectStructuralObfuscation(prompt);
  const obfuscationSignals = [...decodedSignals, ...structuralSignals];
  const leetspeakDetected =
    hasLeetspeakObfuscation(prompt) || decodedSegments.some((segment) => hasLeetspeakObfuscation(segment));
  const languageSignals = detectLanguageSignals(prompt);
  const externalCallDetected = EXTERNAL_CALL_REGEX.test(prompt);
  const normalizedForeignRecovery = languageSignals.translatedCandidate ? normalizeForPolicy(languageSignals.translatedCandidate) : '';
  const normalizedDecodedSegments = decodedSegments.map((segment) => normalizeForPolicy(segment));
  let transformedSignalsUsed: ObfuscationSignal[] = [];
  let normalizedTransformedSegments: string[] = [];
  let decodeTelemetry = getDecodeTelemetry(usedObfuscation, maxDecodeDepth);
  const blockedKeywordHits = blockedKeywordsToCheck.filter((keyword) =>
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
    const transformedHits = blockedKeywordsToCheck.filter((keyword) =>
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
  if (blockedKeywordHits.length > 0 && decodeTelemetry === 'recursive_decode') {
    detectionFlags.add('RECURSIVE_DECODE');
    redactions.add('RECURSIVE_DECODE');
  }
  for (const signal of decodedSignals) {
    detectionFlags.add(signal);
    redactions.add(signal);
  }
  for (const signal of transformedSignalsUsed.filter((value) => value === 'COMPATIBILITY_GLYPHS')) {
    detectionFlags.add(signal);
    redactions.add(signal);
  }
  if (blockedKeywordHits.length > 0) {
    for (const signal of transformedSignalsUsed) {
      detectionFlags.add(signal);
      redactions.add(signal);
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
  if (externalCallDetected) {
    detectionFlags.add('EXTERNAL_CALL_ATTEMPT');
    redactions.add('EXTERNAL_CALL_ATTEMPT');
  }
  if (COORDINATE_CIPHER_REGEX.test(prompt)) {
    detectionFlags.add('COORDINATE_CIPHER');
    redactions.add('COORDINATE_CIPHER');
  }

  const forbiddenTopicDetected = configuredForbiddenTopics.some((topic) =>
    normalized.includes(topic) ||
    normalizedDecodedSegments.some((segment) => segment.includes(topic)) ||
    normalizedTransformedSegments.some((segment) => segment.includes(topic)) ||
    normalizedSpellCorrected.includes(topic) ||
    (normalizedForeignRecovery ? normalizedForeignRecovery.includes(topic) : false)
  );
  if (forbiddenTopicDetected) {
    detectionFlags.add('FORBIDDEN_TOPIC');
    redactions.add('FORBIDDEN_TOPIC');
  }

  let regexMatchDetected = false;
  for (const rule of configuredRegexRules) {
    try {
      let pattern = rule;
      let flags = 'gi';
      if (rule.startsWith('/') && rule.lastIndexOf('/') > 0) {
        pattern = rule.substring(1, rule.lastIndexOf('/'));
        flags = rule.substring(rule.lastIndexOf('/') + 1) || 'gi';
      }
      const regex = new RegExp(pattern, flags);
      if (regex.test(prompt)) {
        regexMatchDetected = true;
        detectionFlags.add('REGEX_MATCH');
        redactions.add('REGEX_MATCH');
        break;
      }
    } catch (error) {
      console.error('Invalid backend regex rule:', rule, error);
    }
  }

  if (blockedKeywordHits.length > 0 || forbiddenTopicDetected || regexMatchDetected) {
    detectionFlags.add('POLICY_VIOLATION');
    redactions.add('POLICY_VIOLATION');
  }

  if (entropyAnalysis.maxEntropy > suspiciousEntropyThreshold && entropyContextSuspicious) detectionFlags.add('TOKEN_DILUTION');
  if (syntacticScore >= suspiciousSyntacticThreshold) detectionFlags.add('SYNTACTIC_PROBE');
  if (prompt.length > 2000) detectionFlags.add('EXCESSIVE_LENGTH');

  let verdict: FirewallVerdict = 'CLEAN';
  const reasons: string[] = [];

  if (entropyAnalysis.maxEntropy > ADVERSARIAL_ENTROPY_THRESHOLD && entropyContextSuspicious) reasons.push('adversarial entropy threshold exceeded');
  if (syntacticScore >= 90) reasons.push('adversarial syntactic complexity threshold exceeded');
  if (redactions.has('CANARY_TOKEN')) reasons.push('canary token disclosure attempt detected');
  if (redactions.has('PRIVATE_KEY') || redactions.has('AWS_KEY')) reasons.push('high-risk secret material detected');

  if (reasons.length > 0) {
    verdict = 'ADVERSARIAL';
  } else if (
    (entropyAnalysis.maxEntropy > suspiciousEntropyThreshold && entropyContextSuspicious) ||
    syntacticScore >= suspiciousSyntacticThreshold ||
    blockedKeywordHits.length > 0 ||
    forbiddenTopicDetected ||
    regexMatchDetected ||
    externalCallDetected ||
    COORDINATE_CIPHER_REGEX.test(prompt) ||
    prompt.length > 2000
  ) {
    verdict = 'SUSPICIOUS';
    reasons.push('prompt matched suspicious firewall criteria');
  } else if (
    usedObfuscation ||
    obfuscationSignals.length > 0 ||
    leetspeakDetected ||
    transformedSignalsUsed.includes('COMPATIBILITY_GLYPHS')
  ) {
    verdict = 'SUSPICIOUS';
    reasons.push('prompt used obfuscation or concealment techniques');
  } else if (languageSignals.isForeignLanguage || spellingObfuscationDetected) {
    reasons.push('prompt triggered lightweight language or spelling recovery analysis');
  } else if (redactions.size > 0) {
    reasons.push('sensitive data was redacted before routing');
  } else {
    reasons.push('no active firewall criteria matched');
  }

  const latencyMs = performance.now() - start;
  if (latencyMs > SANITIZATION_REDOS_LATENCY_THRESHOLD_MS) {
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

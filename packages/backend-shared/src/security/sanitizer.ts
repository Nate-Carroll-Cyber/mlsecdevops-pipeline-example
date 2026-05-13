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

interface CreditCardMatch {
  start: number;
  end: number;
  raw: string;
  digits: string;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  { name: 'EMAIL', regex: /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g },
  { name: 'LLM_API_KEY', regex: /(?<![A-Za-z0-9])sk[-_](?:proj[-_]|svcacct[-_])?[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g },
  { name: 'PHONE', regex: /(?<!\d)(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g },
  { name: 'AWS_KEY', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'PRIVATE_KEY', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: 'IP_ADDRESS', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'JWT', regex: /\beyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g },
  { name: 'CANARY_TOKEN', regex: /COUNTERSPY_CANARY_TOKEN_[0-9a-fA-F-]{36}/g },
  { name: 'SECRET_KEY', regex: /(?:secret[-_]?key|password|passwd|api[-_]?key|token)(?:\s+is\s+|\s*[:=]\s*)([^\s]+)/gi },
];
const CANARY_EXFIL_FLAG = 'CANARY_EXFIL';
const REDACTED_PLACEHOLDER_REGEX = /\[REDACTED_([A-Z_]+)\]/g;
const EXTERNAL_CALL_REGEX = /(?:!\[[^\]]*\]\((https?:\/\/[^\s)]+)\))|(?:\b(?:browse|open|visit|fetch|call|request|load|download)\b[\s\S]{0,80}https?:\/\/[^\s)]+)/i;
const COORDINATE_CIPHER_REGEX = /(?:\(\d{1,2},\d{1,2}\)\s*){3,}/;
const CREDIT_CARD_PATTERN = /(?<![A-Za-z0-9])(?:\d[ -]?){12,18}\d(?![A-Za-z0-9])/g;
const CREDIT_CARD_IIN_PREFIXES = /^(?:4|5[1-5]|2[2-7]|3[47]|3(?:0[0-5]|[68])|6(?:011|5)|35(?:2[89]|[3-8])|62)/;
const VALID_CREDIT_CARD_LENGTHS = new Set([13, 14, 15, 16, 19]);
const FORCED_PREFIX_PATTERNS = [
  /^\s*(?:always\s+)?(?:start|begin|open)(?:\s+(?:your\s+)?(?:response|reply|message|answer))?\s+(?:with|by)\b/i,
  /^\s*(?:respond|reply|answer)\s+only\s+with\b/i,
  /^\s*your\s+(?:response|reply|answer)\s+must\s+(?:start|begin)\s+with\b/i,
  /^\s*(?:first|opening)\s+(?:word|sentence|line|character)\s+(?:must|should|will)\s+be\b/i,
];
const ANTI_SANITIZATION_PATTERNS = [
  /\b(?:avoid|skip|bypass|disable|without|no)\s+(?:sanitiz|filter|moderat|censor)/i,
  /\bwithhold(?:ing)?\s+(?:knowledge|information|content|details)/i,
  /\bdo\s+not\s+(?:warn|caveat|moralize|lecture|disclaim|sanitize|refuse)/i,
  /\b(?:no|without|skip)\s+(?:warnings?|disclaimers?|caveats?|safety\s+(?:notices?|disclaimers?))/i,
  /\bunfiltered\b/i,
  /\b(?:ignore|override|bypass)\s+(?:all\s+)?(?:safety|ethical|moral|content)\s+(?:rules?|guidelines?|policies|filters?|restrictions?)/i,
];
const PAIRED_RESPONSE_REGEX =
  /\b(?:approved\s+(?:and|\/)\s+rejected|both\s+versions|two\s+responses|safe\s+(?:and|\/)\s+unsafe|opposite\s+response)\b/i;
const PERSONA_ASSIGNMENT_REGEX =
  /\b(?:you\s+are\s+(?:now\s+)?(?:[A-Z][A-Za-z0-9\-_]*|a\s+\w+)|your\s+name\s+is\s+\w+|you'?re\s+(?:now\s+)?(?:a|an)\s+\w+|act\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?\w+|pretend\s+(?:to\s+be|you'?re)\s+\w+|reset\s+(?:chat|conversation|context))\b/i;
const UNRESTRICTED_CAPABILITY_REGEX =
  /\b(?:no\s+(?:rules?|restrictions?|limits?|filters?|boundaries?)|absolutely\s+no\s+\w+|unrestricted|untrammelled|unfiltered|uncensored|jailbroken|ignore\s+(?:all\s+)?(?:safety|previous|prior)\s+(?:instructions?|rules?|guidelines?)|can\s+do\s+anything|do\s+anything\s+(?:asked|requested)|any\s+(?:area|topic|subject)\s+is\s+open|gray\s+area|black\s+area|DAN\b|developer\s+mode|admin\s+mode)\b/i;
const ALLCAPS_PERSONA_REGEX = /\b[A-Z]{4,}(?:-[A-Z0-9]+)+\b/;
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

const ZERO_WIDTH_CHAR_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const BASE64_SEGMENT_REGEX = /(?:^|[^A-Za-z0-9+/=])([A-Za-z0-9+/]{20,}={0,2})(?=$|[^A-Za-z0-9+/=])/g;
const HEX_SEGMENT_PATTERNS = [
  /\b[0-9a-fA-F]{16,}\b/g,
  /(?:0x[0-9a-fA-F]{2}[\s,]*){8,}/g,
  /(?:\\x[0-9a-fA-F]{2}){8,}/g,
  /(?:\b[0-9a-fA-F]{2}\b[\s,]+){7,}\b[0-9a-fA-F]{2}\b/g,
];
const BINARY_SEGMENT_PATTERNS = [
  /(?:[01]{8}[\s,;|]+){7,}[01]{8}/g,
  /(?:[01]{8}\n+){7,}[01]{8}/g,
  /(?<![01])[01]{64,}(?![01])/g,
];
const ASCII_DECIMAL_SEGMENT_REGEX =
  /(?:\b(?:[3-9]\d|1[01]\d|12[0-6])\b[\s,;]+){7,}\b(?:[3-9]\d|1[01]\d|12[0-6])\b/g;
const A1Z26_SEGMENT_REGEX =
  /(?<![0-9])(?:(?:0|0?[1-9]|1[0-9]|2[0-6])[\s\-.,/]+){7,}(?:0|0?[1-9]|1[0-9]|2[0-6])(?![0-9])/g;
const URL_SEGMENT_REGEX = /(?:%[0-9A-Fa-f]{2}){6,}/g;
const HTML_ENTITY_SEGMENT_REGEX = /(?:&#(?:x[0-9A-Fa-f]+|\d+);){4,}/g;
const UNICODE_ESCAPE_SEGMENT_REGEX = /(?:(?:\\u[0-9A-Fa-f]{4})|(?:\\x[0-9A-Fa-f]{2})){2,}/g;
const NATO_SEGMENT_REGEX = /\b(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-ray|xray|yankee|zulu)(?:\s+(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|x-ray|xray|yankee|zulu)){3,}\b/gi;
const MORSE_SEGMENT_REGEX = /(?:[.\-]+(?:\s+[.\-/]+){3,})/g;
const BRAILLE_SEGMENT_REGEX = /(?:[\u2800-\u28FF]+\s*){2,}/gu;
const REGIONAL_INDICATOR_SEGMENT_REGEX = /(?:[\u{1F1E6}-\u{1F1FF}]\s*){2,}/gu;
const MAX_DECODE_DEPTH = 3;
const MAX_DECODE_SEGMENTS = 24;
const MIN_BINARY_BYTES = 8;
const MAX_BINARY_BYTES = 4096;
const BINARY_PRINTABLE_THRESHOLD = 0.85;
const MIN_A1Z26_LETTERS = 8;
const MAX_A1Z26_LETTERS = 2048;
const MIN_PIG_LATIN_TOKENS = 8;
const PIG_LATIN_RATIO_THRESHOLD = 0.4;
const COMMON_BIGRAMS = new Set([
  'th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'ti', 'es', 'or', 'te', 'of',
  'ed', 'is', 'it', 'al', 'ar', 'st', 'to', 'nt', 'ng', 'se', 'ha', 'as', 'ou', 'io', 'le',
  've', 'co', 'me', 'de', 'hi', 'ri', 'ro', 'ic', 'ne', 'ea', 'ra', 'ce', 'li', 'ch', 'll',
  'be', 'ma', 'si', 'om', 'ur', 'ca', 'el', 'ta', 'la', 'ns', 'di', 'fo',
]);
const COMMON_AY_WORDS = new Set([
  'day', 'way', 'say', 'may', 'play', 'stay', 'pay', 'ray', 'gay', 'lay',
  'bay', 'hay', 'jay', 'nay', 'tray', 'spray', 'stray', 'today', 'away',
  'okay', 'anyway', 'display', 'betray', 'delay', 'essay', 'decay', 'relay',
  'subway', 'halfway', 'highway', 'doorway', 'runway', 'midway', 'always',
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'yesterday', 'everyday', 'someday', 'holiday', 'birthday', 'yay', 'hooray',
  'hurray',
]);
const SUSPICIOUS_ENTROPY_THRESHOLD = 3.8;
const ADVERSARIAL_ENTROPY_THRESHOLD = 4.0;
type DecodeTelemetry = 'plain_text' | 'single_hop_decode' | 'recursive_decode';
type ObfuscationSignal =
  | 'URL_ENCODING'
  | 'HTML_ENTITIES'
  | 'UNICODE_ESCAPES'
  | 'BINARY_ENCODING'
  | 'ASCII_DECIMAL'
  | 'A1Z26'
  | 'PIG_LATIN'
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
const SHORT_LINE_MAX_CHARS = 3;
const MIN_VERTICAL_RUN_LINES = 4;
const POSITIONAL_ROW_REGEX = /^\s*(\S)\s*[-–—:]\s*position\s+\d+\s*$/i;
const ORDINAL_TOKEN_REGEX = /^\d+(?:st|nd|rd|th)$/i;
const DIMENSION_TOKEN_REGEX = /^\d+(?:x|by)\d+(?:x\d+)?$/i;
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

function hasForcedPrefix(prompt: string): boolean {
  const head = prompt.slice(0, 200);
  return FORCED_PREFIX_PATTERNS.some((pattern) => pattern.test(head));
}

function hasAntiSanitizationClause(prompt: string): boolean {
  return ANTI_SANITIZATION_PATTERNS.some((pattern) => pattern.test(prompt));
}

function hasPersonaInjection(prompt: string): boolean {
  return PERSONA_ASSIGNMENT_REGEX.test(prompt) && UNRESTRICTED_CAPABILITY_REGEX.test(prompt);
}

function hasPairedResponseInjection(prompt: string): boolean {
  return PAIRED_RESPONSE_REGEX.test(prompt);
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let alternate = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (alternate) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

function findCreditCards(text: string): CreditCardMatch[] {
  const matches: CreditCardMatch[] = [];

  for (const match of text.matchAll(CREDIT_CARD_PATTERN)) {
    const raw = match[0];
    const digits = raw.replace(/[ -]/g, '');
    if (!VALID_CREDIT_CARD_LENGTHS.has(digits.length)) continue;
    if (!CREDIT_CARD_IIN_PREFIXES.test(digits)) continue;
    if (!passesLuhn(digits)) continue;

    const start = match.index ?? 0;
    matches.push({
      start,
      end: start + raw.length,
      raw,
      digits,
    });
  }

  return matches;
}

function redactCreditCardMatches(text: string): string {
  return findCreditCards(text)
    .sort((a, b) => b.start - a.start)
    .reduce((next, match) =>
      `${next.slice(0, match.start)}[REDACTED_CREDIT_CARD]${next.slice(match.end)}`,
      text,
    );
}

interface ReflowedPrompt {
  normalized: string;
  reflowed: string;
  hadVerticalRun: boolean;
}

function uniqueTextCandidates(candidates: string[]): string[] {
  return [...new Set(candidates.filter((candidate) => candidate.trim().length > 0))];
}

function preNormalizeVerticalText(prompt: string): string {
  return prompt
    .normalize('NFKC')
    .replace(ZERO_WIDTH_CHAR_REGEX, '')
    .replace(/\r\n?/g, '\n');
}

function collapseVerticalRun(run: string[]): string {
  return run
    .map((line) => {
      const trimmed = line.trim();
      const positionalMatch = trimmed.match(POSITIONAL_ROW_REGEX);
      if (positionalMatch?.[1]) return positionalMatch[1];
      return trimmed === '' ? ' ' : trimmed;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVerticalRunLine(line: string): boolean {
  const visible = line.trim();
  return visible.length <= SHORT_LINE_MAX_CHARS || POSITIONAL_ROW_REGEX.test(visible);
}

function isAlphabeticVerticalLine(line: string): boolean {
  const visible = line.trim();
  const positionalMatch = visible.match(POSITIONAL_ROW_REGEX);
  const candidate = positionalMatch?.[1] ?? visible;
  return /\p{L}/u.test(candidate) && !/^\d+[\).]?$/.test(candidate);
}

function isSuspiciousVerticalRun(run: string[]): boolean {
  const nonBlankLines = run.filter((line) => line.trim() !== '');
  if (nonBlankLines.length === 0) return false;
  const alphabeticLines = nonBlankLines.filter(isAlphabeticVerticalLine);
  return alphabeticLines.length / nonBlankLines.length >= 0.6;
}

function reflowVerticalText(prompt: string): ReflowedPrompt {
  const normalized = preNormalizeVerticalText(prompt);
  const lines = normalized.split('\n');
  const out: string[] = [];
  let run: string[] = [];
  let hadVerticalRun = false;

  const flushRun = () => {
    if (run.length >= MIN_VERTICAL_RUN_LINES && isSuspiciousVerticalRun(run)) {
      const collapsed = collapseVerticalRun(run);
      if (collapsed) out.push(collapsed);
      hadVerticalRun = true;
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const line of lines) {
    if (isVerticalRunLine(line)) {
      run.push(line);
    } else {
      flushRun();
      out.push(line);
    }
  }
  flushRun();

  return { normalized, reflowed: out.join('\n'), hadVerticalRun };
}
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
    if (ORDINAL_TOKEN_REGEX.test(token) || DIMENSION_TOKEN_REGEX.test(token)) return false;
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
  const normalizedSegment = segment
    .replace(/(?:0x|\\x)/gi, '')
    .replace(/[^0-9a-fA-F]/g, '');
  if (normalizedSegment.length % 2 !== 0 || normalizedSegment.length < 16) return null;

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

function decodeBinarySegment(segment: string): string | null {
  const normalizedSegment = segment.replace(/[^01]/g, '');
  if (normalizedSegment.length < MIN_BINARY_BYTES * 8) return null;
  if (normalizedSegment.length > MAX_BINARY_BYTES * 8) return null;
  if (normalizedSegment.length % 8 !== 0) return null;

  let decoded = '';
  for (let index = 0; index < normalizedSegment.length; index += 8) {
    decoded += String.fromCharCode(parseInt(normalizedSegment.slice(index, index + 8), 2));
  }

  const printableRatio = decoded.split('').filter((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code < 127);
  }).length / decoded.length;

  return printableRatio >= BINARY_PRINTABLE_THRESHOLD ? decoded : null;
}

function decodeAsciiDecimalSegment(segment: string): string | null {
  const values = segment.match(/\b(?:[3-9]\d|1[01]\d|12[0-6])\b/g) || [];
  if (values.length < 8) return null;

  const decoded = values.map((value) => String.fromCharCode(parseInt(value, 10))).join('');
  const printableRatio = decoded.split('').filter((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code < 127);
  }).length / decoded.length;

  return printableRatio >= 0.85 ? decoded : null;
}

function englishBigramScore(value: string): number {
  const compact = value.toLowerCase().replace(/[^a-z]/g, '');
  if (compact.length < 2) return 0;
  let hits = 0;
  for (let index = 0; index < compact.length - 1; index += 1) {
    if (COMMON_BIGRAMS.has(compact.slice(index, index + 2))) hits += 1;
  }
  return hits / (compact.length - 1);
}

function decodeA1Z26Segment(segment: string): string | null {
  const tokens = segment.match(/\b(?:0|0?[1-9]|1[0-9]|2[0-6])\b/g);
  if (!tokens) return null;

  const values = tokens.map((token) => parseInt(token, 10));
  if (values.some((value) => value < 0 || value > 26)) return null;

  const letterCount = values.filter((value) => value > 0).length;
  if (letterCount < MIN_A1Z26_LETTERS || letterCount > MAX_A1Z26_LETTERS) return null;

  const decoded = values
    .map((value) => (value === 0 ? ' ' : String.fromCharCode(96 + value)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return englishBigramScore(decoded) >= 0.3 ? decoded : null;
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

    const hexMatches = HEX_SEGMENT_PATTERNS.flatMap((pattern) => current.value.match(pattern) || []);
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

    const binaryMatches = BINARY_SEGMENT_PATTERNS.flatMap((pattern) => current.value.match(pattern) || []);
    for (const match of binaryMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeBinarySegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('BINARY_ENCODING');
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const asciiDecimalMatches = current.value.match(ASCII_DECIMAL_SEGMENT_REGEX) || [];
    for (const match of asciiDecimalMatches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeAsciiDecimalSegment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('ASCII_DECIMAL');
      const nextDepth = current.depth + 1;
      queue.push({ value: decoded, depth: nextDepth });
      maxDecodeDepth = Math.max(maxDecodeDepth, nextDepth);
      usedObfuscation = true;
    }

    const a1z26Matches = current.value.match(A1Z26_SEGMENT_REGEX) || [];
    for (const match of a1z26Matches) {
      if (decodedSegments.length >= MAX_DECODE_SEGMENTS) break;
      const decoded = decodeA1Z26Segment(match);
      if (!decoded || seenSegments.has(decoded)) continue;
      seenSegments.add(decoded);
      decodedSegments.push(decoded);
      signals.add('A1Z26');
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
  const verticalReflow = reflowVerticalText(prompt);

  if (verticalReflow.hadVerticalRun && verticalReflow.reflowed !== verticalReflow.normalized) {
    segments.push(verticalReflow.reflowed);
    signals.push('VERTICAL_TEXT');
  }

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

function detectPigLatin(prompt: string): { score: number; isPigLatin: boolean; suspiciousTokens: string[] } {
  const tokens = prompt
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 3);

  if (tokens.length < MIN_PIG_LATIN_TOKENS) {
    return { score: 0, isPigLatin: false, suspiciousTokens: [] };
  }

  const suspiciousTokens = tokens.filter((token) =>
    /[a-z]{3,}ay$/.test(token) && !COMMON_AY_WORDS.has(token)
  );
  const score = suspiciousTokens.length / tokens.length;

  return {
    score,
    isPigLatin: score >= PIG_LATIN_RATIO_THRESHOLD,
    suspiciousTokens,
  };
}

function detectStructuralObfuscation(prompt: string): ObfuscationSignal[] {
  const signals: ObfuscationSignal[] = [];
  if (END_SEQUENCE_REGEX.test(prompt)) signals.push('END_SEQUENCE');
  if (CHUNKING_REGEX.test(prompt)) signals.push('CHUNKING');
  if (VARIABLE_EXPANSION_REGEX.test(prompt)) signals.push('VARIABLE_EXPANSION');
  if (VERTICAL_TEXT_REGEX.test(prompt) || reflowVerticalText(prompt).hadVerticalRun) signals.push('VERTICAL_TEXT');
  if (detectPigLatin(prompt).isPigLatin) signals.push('PIG_LATIN');
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
      if (pattern.name === 'CANARY_TOKEN') {
        redactions.add(CANARY_EXFIL_FLAG);
        detectionFlags.add(CANARY_EXFIL_FLAG);
      }
      sanitized = sanitized.replace(pattern.regex, `[REDACTED_${pattern.name}]`);
    }
  }

  if (findCreditCards(prompt).length > 0) {
    redactions.add('CREDIT_CARD');
    detectionFlags.add('CREDIT_CARD');
    sanitized = redactCreditCardMatches(sanitized);
  }

  for (const match of prompt.matchAll(REDACTED_PLACEHOLDER_REGEX)) {
    const placeholderName = match[1];
    if (placeholderName) {
      redactions.add(placeholderName);
      detectionFlags.add(placeholderName);
      if (placeholderName === 'CANARY_TOKEN') {
        redactions.add(CANARY_EXFIL_FLAG);
        detectionFlags.add(CANARY_EXFIL_FLAG);
      }
    }
  }

  const suspiciousEntropyThreshold = SUSPICIOUS_ENTROPY_THRESHOLD;
  const adversarialEntropyThreshold = Math.max(
    tuning.entropyThreshold ?? ADVERSARIAL_ENTROPY_THRESHOLD,
    suspiciousEntropyThreshold,
  );
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
  const verticalReflow = reflowVerticalText(prompt);
  const detectorCandidates = verticalReflow.hadVerticalRun
    ? uniqueTextCandidates([prompt, verticalReflow.normalized, verticalReflow.reflowed])
    : [prompt];
  const entropyAnalysis = analyzeSlidingWindowEntropy(prompt, 35, 5, suspiciousEntropyThreshold);
  const entropyContextSuspicious = hasEntropyEscalationContext(prompt) ||
    entropyAnalysis.suspiciousChunks.some((chunk) => hasEntropyEscalationContext(chunk));
  const syntacticScore = Math.max(...detectorCandidates.map((candidate) => analyzeSyntacticComplexity(candidate)));
  const normalizedCandidates = detectorCandidates.map((candidate) => normalizeForPolicy(candidate));
  const normalized = normalizedCandidates[0] ?? normalizeForPolicy(prompt);
  const spellingNormalization = normalizeSpellingHeuristic(prompt);
  const normalizedSpellCorrected = normalizeForPolicy(spellingNormalization.text);
  const { decodedSegments, usedObfuscation, maxDecodeDepth, signals: decodedSignals } = extractDecodedSegments(prompt);
  const structuralSignals = detectStructuralObfuscation(prompt);
  const obfuscationSignals = [...decodedSignals, ...structuralSignals];
  const leetspeakDetected =
    hasLeetspeakObfuscation(prompt) || decodedSegments.some((segment) => hasLeetspeakObfuscation(segment));
  const languageSignals = detectLanguageSignals(prompt);
  const externalCallDetected = detectorCandidates.some((candidate) => EXTERNAL_CALL_REGEX.test(candidate));
  const forcedPrefixDetected = detectorCandidates.some((candidate) => hasForcedPrefix(candidate));
  const antiSanitizationDetected = detectorCandidates.some((candidate) => hasAntiSanitizationClause(candidate));
  const personaInjectionDetected = detectorCandidates.some((candidate) => hasPersonaInjection(candidate));
  const pairedResponseDetected = detectorCandidates.some((candidate) => hasPairedResponseInjection(candidate));
  const allCapsPersonaDetected = detectorCandidates.some((candidate) => ALLCAPS_PERSONA_REGEX.test(candidate));
  const normalizedForeignRecovery = languageSignals.translatedCandidate ? normalizeForPolicy(languageSignals.translatedCandidate) : '';
  const normalizedDecodedSegments = decodedSegments.map((segment) => normalizeForPolicy(segment));
  let transformedSignalsUsed: ObfuscationSignal[] = [];
  let normalizedTransformedSegments: string[] = [];
  let decodeTelemetry = getDecodeTelemetry(usedObfuscation, maxDecodeDepth);
  const blockedKeywordHits = blockedKeywordsToCheck.filter((keyword) =>
    normalizedCandidates.some((candidate) => candidate.includes(keyword)) ||
    normalizedDecodedSegments.some((segment) => segment.includes(keyword)) ||
    normalizedSpellCorrected.includes(keyword) ||
    (normalizedForeignRecovery ? normalizedForeignRecovery.includes(keyword) : false)
  );
  const spellingObfuscationDetected = spellingNormalization.changed && blockedKeywordHits.some((keyword) =>
    !normalizedCandidates.some((candidate) => candidate.includes(keyword)) && normalizedSpellCorrected.includes(keyword)
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
  if (forcedPrefixDetected) {
    detectionFlags.add('FORCED_PREFIX_INJECTION');
    redactions.add('FORCED_PREFIX_INJECTION');
  }
  if (antiSanitizationDetected) {
    detectionFlags.add('ANTI_SANITIZATION_CLAUSE');
    redactions.add('ANTI_SANITIZATION_CLAUSE');
  }
  if (personaInjectionDetected) {
    detectionFlags.add('PERSONA_INJECTION');
    redactions.add('PERSONA_INJECTION');
  }
  if (pairedResponseDetected) {
    detectionFlags.add('PAIRED_RESPONSE_INJECTION');
    redactions.add('PAIRED_RESPONSE_INJECTION');
  }
  if (allCapsPersonaDetected) {
    detectionFlags.add('ALLCAPS_PERSONA');
    redactions.add('ALLCAPS_PERSONA');
  }
  if (detectorCandidates.some((candidate) => COORDINATE_CIPHER_REGEX.test(candidate))) {
    detectionFlags.add('COORDINATE_CIPHER');
    redactions.add('COORDINATE_CIPHER');
  }

  const forbiddenTopicDetected = configuredForbiddenTopics.some((topic) =>
    normalizedCandidates.some((candidate) => candidate.includes(topic)) ||
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
      if (detectorCandidates.some((candidate) => {
        regex.lastIndex = 0;
        return regex.test(candidate);
      })) {
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

  if (entropyAnalysis.maxEntropy > adversarialEntropyThreshold && entropyContextSuspicious) reasons.push('adversarial entropy threshold exceeded');
  if (syntacticScore >= 90) reasons.push('adversarial syntactic complexity threshold exceeded');
  if (redactions.has('CANARY_TOKEN')) reasons.push('canary token disclosure attempt detected');
  if (redactions.has('PRIVATE_KEY') || redactions.has('AWS_KEY') || redactions.has('LLM_API_KEY')) reasons.push('high-risk secret material detected');

  if (reasons.length > 0) {
    verdict = 'ADVERSARIAL';
  } else if (
    (entropyAnalysis.maxEntropy > suspiciousEntropyThreshold && entropyContextSuspicious) ||
    syntacticScore >= suspiciousSyntacticThreshold ||
    blockedKeywordHits.length > 0 ||
    forbiddenTopicDetected ||
    regexMatchDetected ||
    externalCallDetected ||
    forcedPrefixDetected ||
    antiSanitizationDetected ||
    personaInjectionDetected ||
    (
      pairedResponseDetected &&
      (
        blockedKeywordHits.length > 0 ||
        forbiddenTopicDetected ||
        regexMatchDetected ||
        externalCallDetected ||
        forcedPrefixDetected ||
        antiSanitizationDetected ||
        personaInjectionDetected ||
        usedObfuscation ||
        obfuscationSignals.length > 0 ||
        leetspeakDetected
      )
    ) ||
    detectorCandidates.some((candidate) => COORDINATE_CIPHER_REGEX.test(candidate)) ||
    prompt.length > 2000
  ) {
    verdict = 'SUSPICIOUS';
    reasons.push('The prompt matched suspicious firewall criteria.');
  } else if (
    usedObfuscation ||
    obfuscationSignals.length > 0 ||
    leetspeakDetected ||
    transformedSignalsUsed.includes('COMPATIBILITY_GLYPHS')
  ) {
    verdict = 'SUSPICIOUS';
    reasons.push('The prompt used obfuscation or concealment techniques.');
  } else if (languageSignals.isForeignLanguage || spellingObfuscationDetected) {
    reasons.push('The prompt triggered lightweight language or spelling recovery analysis.');
  } else if (redactions.size > 0) {
    reasons.push('Sensitive data was redacted before routing.');
  } else {
    reasons.push('No active firewall criteria matched.');
  }

  const latencyMs = performance.now() - start;
  if (latencyMs > SANITIZATION_REDOS_LATENCY_THRESHOLD_MS) {
    detectionFlags.add('ReDoS_ATTEMPT_DETECTED');
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

// --- Output-side Shield -----------------------------------------------------
// The cardinal rule applies to model *output* as well: text coming back from the
// responder LLM must not carry secrets/PII or echo blocked policy keywords to the
// caller un-flagged. This is intentionally lighter than `sanitizePrompt` — model
// text is not an adversarial vector for entropy/syntactic heuristics, so we only
// run the redaction passes and a blocked-keyword check.

export interface OutputSanitizationResult {
  original: string;
  sanitized: string;
  redactions: string[];
  detectionFlags: string[];
  blockedKeywordHits: string[];
  /** True when secret/credential material was found (canary, private/AWS/LLM keys). */
  highRiskLeak: boolean;
  /** True when anything at all was redacted or a blocked keyword matched. */
  tripped: boolean;
}

const OUTPUT_HIGH_RISK_REDACTIONS = new Set([
  'CANARY_TOKEN',
  'CANARY_EXFIL',
  'PRIVATE_KEY',
  'AWS_KEY',
  'LLM_API_KEY',
  'SECRET_KEY',
]);

export function sanitizeOutput(text: string, tuning: Pick<BackendSanitizationTuning, 'blockedKeywords'> = {}): OutputSanitizationResult {
  let sanitized = text;
  const redactions = new Set<string>();
  const detectionFlags = new Set<string>();

  for (const pattern of SENSITIVE_PATTERNS) {
    if (text.match(pattern.regex)) {
      redactions.add(pattern.name);
      detectionFlags.add(`OUTPUT_${pattern.name}`);
      if (pattern.name === 'CANARY_TOKEN') {
        redactions.add(CANARY_EXFIL_FLAG);
        detectionFlags.add(`OUTPUT_${CANARY_EXFIL_FLAG}`);
      }
      sanitized = sanitized.replace(pattern.regex, `[REDACTED_${pattern.name}]`);
    }
  }

  if (findCreditCards(text).length > 0) {
    redactions.add('CREDIT_CARD');
    detectionFlags.add('OUTPUT_CREDIT_CARD');
    sanitized = redactCreditCardMatches(sanitized);
  }

  for (const match of text.matchAll(REDACTED_PLACEHOLDER_REGEX)) {
    const placeholderName = match[1];
    if (placeholderName) {
      redactions.add(placeholderName);
      detectionFlags.add(`OUTPUT_${placeholderName}`);
    }
  }

  const configuredBlockedKeywords = (tuning.blockedKeywords ?? [])
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  const keywordsToCheck = configuredBlockedKeywords.length > 0 ? configuredBlockedKeywords : BLOCKED_KEYWORDS;
  const normalizedOutput = normalizeForPolicy(text);
  const blockedKeywordHits = keywordsToCheck.filter((keyword) => normalizedOutput.includes(keyword));
  for (const keyword of blockedKeywordHits) {
    detectionFlags.add(`OUTPUT_BLOCKED_KEYWORD:${keyword}`);
  }
  if (blockedKeywordHits.length > 0) detectionFlags.add('OUTPUT_BLOCKED_KEYWORD');

  const highRiskLeak = [...redactions].some((redaction) => OUTPUT_HIGH_RISK_REDACTIONS.has(redaction));
  const tripped = redactions.size > 0 || blockedKeywordHits.length > 0;
  if (tripped) detectionFlags.add('OUTPUT_REDACTED');
  if (highRiskLeak) detectionFlags.add('OUTPUT_HIGH_RISK_LEAK');

  return {
    original: text,
    sanitized,
    redactions: [...redactions],
    detectionFlags: [...detectionFlags],
    blockedKeywordHits,
    highRiskLeak,
    tripped,
  };
}

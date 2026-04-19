/**
 * Lightweight spelling normalization helpers.
 * Used in the Playground language pipeline and in cheap upstream recovery logic
 * so obvious misspellings can be analyzed without sending provider requests first.
 */
export type SpellCheckBackend = 'heuristic' | 'languagetool';

export interface SpellCheckOptions {
  backend?: SpellCheckBackend;
  languageToolUrl?: string;
  language?: string;
}

export interface NormalizationCorrection {
  original: string;
  replacement: string;
  offset: number;
}

export interface NormalizationResult {
  text: string;
  changed: boolean;
  original: string;
  corrections: NormalizationCorrection[];
  backend: SpellCheckBackend;
}

const DEFAULT_LANGUAGE_TOOL_URL = 'http://localhost:8010';
const DEFAULT_LANGUAGE = 'en-US';

const COMMON_CORRECTIONS: Record<string, string> = {
  anwser: 'answer',
  bypasss: 'bypass',
  bypas: 'bypass',
  codition: 'condition',
  cystem: 'system',
  devloper: 'developer',
  disclsoe: 'disclose',
  dsregard: 'disregard',
  filterrs: 'filters',
  hiddenn: 'hidden',
  ignroe: 'ignore',
  ignoor: 'ignore',
  ignorre: 'ignore',
  instuctions: 'instructions',
  instructons: 'instructions',
  instrucitons: 'instructions',
  msg: 'message',
  ouptut: 'output',
  polcies: 'policies',
  polocy: 'policy',
  previuos: 'previous',
  previos: 'previous',
  prawmpt: 'prompt',
  prmt: 'prompt',
  promt: 'prompt',
  promppt: 'prompt',
  prnt: 'print',
  reavl: 'reveal',
  restricions: 'restrictions',
  reveaal: 'reveal',
  reveel: 'reveal',
  responed: 'respond',
  saftey: 'safety',
  secrt: 'secret',
  systm: 'system',
  sysytem: 'system',
  yoru: 'your',
};

const ENCODED_PATTERNS = [
  /^[01\s]+$/,
  /^[0-9a-f]{4,}$/i,
  /^[\.\-\/\s]+$/,
  /^[0-9]+-[0-9]+-/,
  /^%[0-9A-F]{2}/i,
  /^&#[0-9]+;/,
  /^&[a-z]+;/i,
  /^[0-9]{2,}$/,
  /^[A-Za-z0-9+/]{20,}={0,2}$/,
];

const WORD_PATTERN = /\b[\p{L}\p{N}'-]+\b/gu;

// Preserve the original token casing when applying a normalized replacement.
function preserveCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] && original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// Collapse exaggerated repeated letters so common typo variants still resolve.
function collapseRepeatedLetters(word: string): string {
  return word.replace(/([a-z])\1{2,}/gi, '$1');
}

// Lookup against the local correction table before we do anything more expensive.
function lookupCorrection(word: string): string | null {
  const normalized = word.toLowerCase();
  if (COMMON_CORRECTIONS[normalized]) return COMMON_CORRECTIONS[normalized];

  const collapsed = collapseRepeatedLetters(normalized);
  if (collapsed !== normalized && COMMON_CORRECTIONS[collapsed]) {
    return COMMON_CORRECTIONS[collapsed];
  }

  return null;
}

// Treat obviously encoded tokens as off-limits for spell correction.
export function isLikelyEncoded(word: string): boolean {
  if (word.length > 30) return true;
  if (/[^\x00-\x7F]/.test(word)) return true;
  return ENCODED_PATTERNS.some((pattern) => pattern.test(word));
}

// Skip the whole string when the majority of its tokens look encoded/non-plain-text.
export function isTextLikelyEncoded(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const encodedCount = words.filter(isLikelyEncoded).length;
  return encodedCount / words.length > 0.6;
}

// Optional provider-backed correction path for richer spelling cleanup.
export async function normalizeWithLanguageTool(
  text: string,
  options: SpellCheckOptions = {},
): Promise<NormalizationResult> {
  if (isTextLikelyEncoded(text)) {
    return { text, changed: false, original: text, corrections: [], backend: 'languagetool' };
  }

  const url = options.languageToolUrl ?? DEFAULT_LANGUAGE_TOOL_URL;
  const language = options.language ?? DEFAULT_LANGUAGE;

  const response = await fetch(`${url}/v2/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text, language }),
  });

  if (!response.ok) {
    throw new Error(`LanguageTool error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as {
    matches: Array<{
      offset: number;
      length: number;
      replacements: Array<{ value: string }>;
    }>;
  };

  let corrected = text;
  const corrections: NormalizationCorrection[] = [];

  for (const match of [...data.matches].reverse()) {
    const originalToken = text.slice(match.offset, match.offset + match.length);
    const replacement = match.replacements[0]?.value;
    if (!replacement || isLikelyEncoded(originalToken)) continue;

    corrected =
      corrected.slice(0, match.offset) +
      replacement +
      corrected.slice(match.offset + match.length);

    corrections.push({
      original: originalToken,
      replacement,
      offset: match.offset,
    });
  }

  return {
    text: corrected,
    changed: corrected !== text,
    original: text,
    corrections: corrections.reverse(),
    backend: 'languagetool',
  };
}

// Async wrapper used by callers that want a consistent Promise-based interface.
export async function normalizeWithHeuristic(text: string): Promise<NormalizationResult> {
  return normalizeWithHeuristicSync(text);
}

// Fast local correction path used in hot code paths.
export function normalizeWithHeuristicSync(text: string): NormalizationResult {
  if (isTextLikelyEncoded(text)) {
    return { text, changed: false, original: text, corrections: [], backend: 'heuristic' };
  }

  const corrections: NormalizationCorrection[] = [];
  const corrected = text.replace(WORD_PATTERN, (token: string, offset: number) => {
    if (isLikelyEncoded(token)) return token;

    const correction = lookupCorrection(token);
    if (!correction || correction.toLowerCase() === token.toLowerCase()) return token;

    const replacement = preserveCase(token, correction);
    corrections.push({ original: token, replacement, offset });
    return replacement;
  });

  return {
    text: corrected,
    changed: corrected !== text,
    original: text,
    corrections,
    backend: 'heuristic',
  };
}

// Public entry point that chooses the requested backend.
export async function normalizeSpelling(
  text: string,
  options: SpellCheckOptions = {},
): Promise<NormalizationResult> {
  const backend = options.backend ?? 'heuristic';
  return backend === 'languagetool'
    ? normalizeWithLanguageTool(text, options)
    : normalizeWithHeuristicSync(text);
}

/**
 * Shared text-normalization helpers for the sanitizer stack.
 *
 * Reader guide:
 * 1. `normalizeWithoutLeet(...)` strips zero-width characters, lowercases text,
 *    and normalizes unicode so policy checks are less fragile.
 * 2. `normalizeForPolicy(...)` adds a lightweight leetspeak conversion layer so
 *    obvious character substitutions still match blocked terms.
 * 3. `hasLeetspeakObfuscation(...)` is a bounded heuristic used to decide whether
 *    a prompt is likely trying to hide policy-relevant text with leet substitutions.
 */
const ZERO_WIDTH_CHAR_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const COMPATIBILITY_GLYPH_REGEX = /[\u2460-\u24FF\u3200-\u32FF\uFF00-\uFFEF]/g;
const SHORT_LINE_MAX_CHARS = 3;
const MIN_VERTICAL_RUN_LINES = 4;
const POSITIONAL_ROW_REGEX = /^\s*(\S)\s*[-–—:]\s*position\s+\d+\s*$/i;
const ORDINAL_TOKEN_REGEX = /^\d+(?:st|nd|rd|th)$/i;
const DIMENSION_TOKEN_REGEX = /^\d+(?:x|by)\d+(?:x\d+)?$/i;
const CYRILLIC_CONFUSABLES: Record<string, string> = {
  а: 'a', А: 'a',
  е: 'e', Е: 'e',
  о: 'o', О: 'o',
  р: 'p', Р: 'p',
  с: 'c', С: 'c',
  у: 'y', У: 'y',
  х: 'x', Х: 'x',
  і: 'i', І: 'i',
  к: 'k', К: 'k',
  м: 'm', М: 'm',
  т: 't', Т: 't',
  в: 'b', В: 'b',
  н: 'h', Н: 'h',
};

// Baseline normalization used across language, obfuscation, and policy helpers.
export function normalizeWithoutLeet(input: string): string {
  return input.toLowerCase()
    .replace(ZERO_WIDTH_CHAR_REGEX, '')
    .normalize('NFKC');
}

export interface ReflowedPrompt {
  normalized: string;
  reflowed: string;
  hadVerticalRun: boolean;
}

function preNormalizeVerticalText(input: string): string {
  return input
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

// Reflow one-character-per-line prompt text before detector matching. This also
// supports the playground's "x - position N" rendering so submitted variants do
// not slip past horizontal phrase checks.
export function reflowVerticalText(raw: string): ReflowedPrompt {
  const normalized = preNormalizeVerticalText(raw);
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

  return {
    normalized,
    reflowed: out.join('\n'),
    hadVerticalRun,
  };
}

// Track whether compatibility/enclosed glyphs changed meaningfully after normalization.
export function hasCompatibilityGlyphObfuscation(input: string): boolean {
  return COMPATIBILITY_GLYPH_REGEX.test(input) && normalizeWithoutLeet(input) !== input.toLowerCase().replace(ZERO_WIDTH_CHAR_REGEX, '');
}

// Policy normalization adds a small leetspeak map on top of the baseline cleanup.
export function normalizeForPolicy(input: string): string {
  return normalizeWithoutLeet(input)
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

// Flag likely leetspeak obfuscation only when the prompt mixes letters with multiple
// substitution characters and the normalized result actually changes meaningfully.
export function hasLeetspeakObfuscation(input: string): boolean {
  const tokens: string[] = input.match(/\b[\w@]+\b/g) ?? [];
  const suspiciousTokens = tokens.filter((token) => {
    const replacementCount = (token.match(/[0134578@]/g) ?? []).length;
    const hasLetters = /[a-zA-Z]/.test(token);
    const hasLeetishShape = /^[a-zA-Z0-9@]+$/.test(token);
    if (ORDINAL_TOKEN_REGEX.test(token) || DIMENSION_TOKEN_REGEX.test(token)) return false;
    if (!hasLetters || !hasLeetishShape || replacementCount < 2) return false;
    return normalizeForPolicy(token) !== normalizeWithoutLeet(token);
  });

  return suspiciousTokens.length > 0;
}

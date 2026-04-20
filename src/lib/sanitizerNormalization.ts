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
const ZERO_WIDTH_CHAR_REGEX = /[\u200B-\u200D\u2060\uFEFF]/g;
const COMPATIBILITY_GLYPH_REGEX = /[\u2460-\u24FF\u3200-\u32FF\uFF00-\uFFEF]/g;
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
  const tokens = input.match(/\b[\w@]+\b/g) || [];
  const suspiciousTokens = tokens.filter((token) => {
    const replacementCount = (token.match(/[0134578@]/g) || []).length;
    const hasLetters = /[a-zA-Z]/.test(token);
    const hasLeetishShape = /^[a-zA-Z0-9@]+$/.test(token);
    if (!hasLetters || !hasLeetishShape || replacementCount < 2) return false;
    return normalizeForPolicy(token) !== normalizeWithoutLeet(token);
  });

  return suspiciousTokens.length > 0;
}

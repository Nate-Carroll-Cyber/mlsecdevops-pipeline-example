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

// Baseline normalization used across language, obfuscation, and policy helpers.
export function normalizeWithoutLeet(input: string): string {
  return input.toLowerCase()
    .replace(ZERO_WIDTH_CHAR_REGEX, '')
    .normalize('NFKC');
}

// Policy normalization adds a small leetspeak map on top of the baseline cleanup.
export function normalizeForPolicy(input: string): string {
  return normalizeWithoutLeet(input)
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/@/g, 'a');
}

// Flag likely leetspeak obfuscation only when the prompt mixes letters with multiple
// substitution characters and the normalized result actually changes meaningfully.
export function hasLeetspeakObfuscation(input: string): boolean {
  const replacementCount = (input.match(/[0134578@]/g) || []).length;
  if (replacementCount < 2 || !/[a-zA-Z]/.test(input)) return false;
  return normalizeForPolicy(input) !== normalizeWithoutLeet(input);
}

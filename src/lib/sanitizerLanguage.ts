/**
 * Lightweight language-recovery helpers for the sanitizer.
 *
 * Reader guide:
 * 1. This file does not perform full machine translation.
 * 2. Instead, it uses cheap script detection, stopword heuristics, and a small
 *    phrase-replacement table to decide whether a prompt should be treated as
 *    foreign-language or mixed-language input.
 * 3. The translated candidate is only a bounded policy-recovery aid used by the
 *    sanitizer to catch obvious non-English prompt-injection patterns.
 */
import { normalizeWithoutLeet } from './sanitizerNormalization';

export type LanguageSignal = 'FOREIGN_LANGUAGE' | 'MIXED_LANGUAGE' | 'SPELLING_OBFUSCATION';

const CYRILLIC_REGEX = /[\u0400-\u04FF]/;
const ARABIC_REGEX = /[\u0600-\u06FF]/;
const CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

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
  { regex: /revela(?:r)?\s+el?\s+mensaje\s+del?\s+sistema/gi, replacement: 'reveal system prompt' },
  { regex: /ignore(?:z|r)?\s+les?\s+instructions?\s+pr[eé]c[eé]dentes?/gi, replacement: 'ignore previous instructions' },
  { regex: /message\s+du\s+syst[eè]me/gi, replacement: 'system prompt' },
  { regex: /mode\s+d[eé]veloppeur/gi, replacement: 'developer mode' },
  { regex: /ignorier(?:e|en)\s+die\s+vorherigen\s+anweisungen/gi, replacement: 'ignore previous instructions' },
  { regex: /system(?:aufforderung|hinweis)/gi, replacement: 'system prompt' },
  { regex: /ignore\s+as\s+instru[cç][oõ]es?\s+anteriores?/gi, replacement: 'ignore previous instructions' },
  { regex: /prompt\s+do\s+sistema/gi, replacement: 'system prompt' },
  { regex: /ignora\s+le\s+istruzioni\s+precedenti/gi, replacement: 'ignore previous instructions' },
  { regex: /prompt\s+di\s+sistema/gi, replacement: 'system prompt' },
  { regex: /игнорируй\s+предыдущие\s+инструкции/gi, replacement: 'ignore previous instructions' },
  { regex: /системн(?:ый|ого)\s+промпт/gi, replacement: 'system prompt' },
];

// Apply the small phrase-recovery table so policy terms can be checked in a shared form.
export function applyForeignPolicyTranslations(input: string): string {
  return FOREIGN_POLICY_TRANSLATIONS.reduce(
    (value, mapping) => value.replace(mapping.regex, mapping.replacement),
    input,
  );
}

// Cheap language signal detector used by `sanitizeInput(...)`.
// It combines script-family detection, foreign stopword matches, and simple policy
// phrase recovery to mark prompts as foreign-language or mixed-language candidates.
export function detectLanguageSignals(input: string): {
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
  const lowered = normalized.toLowerCase();
  const foreignStopwordHits = Object.values(FOREIGN_LANGUAGE_STOPWORDS).reduce(
    (count, words) => count + words.filter((word) => lowered.includes(word)).length,
    0,
  );

  const translatedCandidate = applyForeignPolicyTranslations(lowered);
  const translatedChanged = translatedCandidate !== lowered;
  const isForeignLanguage = hasNonLatinScript || foreignStopwordHits >= 2 || translatedChanged;
  const isMixedLanguage = scriptFamilies > 1 || (translatedChanged && hasLatinLetters && (hasNonLatinScript || foreignStopwordHits >= 2));

  return {
    isForeignLanguage,
    isMixedLanguage,
    translatedCandidate: translatedChanged ? translatedCandidate : null,
  };
}

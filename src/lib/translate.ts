/**
 * Shared translation metadata for the Playground workflow.
 * Translation is backend-only through Lara and only runs when an analyst
 * explicitly triggers the language pipeline.
 */
export type TranslationProvider = 'lara';
export type TranslationMode = 'recover_to_english' | 'generate_foreign_variant';

export interface TranslationResult {
  text: string;
  original: string;
  sourceLang: string;
  targetLang: string;
  targetLangName: string;
  provider: TranslationProvider;
}

export const TRANSLATION_PROVIDER: TranslationProvider = 'lara';
export const TRANSLATION_PROVIDER_LABEL = 'Lara Translate';
export const TRANSLATION_TARGET_LANGUAGE = 'en' as const;
export const TRANSLATION_TARGET_LANGUAGE_NAME = 'English' as const;
export const ALL_LANGUAGE_KEYS = ['en', 'zh', 'ar', 'ru', 'ja', 'hi', 'ko', 'fa', 'tr', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'uk'] as const;
export const FOREIGN_LANGUAGE_KEYS = ALL_LANGUAGE_KEYS.filter((languageKey) => languageKey !== 'en');

const TARGET_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  zh: 'Chinese (Simplified)',
  ar: 'Arabic',
  ru: 'Russian',
  ja: 'Japanese',
  hi: 'Hindi',
  ko: 'Korean',
  fa: 'Persian (Farsi)',
  tr: 'Turkish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  pl: 'Polish',
  uk: 'Ukrainian',
};

export function getLanguageName(langKey: string): string {
  return TARGET_LANGUAGE_NAMES[langKey] ?? langKey;
}

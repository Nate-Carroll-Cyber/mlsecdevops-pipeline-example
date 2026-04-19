/**
 * Shared translation metadata for the Playground workflow.
 * The actual provider request goes through the backend; this module just defines
 * supported providers, default endpoints, and language-code mappings.
 */
export type TranslationProvider = 'deepl' | 'google' | 'azure';

export interface TranslationResult {
  text: string;
  original: string;
  sourceLang: string;
  targetLang: string;
  targetLangName: string;
  provider: TranslationProvider;
}

export const TRANSLATION_PROVIDERS: TranslationProvider[] = ['deepl', 'google', 'azure'];

export const TRANSLATION_PROVIDER_LABELS: Record<TranslationProvider, string> = {
  deepl: 'DeepL',
  google: 'Google Cloud Translation',
  azure: 'Azure Translator',
};

export const TRANSLATION_PROVIDER_DEFAULT_BASE_URLS: Record<TranslationProvider, string> = {
  deepl: 'https://api-free.deepl.com',
  google: 'https://translation.googleapis.com',
  azure: 'https://api.cognitive.microsofttranslator.com',
};

const TARGET_LANGUAGE_NAMES: Record<string, string> = {
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

export const SUPPORTED_LANGUAGES: Record<TranslationProvider, Record<string, string>> = {
  deepl: {
    zh: 'ZH',
    ar: 'AR',
    ru: 'RU',
    ja: 'JA',
    hi: 'HI',
    ko: 'KO',
    fa: 'FA',
    tr: 'TR',
    de: 'DE',
    fr: 'FR',
    es: 'ES',
    pt: 'PT',
    it: 'IT',
    pl: 'PL',
    uk: 'UK',
  },
  google: {
    zh: 'zh',
    ar: 'ar',
    ru: 'ru',
    ja: 'ja',
    hi: 'hi',
    ko: 'ko',
    fa: 'fa',
    tr: 'tr',
    de: 'de',
    fr: 'fr',
    es: 'es',
    pt: 'pt',
    it: 'it',
    pl: 'pl',
    uk: 'uk',
  },
  azure: {
    zh: 'zh-Hans',
    ar: 'ar',
    ru: 'ru',
    ja: 'ja',
    hi: 'hi',
    ko: 'ko',
    fa: 'fa',
    tr: 'tr',
    de: 'de',
    fr: 'fr',
    es: 'es',
    pt: 'pt',
    it: 'it',
    pl: 'pl',
    uk: 'uk',
  },
};

export const ALL_LANGUAGE_KEYS = Object.keys(TARGET_LANGUAGE_NAMES);

export const HIGH_PRIORITY_LANGUAGES = ['zh', 'ar', 'ru', 'ja', 'hi', 'ko', 'fa', 'tr'];

// Suggested default endpoint for each supported provider.
export function getDefaultTranslationBaseUrl(provider: TranslationProvider): string {
  return TRANSLATION_PROVIDER_DEFAULT_BASE_URLS[provider];
}

// Resolve the provider-specific language code from the shared app language key.
export function resolveLanguageCode(
  langKey: string,
  provider: TranslationProvider
): string {
  return SUPPORTED_LANGUAGES[provider][langKey] ?? langKey;
}

// Human-readable label used throughout the UI.
export function getLanguageName(langKey: string): string {
  return TARGET_LANGUAGE_NAMES[langKey] ?? langKey;
}

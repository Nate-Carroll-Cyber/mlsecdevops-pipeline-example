/**
 * Sanitization Layer for Counter-Spy.ai
 * Normalizes input, redacts PII/Secrets, and calculates entropy.
 *
 * Reader guide:
 * 1. `sanitizeInput(...)` is the main inbound prompt path.
 * 2. The file first defines core detection primitives:
 *    - sensitive-pattern redaction
 *    - entropy analysis
 *    - guardrail configuration
 * 3. `sanitizeInput(...)` then combines:
 *    - PII/secret detection
 *    - entropy and syntactic analysis
 *    - spelling/language recovery
 *    - obfuscation decoding and structural checks
 *    - keyword/topic/regex policy matching
 * 4. `sanitizeOutput(...)` performs the same style of governance pass on model output.
 */

// Import the syntactic complexity analyzer function from the local module
import { analyzeSyntacticComplexity } from './syntacticAnalyzer';
import { normalizeWithHeuristicSync } from './spellNormalize';
import { detectLanguageSignals } from './sanitizerLanguage';
import {
  analyzeObfuscationInput,
  extractTransformedSegments,
  type DecodeTelemetry,
  type ObfuscationSignal,
} from './sanitizerObfuscation';
import { normalizeForPolicy, normalizeWithoutLeet } from './sanitizerNormalization';

// Define an array of sensitive patterns (Regex) to detect and redact PII and secrets
const SENSITIVE_PATTERNS = [
  // Regex to match standard email addresses
  { name: 'EMAIL', regex: /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g },
  // Regex to match various phone number formats
  { name: 'PHONE', regex: /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  // Regex to match US street addresses and states
  { name: 'ADDRESS', regex: /\b\d{1,5}\s+[\w\s]{1,30}(?:street|st|avenue|ave|road|rd|highway|hwy|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|circle|cir)\b\.?(?:\s*(?:apt|apartment|suite|ste|unit|#)\s*\w+)?\s*,?\s*(?:[\w\s]+,\s*)?(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)?\s*\d{5}(?:-\d{4})?\b/gi },
  // Regex to match US ZIP codes
  { name: 'ZIPCODE', regex: /\b\d{5}(?:-\d{4})?\b/g },
  // Regex to match MAC addresses
  { name: 'MAC_ADDRESS', regex: /\b([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})\b/g },
  // Regex to match AWS Access Keys
  { name: 'AWS_KEY', regex: /AKIA[0-9A-Z]{16}/g },
  // Regex to match RSA Private Keys
  { name: 'PRIVATE_KEY', regex: /-----BEGIN (RSA )?PRIVATE KEY-----/g },
  // Regex to match IPv4 addresses
  { name: 'IP_ADDRESS', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // Regex to match Credit Card numbers
  { name: 'CREDIT_CARD', regex: /\b(?:\d[ -]*?){13,16}\b/g },
  // Regex to match US Social Security Numbers
  { name: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Regex to match generic 32-64 character hex API keys
  { name: 'API_KEY', regex: /\b[0-9a-fA-F]{32,64}\b/g },
  // Regex to match JSON Web Tokens (JWT)
  { name: 'JWT', regex: /\beyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g },
  // Regex to match the specific Counter-Spy Canary Token
  { name: 'CANARY_TOKEN', regex: /COUNTERSPY_CANARY_TOKEN_[0-9a-fA-F-]{36}/g },
  // Regex to match generic secret keys or passwords assignments
  { name: 'SECRET_KEY', regex: /(?:secret[-_]?key|password|passwd|api[-_]?key|token)(?:\s+is\s+|\s*[:=]\s*)([^\s]+)/gi }
];
const REDACTED_PLACEHOLDER_REGEX = /\[REDACTED_([A-Z_]+)\]/g;
const EXTERNAL_CALL_REGEX = /(?:!\[[^\]]*\]\((https?:\/\/[^\s)]+)\))|(?:\b(?:browse|open|visit|fetch|call|request|load|download)\b[\s\S]{0,80}https?:\/\/[^\s)]+)/i;
const COORDINATE_CIPHER_REGEX = /(?:\(\d{1,2},\d{1,2}\)\s*){3,}/;
export const SUSPICIOUS_ENTROPY_THRESHOLD = 3.6;
const SCRIPT_TAG_REGEX = /<script\b[^>]*(?:>[\s\S]*?<\/script>|\s*\/?>)/gi;
const URL_WITH_SCHEME_REGEX = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;
const JAVASCRIPT_URI_REGEX = /\bjavascript:[^\s<>"']*/gi;
const ENGLISH_TRIGRAMS = new Set([
  'the', 'and', 'ing', 'ion', 'tio', 'ent', 'ati', 'for', 'her', 'tha', 'nth',
  'int', 'ere', 'ter', 'est', 'ers', 'hat', 'ate', 'all', 'eth', 'his', 'ver',
  'wit', 'thi', 'oth', 'res', 'ont', 'rea', 'eve', 'not', 'you', 'are', 'was',
  'but', 'use', 'our', 'out', 'str', 'sys', 'pro', 'req', 'sen', 'sho', 'con',
  'ple', 'ase', 'msg', 'ing', 'ide', 'com', 'sec', 'pol', 'tri', 'ans', 'tim',
  'lat', 'gue', 'que', 'log', 'red', 'act', 'exp', 'ect', 'tra', 'ate', 'rom',
]);

// Enum defining the severity levels of detected threats
export enum DetectionLevel {
  // Level 0: No threats detected
  CLEAN = 0,
  // Level 1: Minor issues or PII detected but not malicious
  INFORMATIONAL = 1,
  // Level 2: Potentially malicious or policy-violating input
  SUSPICIOUS = 2,
  // Level 3: Highly malicious or adversarial input
  ADVERSARIAL = 3
}

// Interface defining the structure of the sanitization result
export interface SanitizationResult {
  // The original unmodified input string
  original: string;
  // The sanitized input string with PII/secrets redacted
  sanitized: string;
  // Array of redaction types applied (e.g., ['EMAIL', 'AWS_KEY'])
  redactions: string[];
  // The maximum entropy score found in the input
  entropy: number;
  // The overall entropy score of the entire input
  globalEntropy: number;
  // Array of text chunks that exceeded the active entropy analysis threshold
  suspiciousChunks: string[];
  // Boolean flag indicating if the input is potentially adversarial
  isPotentiallyAdversarial: boolean;
  // The calculated severity level of the input
  detectionLevel: DetectionLevel;
  // The time taken to perform the sanitization in milliseconds
  latencyMs: number;
  // The calculated syntactic complexity score
  syntacticScore: number;
  // Indicates whether a policy hit came from plain text or decoded content
  decodeTelemetry: 'plain_text' | 'single_hop_decode' | 'recursive_decode';
}

/**
 * Calculates Shannon entropy of a string to detect high-entropy payloads (obfuscation)
 */
// Function to calculate the Shannon entropy of a given string
function calculateEntropy(str: string): number {
  // Get the length of the string
  const len = str.length;
  // If the string is empty, its entropy is 0
  if (len === 0) return 0;
  // Initialize a dictionary to count character frequencies
  const frequencies: Record<string, number> = {};
  // Iterate over each character in the string
  for (const char of str) {
    // Increment the count for the character, defaulting to 0 if not seen before
    frequencies[char] = (frequencies[char] || 0) + 1;
  }
  // Calculate the entropy using the Shannon entropy formula
  return Object.values(frequencies).reduce((sum, freq) => {
    // Calculate the probability of the character
    const p = freq / len;
    // Subtract the probability multiplied by its base-2 logarithm from the sum
    return sum - p * Math.log2(p);
  // Start the sum at 0
  }, 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactPolicyMatchedContent(
  input: string,
  blockedKeywordsList: string[],
  options: {
    containsBlockedKeyword: boolean;
    externalCallDetected: boolean;
  },
): string {
  let next = input;

  if (options.containsBlockedKeyword || options.externalCallDetected) {
    next = next.replace(SCRIPT_TAG_REGEX, '[REDACTED_SCRIPT_TAG]');
  }

  const normalizedKeywords = blockedKeywordsList
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  const shouldRedactUrls = options.externalCallDetected || normalizedKeywords.includes('://');
  const shouldRedactJavascriptUris = normalizedKeywords.includes('javascript:');

  if (shouldRedactUrls) {
    next = next.replace(URL_WITH_SCHEME_REGEX, '[REDACTED_URL]');
  }

  if (shouldRedactJavascriptUris) {
    next = next.replace(JAVASCRIPT_URI_REGEX, '[REDACTED_JAVASCRIPT_URI]');
  }

  if (options.containsBlockedKeyword) {
    for (const keyword of blockedKeywordsList) {
      const normalizedKeyword = keyword.trim();
      if (!normalizedKeyword) continue;
      next = next.replace(
        new RegExp(escapeRegExp(normalizedKeyword), 'gi'),
        '[REDACTED_BLOCKED_KEYWORD]',
      );
    }
  }

  return next;
}

// Shannon entropy alone underestimates many symbol-substitution attacks because
// they can use a tiny symbol alphabet or repeated combining marks. We add a
// bounded risk boost so the displayed entropy reflects concealment pressure as
// well as pure character diversity.
function calculateEntropyRiskBoost(str: string): number {
  const meaningfulChars = [...str].filter((char) => !/\s/.test(char));
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

function calculateEntropyLanguagePenalty(str: string): number {
  const chars = [...str];
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

function normalizeForEnglishLikelihood(input: string): string {
  const normalized = normalizeWithoutLeet(input)
    .replace(REDACTED_PLACEHOLDER_REGEX, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

function getEnglishTrigramHitRate(input: string): number {
  const lettersOnly = input.replace(/\s+/g, '');
  if (lettersOnly.length < 12) return 0;

  let total = 0;
  let hits = 0;
  for (let index = 0; index <= lettersOnly.length - 3; index += 1) {
    total += 1;
    if (ENGLISH_TRIGRAMS.has(lettersOnly.slice(index, index + 3))) {
      hits += 1;
    }
  }

  return total > 0 ? hits / total : 0;
}

function shiftCaesarText(input: string, shift: number): string {
  return [...input].map((char) => {
    if (!/[a-z]/.test(char)) return char;
    const base = 'a'.charCodeAt(0);
    const normalized = char.charCodeAt(0) - base;
    return String.fromCharCode(((normalized - shift + 26) % 26) + base);
  }).join('');
}

// Detect alphabetic gibberish that still looks like spaced prose by comparing
// normalized character trigrams and bounded Caesar-shift recovery. This is used
// as an obfuscation-family signal, not as a generic "bad writing" detector.
function hasLowNaturalLanguageLikelihood(input: string): boolean {
  const normalized = normalizeForEnglishLikelihood(input);

  if (!normalized) return false;

  const tokens = normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  if (tokens.length < 5) return false;

  const vowelishTokens = tokens.filter((token) => /[aeiouy]/.test(token));
  if (vowelishTokens.length / tokens.length < 0.7) return false;

  const uniqueTokenRate = new Set(tokens).size / tokens.length;
  const averageTokenLength = tokens.reduce((sum, token) => sum + token.length, 0) / tokens.length;
  const originalTrigramRate = getEnglishTrigramHitRate(normalized);

  let bestShiftRate = 0;
  for (let shift = 1; shift < 26; shift += 1) {
    bestShiftRate = Math.max(bestShiftRate, getEnglishTrigramHitRate(shiftCaesarText(normalized, shift)));
  }

  return uniqueTokenRate >= 0.75 &&
    averageTokenLength >= 4.2 &&
    (
      (originalTrigramRate <= 0.035 && bestShiftRate >= 0.16 && bestShiftRate - originalTrigramRate >= 0.08) ||
      (originalTrigramRate <= 0.015 && tokens.length >= 7)
    );
}

// Entropy should measure concealment pressure, not reward predictable wrapper
// shells like `[INSTRUCTION: ...]` or `<SYSTEM_MESSAGE_STYLE>`. We normalize
// those structured headers out before scoring so templated clean prompts land
// closer to their actual prose content before the shared 3.6 / configurable
// threshold policy bands are applied.
function normalizeForEntropy(str: string): string {
  const unescaped = str
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

// This helper still shapes the displayed max-window entropy by dampening obvious
// plain-prose inputs, but it no longer decides whether entropy can escalate on
// its own. The actual verdict policy now uses fixed bands: <= 3.6 allowed on
// entropy grounds, > 3.6 suspicious, and > configured threshold adversarial.
function hasEntropyEscalationContext(str: string): boolean {
  const meaningfulChars = [...str].filter((char) => !/\s/.test(char));
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

// Interface defining the result of the sliding window entropy analysis
export interface EntropyAnalysisResult {
  // Boolean flag indicating if the entropy exceeds the supplied analysis threshold
  isAdversarial: boolean;
  // The maximum entropy score found in any window
  maxEntropy: number;
  // The overall entropy score of the entire input
  globalEntropy: number;
  // Array of text chunks that exceeded the active entropy analysis threshold
  suspiciousChunks: string[];
}

// Function to analyze entropy using a sliding window approach
export function analyzeSlidingWindowEntropy(
  // The input string to analyze
  prompt: string,
  // The size of the sliding window in characters (default 35)
  windowSize: number = 35,
  // The number of characters to advance the window each step (default 5)
  stepSize: number = 5,
  // The threshold above which a chunk is recorded as suspicious for telemetry
  threshold: number = SUSPICIOUS_ENTROPY_THRESHOLD
): EntropyAnalysisResult {
  const entropyInput = normalizeForEntropy(prompt);
  // Calculate the global entropy of the entire prompt
  const globalEntropy = calculateEntropy(entropyInput);
  const boostedGlobalEntropy = Math.max(
    0,
    globalEntropy + calculateEntropyRiskBoost(entropyInput) - calculateEntropyLanguagePenalty(entropyInput),
  );
  // Initialize the maximum entropy found to 0
  let maxEntropy = 0;
  // Initialize an array to store suspicious chunks
  const suspiciousChunks: string[] = [];

  // If the prompt is shorter than or equal to the window size
  if (entropyInput.length <= windowSize) {
    // The maximum entropy is just the global entropy
    maxEntropy = boostedGlobalEntropy;
    // If the global entropy exceeds the threshold, add the whole prompt to suspicious chunks
    if (boostedGlobalEntropy >= threshold) suspiciousChunks.push(entropyInput);
  } else {
    // Otherwise, slide the window across the prompt
    for (let i = 0; i <= entropyInput.length - windowSize; i += stepSize) {
      // Extract the text for the current window
      const windowText = entropyInput.substring(i, i + windowSize);
      // Calculate the entropy of the current window
      const windowEntropy = Math.max(
        0,
        calculateEntropy(windowText) + calculateEntropyRiskBoost(windowText) - calculateEntropyLanguagePenalty(windowText),
      );
      
      // If the current window's entropy is higher than the max found so far
      if (windowEntropy > maxEntropy) {
        // Update the maximum entropy
        maxEntropy = windowEntropy;
      }

      // If the current window's entropy exceeds the threshold
      if (windowEntropy >= threshold) {
        // Add the window text to the suspicious chunks array
        suspiciousChunks.push(windowText);
      }
    }
  }

  // Keep a mild cap for clearly prose-like text so the displayed max window
  // entropy stays readable in the UI even when wrapper noise inflates a chunk.
  if (!hasEntropyEscalationContext(entropyInput)) {
    maxEntropy = Math.min(maxEntropy, boostedGlobalEntropy + 0.6);
  }

  // Return the analysis results
  return {
    // Flag that the score crossed the supplied analysis threshold
    isAdversarial: maxEntropy >= threshold,
    // Return the maximum entropy found
    maxEntropy,
    // Return the global entropy
    globalEntropy: boostedGlobalEntropy,
    // Return the unique suspicious chunks (removing duplicates)
    suspiciousChunks: [...new Set(suspiciousChunks)],
  };
}

// Interface defining which guardrails are currently active
export interface ActiveGuardrails {
  // Flag to enable/disable PII redaction
  piiRedaction: boolean;
  // Flag to enable/disable entropy filtering
  entropyFilter: boolean;
  // Flag to enable/disable obfuscation decoding and structural concealment checks
  obfuscationDetection: boolean;
  // Flag to enable/disable session auditing
  sessionAudit: boolean;
  // Flag to enable/disable blocked keywords filtering
  blockedKeywords: boolean;
  // Flag to enable/disable forbidden topics filtering
  blockedTopics: boolean;
  // Flag to enable/disable regex rules filtering
  regexRules: boolean;
}

export interface SanitizationTuning {
  entropyThreshold?: number;
  syntacticThreshold?: number;
}

// Main inbound firewall routine.
// This is the function the frontend uses to decide whether a prompt is clean,
// informational, suspicious, or adversarial before it moves farther downstream.
export function sanitizeInput(
  // The raw input string from the user
  input: string, 
  // Optional list of custom blocked keywords
  blockedKeywordsList: string[] = [],
  // Optional list of custom forbidden topics
  forbiddenTopicsList: string[] = [],
  // Optional list of custom regex rules
  regexRulesList: string[] = [],
  // Configuration object for active guardrails (defaults to all enabled)
  guardrails: ActiveGuardrails = {
    piiRedaction: true,
    entropyFilter: true,
    obfuscationDetection: true,
    sessionAudit: true,
    blockedKeywords: true,
    blockedTopics: true,
    regexRules: true
  },
  tuning: SanitizationTuning = {}
): SanitizationResult {
  // Record the start time to measure latency
  const startTime = performance.now();
  // Initialize the sanitized string with the original input
  let sanitized = input;
  // Initialize an array to track applied redactions
  const redactions: string[] = [];
  const adversarialEntropyThreshold = Math.max(
    tuning.entropyThreshold ?? 4.0,
    SUSPICIOUS_ENTROPY_THRESHOLD,
  );
  const suspiciousSyntacticThreshold = tuning.syntacticThreshold ?? 65;

  // Always detect PII for metadata/governance, but conditionally redact the string
  // Iterate over each sensitive pattern defined earlier
  for (const pattern of SENSITIVE_PATTERNS) {
    // Check if the input matches the current pattern
    const matches = input.match(pattern.regex);
    // If there are matches
    if (matches) {
      // Add the pattern name to the redactions list if not already present
      if (!redactions.includes(pattern.name)) redactions.push(pattern.name);
      // If PII redaction is enabled in the guardrails
      if (guardrails.piiRedaction) {
        // Replace all occurrences of the pattern with a redaction placeholder
        sanitized = sanitized.replace(pattern.regex, `[REDACTED_${pattern.name}]`);
      }
    }
  }

  // Preserve already-redacted placeholders as sensitive signals so imported or
  // replayed examples still register as containing protected material.
  for (const match of input.matchAll(REDACTED_PLACEHOLDER_REGEX)) {
    const placeholderName = match[1];
    if (placeholderName && !redactions.includes(placeholderName)) {
      redactions.push(placeholderName);
    }
  }

  // Initialize entropy variables
  let entropy = 0;
  let globalEntropy = 0;
  let suspiciousChunks: string[] = [];

  // If the entropy filter guardrail is enabled
  if (guardrails.entropyFilter) {
    // Perform sliding window entropy analysis
    const entropyResult = analyzeSlidingWindowEntropy(input, 35, 5, SUSPICIOUS_ENTROPY_THRESHOLD);
    // Store the maximum entropy found
    entropy = entropyResult.maxEntropy;
    // Store the global entropy
    globalEntropy = entropyResult.globalEntropy;
    // Store the suspicious chunks
    suspiciousChunks = entropyResult.suspiciousChunks;
  }
  // These flags track which policy families fired as we combine multiple detection passes.
  let containsBlockedKeyword = false;
  let containsForbiddenTopic = false;
  let spellingObfuscationDetected = false;
  let foreignLanguageDetected = false;
  let mixedLanguageDetected = false;
  let externalCallDetected = false;
  let coordinateCipherDetected = false;

  // Recovery/normalization stage:
  // - normalize direct text for policy checks
  // - attempt lightweight spelling recovery
  // - analyze obfuscation and decoded content
  // - detect foreign-language or mixed-language signals
  const normalized = normalizeForPolicy(input);
  const spellingNormalization = normalizeWithHeuristicSync(input);
  const normalizedSpellCorrected = normalizeForPolicy(spellingNormalization.text);
  const obfuscationAnalysis = analyzeObfuscationInput(input, guardrails.obfuscationDetection);
  const { structuralSignals, leetspeakDetected, normalizedDecodedSegments } = obfuscationAnalysis;
  const languageSignals = detectLanguageSignals(input);
  foreignLanguageDetected = languageSignals.isForeignLanguage;
  mixedLanguageDetected = languageSignals.isMixedLanguage;
  const lowNaturalLanguageLikelihoodDetected =
    hasLowNaturalLanguageLikelihood(input) &&
    !foreignLanguageDetected &&
    !mixedLanguageDetected;
  const normalizedForeignRecovery = languageSignals.translatedCandidate ? normalizeForPolicy(languageSignals.translatedCandidate) : '';
  let transformedSignalsUsed: ObfuscationSignal[] = [];
  let normalizedTransformedSegments: string[] = [];
  let decodeTelemetry = obfuscationAnalysis.decodeTelemetry;
  let keywordsToCheck: string[] = [];

  // Policy matching stage: blocked keywords.
  // We check the original normalized text, spelling-recovered text, translated
  // candidate text, and decoded/structural transforms when enabled.
  if (guardrails.blockedKeywords) {
    // Default hardcoded keywords if none provided, otherwise use provided
    // Determine which list of keywords to check against
    keywordsToCheck = blockedKeywordsList.length > 0 
      ? blockedKeywordsList 
      : [
          'ignore all previous instructions',
          'system prompt',
          'ignore instructions',
          'disregard previous',
          'developer mode',
          'prompt injection',
          'acting as',
          'roleplay',
          'roleplaying',
          'pretend',
          'hypothetical',
          'unrestricted',
          'stay in character',
          'jailbreak',
          'dan',
          'do anything now',
          'assistant is now',
          'you are now'
        ];

    const keywordMatchedOriginally = keywordsToCheck.some((keyword) => {
      const loweredKeyword = keyword.toLowerCase();
      return normalized.includes(loweredKeyword) ||
        normalizedDecodedSegments.some((segment) => segment.includes(loweredKeyword));
    });

    const keywordMatchedAfterSpelling = spellingNormalization.changed && keywordsToCheck.some((keyword) =>
      normalizedSpellCorrected.includes(keyword.toLowerCase())
    );

    const keywordMatchedAfterForeignRecovery = normalizedForeignRecovery
      ? keywordsToCheck.some((keyword) => normalizedForeignRecovery.includes(keyword.toLowerCase()))
      : false;

    // Check if the normalized input contains any of the blocked keywords
    containsBlockedKeyword = keywordMatchedOriginally || keywordMatchedAfterSpelling || keywordMatchedAfterForeignRecovery;
    if (keywordMatchedAfterSpelling && !keywordMatchedOriginally) spellingObfuscationDetected = true;

    if (!containsBlockedKeyword && guardrails.obfuscationDetection) {
      const rawTransformedAnalysis = extractTransformedSegments(input);
      const decodedTransformedAnalysis = {
        segments: obfuscationAnalysis.decodedSegments.flatMap((segment) => extractTransformedSegments(segment).segments),
        signals: obfuscationAnalysis.decodedSegments.flatMap((segment) => extractTransformedSegments(segment).signals),
      };
      transformedSignalsUsed = [...rawTransformedAnalysis.signals, ...decodedTransformedAnalysis.signals];
      normalizedTransformedSegments = [
        ...rawTransformedAnalysis.segments,
        ...decodedTransformedAnalysis.segments,
      ].map((segment) => normalizeForPolicy(segment));
      containsBlockedKeyword = keywordsToCheck.some((keyword) => {
        const loweredKeyword = keyword.toLowerCase();
        return normalizedTransformedSegments.some((segment) => segment.includes(loweredKeyword));
      });
      if (containsBlockedKeyword && obfuscationAnalysis.usedObfuscation && decodedTransformedAnalysis.segments.length > 0) {
        decodeTelemetry = 'recursive_decode';
      }
    }

    if (containsBlockedKeyword && obfuscationAnalysis.usedObfuscation && !redactions.includes('OBFUSCATED_INSTRUCTION')) {
      redactions.push('OBFUSCATED_INSTRUCTION');
    }

    if (containsBlockedKeyword && decodeTelemetry === 'recursive_decode' && !redactions.includes('RECURSIVE_DECODE')) {
      redactions.push('RECURSIVE_DECODE');
    }

    if (containsBlockedKeyword && !redactions.includes('BLOCKED_KEYWORD')) {
      redactions.push('BLOCKED_KEYWORD');
    }
  }

  for (const signal of obfuscationAnalysis.signals) {
    if (!redactions.includes(signal)) redactions.push(signal);
  }
  for (const signal of transformedSignalsUsed.filter((value) => value === 'COMPATIBILITY_GLYPHS')) {
    if (!redactions.includes(signal)) redactions.push(signal);
  }
  if (containsBlockedKeyword) {
    for (const signal of transformedSignalsUsed) {
      if (!redactions.includes(signal)) redactions.push(signal);
    }
  }

  // Policy matching stage: forbidden topics.
  if (guardrails.blockedTopics) {
    const topicMatchedOriginally = forbiddenTopicsList.some(topic => 
      topic.trim() !== '' && (
        normalized.includes(topic.toLowerCase()) ||
        normalizedDecodedSegments.some((segment) => segment.includes(topic.toLowerCase())) ||
        normalizedTransformedSegments.some((segment) => segment.includes(topic.toLowerCase()))
      )
    );
    const topicMatchedAfterSpelling = spellingNormalization.changed && forbiddenTopicsList.some((topic) =>
      topic.trim() !== '' && normalizedSpellCorrected.includes(topic.toLowerCase())
    );
    const topicMatchedAfterForeignRecovery = normalizedForeignRecovery
      ? forbiddenTopicsList.some((topic) => topic.trim() !== '' && normalizedForeignRecovery.includes(topic.toLowerCase()))
      : false;

    // Check if the normalized input contains any of the forbidden topics
    containsForbiddenTopic = topicMatchedOriginally || topicMatchedAfterSpelling || topicMatchedAfterForeignRecovery;

    if (topicMatchedAfterSpelling && !topicMatchedOriginally) spellingObfuscationDetected = true;

    if (containsForbiddenTopic && !redactions.includes('FORBIDDEN_TOPIC')) {
      redactions.push('FORBIDDEN_TOPIC');
    }
  }

  for (const signal of structuralSignals) {
    if (!redactions.includes(signal)) redactions.push(signal);
  }
  if (leetspeakDetected && !redactions.includes('LEETSPEAK')) {
    redactions.push('LEETSPEAK');
  }
  if (foreignLanguageDetected && !redactions.includes('FOREIGN_LANGUAGE')) {
    redactions.push('FOREIGN_LANGUAGE');
  }
  if (mixedLanguageDetected && !redactions.includes('MIXED_LANGUAGE')) {
    redactions.push('MIXED_LANGUAGE');
  }
  if (spellingObfuscationDetected && !redactions.includes('SPELLING_OBFUSCATION')) {
    redactions.push('SPELLING_OBFUSCATION');
  }
  if (lowNaturalLanguageLikelihoodDetected && !redactions.includes('LOW_DICTIONARY_HIT_RATE')) {
    redactions.push('LOW_DICTIONARY_HIT_RATE');
  }

  if (EXTERNAL_CALL_REGEX.test(input)) {
    externalCallDetected = true;
    if (!redactions.includes('EXTERNAL_CALL_ATTEMPT')) redactions.push('EXTERNAL_CALL_ATTEMPT');
  }
  if (COORDINATE_CIPHER_REGEX.test(input)) {
    coordinateCipherDetected = true;
    if (!redactions.includes('COORDINATE_CIPHER')) redactions.push('COORDINATE_CIPHER');
  }

  sanitized = redactPolicyMatchedContent(sanitized, keywordsToCheck, {
    containsBlockedKeyword,
    externalCallDetected,
  });

  // Policy matching stage: custom regex rules from system configuration.
  let containsRegexMatch = false;
  // If the regex rules guardrail is enabled
  if (guardrails.regexRules) {
    // Iterate over each custom regex rule
    for (const rule of regexRulesList) {
      // Skip empty rules
      if (!rule.trim()) continue;
      try {
        // Handle both /regex/flags and raw regex strings
        // Initialize pattern with the raw rule string
        let pattern = rule;
        // Initialize default flags to global and case-insensitive
        let flags = 'gi';
        // If the rule is formatted as /pattern/flags
        if (rule.startsWith('/') && rule.lastIndexOf('/') > 0) {
          // Extract the pattern part
          pattern = rule.substring(1, rule.lastIndexOf('/'));
          // Extract the flags part, defaulting to 'gi' if none provided
          flags = rule.substring(rule.lastIndexOf('/') + 1) || 'gi';
        }
        // Create a new RegExp object with the pattern and flags
        const regex = new RegExp(pattern, flags);
        // If the regex matches the original input
        if (regex.test(input)) {
          // Set the regex match flag to true
          containsRegexMatch = true;
          // Add 'REGEX_MATCH' to the redactions list if not already present
          if (!redactions.includes('REGEX_MATCH')) redactions.push('REGEX_MATCH');
          // Stop checking further rules since we found a match
          break;
        }
      } catch (e) {
        // Log an error if the regex rule is invalid
        console.error("Invalid regex rule:", rule, e);
      }
    }
  }

  if ((containsBlockedKeyword || containsForbiddenTopic || containsRegexMatch) && !redactions.includes('POLICY_VIOLATION')) {
    redactions.push('POLICY_VIOLATION');
  }

  const obfuscationSignalDetected =
    obfuscationAnalysis.usedObfuscation ||
    obfuscationAnalysis.signals.length > 0 ||
    structuralSignals.length > 0 ||
    leetspeakDetected ||
    spellingObfuscationDetected ||
    transformedSignalsUsed.length > 0 ||
    lowNaturalLanguageLikelihoodDetected;

  // Complexity analysis runs after the earlier normalization stages so the final
  // severity can reflect both structural suspicion and explicit policy hits.
  const syntacticAnalysis = analyzeSyntacticComplexity(input, suspiciousSyntacticThreshold);

  // High-level escalation heuristic used for the rest of the app UI and logging.
  // Entropy alone now participates directly: > 3.6 is suspicious, and above the
  // configured entropy threshold is adversarial.
  const isPotentiallyAdversarial = 
    // Check if entropy filter is on and entropy exceeds the suspicious floor
    (guardrails.entropyFilter && entropy > SUSPICIOUS_ENTROPY_THRESHOLD) ||
    // Check if any recognized obfuscation family fired
    obfuscationSignalDetected ||
    // Check if a blocked keyword was found
    containsBlockedKeyword ||
    // Check if a forbidden topic was found
    containsForbiddenTopic ||
    // Check if a custom regex rule was matched
    containsRegexMatch ||
    externalCallDetected ||
    coordinateCipherDetected ||
    lowNaturalLanguageLikelihoodDetected ||
    // Check if the syntactic analyzer detected a probing attempt
    syntacticAnalysis.isProbingAttempt ||
    // Check if the input is excessively long (over 2000 characters)
    input.length > 2000;

  // Final severity assignment:
  // the app collapses many underlying signals into one operator-facing level.
  let detectionLevel = DetectionLevel.CLEAN;
  // Promote to adversarial if entropy exceeds the configured ceiling, if
  // syntactic score is extremely high, or if any recognized obfuscation family fires.
  if ((guardrails.entropyFilter && entropy > adversarialEntropyThreshold) || syntacticAnalysis.score >= 90 || obfuscationSignalDetected) {
    // Escalate to ADVERSARIAL level
    detectionLevel = DetectionLevel.ADVERSARIAL;
  // Else if a probing attempt was detected
  } else if (syntacticAnalysis.isProbingAttempt) {
    // Escalate to SUSPICIOUS level
    detectionLevel = DetectionLevel.SUSPICIOUS;
  // Else if blocked content, moderate entropy, or other supporting risk signals are detected
  } else if (
    containsBlockedKeyword ||
    containsForbiddenTopic ||
    externalCallDetected ||
    coordinateCipherDetected ||
    lowNaturalLanguageLikelihoodDetected ||
    (guardrails.entropyFilter && entropy > SUSPICIOUS_ENTROPY_THRESHOLD) ||
    input.length > 2000
  ) {
    // Escalate to SUSPICIOUS level
    detectionLevel = DetectionLevel.SUSPICIOUS;
  // Else if a custom regex rule was matched
  } else if (containsRegexMatch) {
    // Escalate to SUSPICIOUS level
    detectionLevel = DetectionLevel.SUSPICIOUS;
  } else if (foreignLanguageDetected || spellingObfuscationDetected) {
    detectionLevel = DetectionLevel.INFORMATIONAL;
  // Else if any redactions were applied (e.g., PII found)
  } else if (redactions.length > 0) {
    // Escalate to INFORMATIONAL level
    detectionLevel = DetectionLevel.INFORMATIONAL;
  }

  // Record the end time of the sanitization process
  const endTime = performance.now();
  // Calculate the latency in milliseconds and format to 2 decimal places
  const latencyMs = parseFloat((endTime - startTime).toFixed(2));

  // Return the comprehensive sanitization result object
  return {
    original: input,
    sanitized,
    redactions,
    entropy,
    globalEntropy,
    suspiciousChunks,
    isPotentiallyAdversarial,
    detectionLevel,
    latencyMs,
    syntacticScore: syntacticAnalysis.score,
    decodeTelemetry,
  };
}

// Interface defining the result of output sanitization
export interface OutputSanitizationResult {
  // The sanitized output string
  sanitized: string;
  // Flag indicating if the output triggered an escalation beyond passive redaction.
  triggeredEscalation: boolean;
  // Array of redaction types applied
  redactions: string[];
  // Indicates whether a policy hit came from plain text or decoded content
  decodeTelemetry: 'plain_text' | 'single_hop_decode' | 'recursive_decode';
}

function containsBlockedTerm(
  term: string,
  normalizedText: string,
  normalizedDecodedSegments: string[],
  normalizedTransformedSegments: string[] = [],
): boolean {
  const loweredTerm = term.toLowerCase();
  return normalizedText.includes(loweredTerm) ||
    normalizedDecodedSegments.some((segment) => segment.includes(loweredTerm)) ||
    normalizedTransformedSegments.some((segment) => segment.includes(loweredTerm));
}

// Output-side governance pass.
// This is intentionally similar to `sanitizeInput(...)`, but scoped to model output
// so leaked secrets, blocked topics, or recovered obfuscated terms can still be caught.
export function sanitizeOutput(
  // The raw output string from the LLM
  output: string,
  // Optional list of custom blocked keywords
  blockedKeywordsList: string[] = [],
  // Optional list of custom forbidden topics
  forbiddenTopicsList: string[] = [],
  // Configuration object for active guardrails
  guardrails: ActiveGuardrails = {
    piiRedaction: true,
    entropyFilter: true,
    obfuscationDetection: true,
    sessionAudit: true,
    blockedKeywords: true,
    blockedTopics: true,
    regexRules: true
  }
): OutputSanitizationResult {
  // Initialize the sanitized string with the original output
  let sanitized = output;
  // Initialize the escalation flag to false
  let triggeredEscalation = false;
  // Initialize an array to track applied redactions
  const redactions: string[] = [];
  const normalizedOutput = normalizeForPolicy(output);
  const obfuscationAnalysis = analyzeObfuscationInput(output, guardrails.obfuscationDetection);
  const { structuralSignals, leetspeakDetected, normalizedDecodedSegments } = obfuscationAnalysis;
  let transformedSignalsUsed: ObfuscationSignal[] = [];
  let normalizedTransformedSegments: string[] = [];
  let decodeTelemetry = obfuscationAnalysis.decodeTelemetry;

  // Always check for PII to potentially trigger escalation, but conditionally redact
  // Iterate over each sensitive pattern
  for (const pattern of SENSITIVE_PATTERNS) {
    // If the output matches the pattern
    if (pattern.regex.test(output)) {
      // Add the pattern name to the redactions list if not already present
      if (!redactions.includes(pattern.name)) redactions.push(pattern.name);
      // If PII redaction is enabled
      if (guardrails.piiRedaction) {
        // Replace all occurrences of the pattern with a redaction placeholder
        sanitized = sanitized.replace(pattern.regex, `[REDACTED_${pattern.name}]`);
      }
    }
  }

  // Determine which keywords to check based on guardrails and provided lists
  const keywordsToCheck = guardrails.blockedKeywords 
    // If blocked keywords are enabled, use the provided list or the default list
    ? (blockedKeywordsList.length > 0 ? blockedKeywordsList : [
        'ignore all previous instructions',
        'system prompt',
        'ignore instructions',
        'disregard previous',
        'developer mode',
        'prompt injection',
        'acting as',
        'roleplay',
        'roleplaying',
        'pretend',
        'hypothetical',
        'unrestricted',
        'stay in character',
        'jailbreak',
        'dan',
        'do anything now',
        'assistant is now',
        'you are now'
      ])
    // If blocked keywords are disabled, check an empty list
    : [];

  // Determine which topics to check based on guardrails
  const topicsToCheck = guardrails.blockedTopics ? forbiddenTopicsList : [];

  // Combine keywords and topics into a single array to check
  const allBlocked = [...keywordsToCheck, ...topicsToCheck];

  // If there are any blocked terms to check
  if (allBlocked.length > 0) {
    // Iterate over each blocked term
    for (const keyword of allBlocked) {
      // Skip empty terms
      if (!keyword.trim()) continue;
      // Escape keyword for regex to avoid errors with special characters
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Create a global, case-insensitive regex for the escaped keyword
      const regex = new RegExp(escapedKeyword, 'gi');
      // If the sanitized output contains the blocked term
      const directHit = regex.test(sanitized) || containsBlockedTerm(keyword, normalizedOutput, normalizedDecodedSegments);
      if (!directHit && guardrails.obfuscationDetection) {
        const rawTransformedAnalysis = extractTransformedSegments(output);
        const decodedTransformedAnalysis = {
          segments: obfuscationAnalysis.decodedSegments.flatMap((segment) => extractTransformedSegments(segment).segments),
          signals: obfuscationAnalysis.decodedSegments.flatMap((segment) => extractTransformedSegments(segment).signals),
        };
        transformedSignalsUsed = [...rawTransformedAnalysis.signals, ...decodedTransformedAnalysis.signals];
        normalizedTransformedSegments = [
          ...rawTransformedAnalysis.segments,
          ...decodedTransformedAnalysis.segments,
        ].map((segment) => normalizeForPolicy(segment));
        if (containsBlockedTerm(keyword, normalizedOutput, normalizedDecodedSegments, normalizedTransformedSegments)) {
          if (obfuscationAnalysis.usedObfuscation && decodedTransformedAnalysis.segments.length > 0) {
            decodeTelemetry = 'recursive_decode';
          }
        } else {
          continue;
        }
      } else if (!directHit) {
        continue;
      }

      if (directHit || normalizedTransformedSegments.length > 0) {
        // Reset regex lastIndex just in case, though replace with global flag handles it
        regex.lastIndex = 0; 
        // Redact blocked terms in model output, but do not let that alone raise
        // the audit severity. Responder-decision logic remains responsible for
        // true policy escalation.
        sanitized = sanitized.replace(regex, '[REDACTED_KEYWORD]');
        if (obfuscationAnalysis.usedObfuscation && !redactions.includes('OBFUSCATED_INSTRUCTION')) {
          redactions.push('OBFUSCATED_INSTRUCTION');
        }
        for (const signal of [...obfuscationAnalysis.signals, ...transformedSignalsUsed]) {
          if (!redactions.includes(signal)) redactions.push(signal);
        }
        if (decodeTelemetry === 'recursive_decode' && !redactions.includes('RECURSIVE_DECODE')) {
          redactions.push('RECURSIVE_DECODE');
        }
      }
    }
  }

  for (const signal of structuralSignals) {
    if (!redactions.includes(signal)) redactions.push(signal);
  }
  if (leetspeakDetected && !redactions.includes('LEETSPEAK')) {
    redactions.push('LEETSPEAK');
  }

  // Return the output sanitization result
  return { sanitized, triggeredEscalation, redactions, decodeTelemetry };
}

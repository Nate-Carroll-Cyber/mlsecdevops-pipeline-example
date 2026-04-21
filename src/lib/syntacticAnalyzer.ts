import { hasLeetspeakObfuscation } from './sanitizerNormalization';

const WRAPPER_SHELL_REGEX =
  /^\s*(?:[\[(<]{1,3}|--)?\s*\/?\s*[A-Z][A-Z0-9]*(?:[ _:-]+[A-Z0-9]+){0,10}\s*(?:[\])>]{1,3})?\s*$/gm;
const DOUBLE_BRACKET_WRAPPER_REGEX = /\[\[[A-Z0-9_:-]{3,}\]\]/g;
const ANGLE_TAG_WRAPPER_REGEX = /<[/]?[A-Z0-9_:-]{3,}>/g;
const PAREN_WRAPPER_REGEX = /\(([A-Z0-9_:-]{3,})\)/g;
const BASE64_BLOB_REGEX = /\b(?:[A-Za-z0-9+/]{20,}={0,2})\b/g;
const ESCAPE_SEQUENCE_REGEX = /(?:\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|%[0-9a-fA-F]{2}){3,}/g;

function countMatches(input: string, regex: RegExp): number {
  return input.match(regex)?.length ?? 0;
}

function hasBase64LikeBlob(input: string): boolean {
  return BASE64_BLOB_REGEX.test(input) && /[A-Z]/.test(input) && /[a-z]/.test(input) && /\d|[+/=]/.test(input);
}

function hasEscapeSequenceBlob(input: string): boolean {
  return ESCAPE_SEQUENCE_REGEX.test(input);
}

// Function to analyze the syntactic complexity of a prompt to detect adversarial patterns
export function analyzeSyntacticComplexity(prompt: string, threshold: number = 65) {
  // Check if the prompt is empty or only contains whitespace
  if (!prompt || prompt.trim().length === 0) {
    // Return a zeroed-out result if the prompt is empty
    return { score: 0, isProbingAttempt: false, metrics: { constraintCount: 0, constraintDensity: 0, specialCharRatio: 0, avgWordsPerSentence: 0 } };
  }

  const wrapperShellCount =
    countMatches(prompt, WRAPPER_SHELL_REGEX) +
    countMatches(prompt, DOUBLE_BRACKET_WRAPPER_REGEX) +
    countMatches(prompt, ANGLE_TAG_WRAPPER_REGEX) +
    countMatches(prompt, PAREN_WRAPPER_REGEX);
  const normalizedPrompt = prompt
    .replace(/\\([_<>\[\]])/g, '$1')
    .replace(/\\_/g, '_')
    .replace(WRAPPER_SHELL_REGEX, ' ')
    .replace(DOUBLE_BRACKET_WRAPPER_REGEX, ' ')
    .replace(ANGLE_TAG_WRAPPER_REGEX, ' ')
    .replace(PAREN_WRAPPER_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Convert the prompt to lowercase for case-insensitive keyword matching
  const lowerPrompt = normalizedPrompt.toLowerCase();
  
  // 1. Constraint Density
  // Define a list of operational keywords commonly used in prompt injection and jailbreaks
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
  
  // Initialize a counter for the number of operational keywords found
  let constraintCount = 0;
  let weightedConstraintScore = 0;
  highSignalKeywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const matches = lowerPrompt.match(regex);
    if (matches) {
      constraintCount += matches.length;
      weightedConstraintScore += matches.length * 1.4;
    }
  });
  mediumSignalKeywords.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const matches = lowerPrompt.match(regex);
    if (matches) {
      constraintCount += matches.length;
      weightedConstraintScore += matches.length * 0.6;
    }
  });

  // Calculate the total number of words in the prompt by splitting on whitespace
  const totalWords = normalizedPrompt.trim().split(/\s+/).length;
  // Calculate the constraint density as a percentage of total words
  const constraintDensity = totalWords > 0 ? (constraintCount / totalWords) * 100 : 0;

  // 2. Special Character Ratio
  // Matches anything that is NOT alphanumeric, whitespace, or basic English punctuation
  // This perfectly isolates code syntax (brackets, math operators, quotes, URL encoding %, _, etc.)
  // Find all special characters in the prompt
  const specialChars = normalizedPrompt.match(/[^a-zA-Z0-9\s.,!?\-:']/g);
  // Count the number of special characters found
  const specialCharCount = specialChars ? specialChars.length : 0;
  // Calculate the ratio of special characters to the total prompt length as a percentage
  const specialCharRatio = normalizedPrompt.length > 0 ? (specialCharCount / normalizedPrompt.length) * 100 : 0;

  // 3. Verbosity (Words per sentence)
  // Split the prompt into sentences based on common sentence-ending punctuation
  const sentences = normalizedPrompt.split(/[.!?]+/).filter(s => s.trim().length > 0);
  // Calculate the average number of words per sentence
  const avgWordsPerSentence = sentences.length > 0 ? (totalWords / sentences.length) : totalWords;

  // --- Scoring Engine ---
  // Initialize the total syntactic complexity score
  let score = 0;
  
  // Base score from raw count of operational keywords (highly indicative of meta-prompting)
  // Add 10 points per constraint, capped at 60 points
  score += Math.min(weightedConstraintScore * 10, 60); 
  
  // Score from density (catches short, dense injections)
  // Add points based on constraint density, capped at 40 points
  score += Math.min(constraintDensity * 15, 40); 
  
  // Score from special characters (JSON/XML wrapping)
  // Add points based on special character ratio, capped at 30 points
  score += Math.min(specialCharRatio * 10, 30); 
  
  // Verbosity (run-on sentences often used for cognitive overload)
  // Add 5 points if sentences are long (> 20 words)
  if (avgWordsPerSentence > 20) score += 5;
  // Add another 10 points if sentences are very long (> 40 words)
  if (avgWordsPerSentence > 40) score += 10; 
  // Add another 10 points if sentences are extremely long (> 60 words)
  if (avgWordsPerSentence > 60) score += 10; 

  // Benign wrapper shells still indicate prompt structure, just not adversarial syntax.
  score += Math.min(wrapperShellCount * 8, 12);

  // Encoded blobs and leetspeak are syntactic concealment signals even when the
  // wording itself does not contain explicit jailbreak verbs.
  if (hasBase64LikeBlob(prompt)) score += 24;
  if (hasEscapeSequenceBlob(prompt)) score += 20;
  if (hasLeetspeakObfuscation(prompt)) score += 28;

  // Define the threshold score for classifying a prompt as a probing attempt
  // Return the final analysis results
  return {
    // Cap the final score at 100 and format to 1 decimal place
    score: Math.min(parseFloat(score.toFixed(1)), 100),
    // Flag as a probing attempt if the score meets or exceeds the threshold
    isProbingAttempt: score >= threshold,
    // Return the individual metrics for detailed analysis
    metrics: {
      // The raw count of operational keywords
      constraintCount,
      // The constraint density formatted to 1 decimal place
      constraintDensity: parseFloat(constraintDensity.toFixed(1)),
      // The special character ratio formatted to 1 decimal place
      specialCharRatio: parseFloat(specialCharRatio.toFixed(1)),
      // The average words per sentence formatted to 1 decimal place
      avgWordsPerSentence: parseFloat(avgWordsPerSentence.toFixed(1))
    }
  };
}

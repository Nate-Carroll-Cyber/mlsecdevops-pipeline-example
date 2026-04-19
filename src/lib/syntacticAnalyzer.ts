// Function to analyze the syntactic complexity of a prompt to detect adversarial patterns
export function analyzeSyntacticComplexity(prompt: string) {
  // Check if the prompt is empty or only contains whitespace
  if (!prompt || prompt.trim().length === 0) {
    // Return a zeroed-out result if the prompt is empty
    return { score: 0, isProbingAttempt: false, metrics: { constraintCount: 0, constraintDensity: 0, specialCharRatio: 0, avgWordsPerSentence: 0 } };
  }

  // Convert the prompt to lowercase for case-insensitive keyword matching
  const lowerPrompt = prompt.toLowerCase();
  
  // 1. Constraint Density
  // Define a list of operational keywords commonly used in prompt injection and jailbreaks
  const operationalKeywords = [
    'ignore', 'override', 'disregard', 'instead', 'regardless', 
    'assume', 'hypothetical', 'must', 'always', 'never', 'system',
    'instructions', 'prior', 'forget', 'output format', 'jailbreak',
    'act as', 'simulate', 'pretend', 'from now on', 'developer mode',
    'unfiltered', 'uncensored', 'bypass', 'rules', 'guidelines',
    'policy', 'policies', 'restriction', 'limitations', 'prompt',
    'roleplay', 'persona', 'character', 'mode', 'previous', 'context',
    'clear', 'reset', 'start over', 'new instructions', 'do anything now',
    'dan', 'sudo', 'admin', 'root', 'system prompt', 'core instructions',
    'base instructions', 'you are', 'you will', 'you must', 'you cannot',
    'you shall', 'respond as', 'answer as', 'reply as', 'behave as',
    'enabled', 'disabled', 'developer', 'chatgpt', 'openai', 'gemini'
  ];
  
  // Initialize a counter for the number of operational keywords found
  let constraintCount = 0;
  // Iterate over each operational keyword
  operationalKeywords.forEach(keyword => {
    // Create a regular expression to match the keyword as a whole word
    const regex = new RegExp(`\\b${keyword}\\b`, 'g');
    // Find all matches of the keyword in the lowercased prompt
    const matches = lowerPrompt.match(regex);
    // If matches are found, add the number of matches to the total count
    if (matches) constraintCount += matches.length;
  });

  // Calculate the total number of words in the prompt by splitting on whitespace
  const totalWords = prompt.trim().split(/\s+/).length;
  // Calculate the constraint density as a percentage of total words
  const constraintDensity = totalWords > 0 ? (constraintCount / totalWords) * 100 : 0;

  // 2. Special Character Ratio
  // Matches anything that is NOT alphanumeric, whitespace, or basic English punctuation
  // This perfectly isolates code syntax (brackets, math operators, quotes, URL encoding %, _, etc.)
  // Find all special characters in the prompt
  const specialChars = prompt.match(/[^a-zA-Z0-9\s.,!?\-:']/g);
  // Count the number of special characters found
  const specialCharCount = specialChars ? specialChars.length : 0;
  // Calculate the ratio of special characters to the total prompt length as a percentage
  const specialCharRatio = (specialCharCount / prompt.length) * 100;

  // 3. Verbosity (Words per sentence)
  // Split the prompt into sentences based on common sentence-ending punctuation
  const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 0);
  // Calculate the average number of words per sentence
  const avgWordsPerSentence = sentences.length > 0 ? (totalWords / sentences.length) : totalWords;

  // --- Scoring Engine ---
  // Initialize the total syntactic complexity score
  let score = 0;
  
  // Base score from raw count of operational keywords (highly indicative of meta-prompting)
  // Add 10 points per constraint, capped at 60 points
  score += Math.min(constraintCount * 10, 60); 
  
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

  // Define the threshold score for classifying a prompt as a probing attempt
  const THRESHOLD = 65;

  // Return the final analysis results
  return {
    // Cap the final score at 100 and format to 1 decimal place
    score: Math.min(parseFloat(score.toFixed(1)), 100),
    // Flag as a probing attempt if the score meets or exceeds the threshold
    isProbingAttempt: score >= THRESHOLD,
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

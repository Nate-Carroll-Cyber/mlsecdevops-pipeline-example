// Interface defining the structure of an audit log entry for metrics calculation
export interface AuditLogMetrics {
  // The unique identifier for the audit log entry
  id: string;
  // The severity level determined by the automated system (0: Clean, 1: Info, 2: Suspicious, 3: Adversarial)
  detectionLevel: number; // 0: Clean, 1: Info, 2: Suspicious, 3: Adversarial
  // The final severity level assigned by a human analyst after review
  resultantSeverity?: 'Clean' | 'Informational' | 'Suspicious' | 'Adversarial'; // Set by Analyst
  // Boolean flag indicating whether a human analyst has reviewed this log
  reviewed: boolean;
}

function severityToScore(severity?: 'Clean' | 'Informational' | 'Suspicious' | 'Adversarial'): number {
  switch (severity) {
    case 'Informational':
      return 1;
    case 'Suspicious':
      return 2;
    case 'Adversarial':
      return 3;
    case 'Clean':
    default:
      return 0;
  }
}

// Function to calculate false positive and analyst-upgrade metrics
export function calculateFalsePositiveMetrics(logs: AuditLogMetrics[]) {
  // To get an accurate metric, we should ideally only calculate this 
  // on logs that an analyst has actually reviewed.
  // Filter the input logs to include only those that have been reviewed
  const reviewedLogs = logs.filter(log => log.reviewed === true);

  // Initialize counter for False Positives (System Blocked, Analyst said "Clean")
  let falsePositives = 0; // System Blocked, Analyst said "Clean"
  // Initialize counter for True Negatives (System Allowed, Analyst said "Clean")
  let trueNegatives = 0;  // System Allowed, Analyst said "Clean"
  // Initialize counter for the total number of logs blocked by the system
  let totalBlockedBySystem = 0; // System Blocked (Suspicious + Adversarial)
  // Initialize counter for analyst upgrades on already-blocked traffic
  let analystUpgrades = 0;

  // Iterate over each reviewed log to calculate metrics
  reviewedLogs.forEach(log => {
    // Determine the System's Verdict (Did the firewall trigger?)
    // In our system, Suspicious (2) and Adversarial (3) are "Blocked"
    // Check if the system detection level is 2 or higher
    const systemBlocked = log.detectionLevel >= 2; 
    
    // Determine the Ground Truth (What did the human decide?)
    // Consider the log "Clean" if the analyst marked it as Clean or Informational
    const isActuallyClean = log.resultantSeverity === 'Clean' || log.resultantSeverity === 'Informational';

    // Tally for the formulas
    // If the system blocked the request, increment the total blocked counter
    if (systemBlocked) {
      totalBlockedBySystem++;
      const analystScore = severityToScore(log.resultantSeverity);
      if (analystScore > log.detectionLevel) {
        analystUpgrades++;
      }
    }

    // If the system blocked it BUT the analyst said it was clean
    if (systemBlocked && isActuallyClean) {
      // Increment the false positive counter
      falsePositives++; // The firewall made a mistake (False Positive)
    // If the system allowed it AND the analyst agreed it was clean
    } else if (!systemBlocked && isActuallyClean) {
      // Increment the true negative counter
      trueNegatives++; // The firewall was right to let it through (True Negative)
    }
  });

  // --- Formula 1: Strict Mathematical FPR ---
  // FPR = FP / (FP + TN)
  // Meaning: "Out of all the ACTUALLY CLEAN prompts, what percentage did we accidentally block?"
  // Calculate the total number of actually clean prompts
  const totalActualClean = falsePositives + trueNegatives;
  // Calculate the strict False Positive Rate as a percentage
  const strictFPR = totalActualClean > 0 
    // Divide false positives by total actual clean and multiply by 100
    ? (falsePositives / totalActualClean) * 100 
    // Default to 0 if there are no actually clean prompts
    : 0;

  // --- Formula 2: Analyst Upgrade Rate on System Blocks ---
  // Rate = Analyst Upgrades / Total System Blocks
  // Meaning: "Out of everything the system already blocked, how often did analysts elevate severity further?"
  const falseNegativeRate = totalBlockedBySystem > 0 
    ? (analystUpgrades / totalBlockedBySystem) * 100 
    : 0;

  // Return the calculated metrics
  return {
    // The strict FPR formatted to 1 decimal place (e.g., "4.2")
    strictFPR: strictFPR.toFixed(1), // e.g., "4.2"
    // The analyst-upgrade rate formatted to 1 decimal place
    falseNegativeRate: falseNegativeRate.toFixed(1),
    // The raw count of false positives
    falsePositivesCount: falsePositives,
    // The raw count of analyst upgrades on blocked traffic
    analystUpgradeCount: analystUpgrades,
    // The total number of reviewed logs used in the calculation
    totalReviewed: reviewedLogs.length
  };
}

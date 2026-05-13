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

// Calculate reviewed-outcome performance metrics using analyst decisions as the
// ground-truth source. The confusion matrix is:
// - FP: automated firewall blocked/threat-classified, analyst marked clean/info.
// - TN: automated firewall allowed, analyst marked clean/info.
// - FN: automated firewall allowed, analyst marked suspicious/adversarial.
// - TP: automated firewall blocked/threat-classified, analyst confirmed threat.
export function calculateFalsePositiveMetrics(logs: AuditLogMetrics[]) {
  // Metrics intentionally use only reviewed logs because analyst review is the
  // source of truth for false-positive and false-negative accounting.
  const reviewedLogs = logs.filter(log => log.reviewed === true);

  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;
  let truePositives = 0;

  reviewedLogs.forEach(log => {
    // Suspicious (2) and Adversarial (3) are treated as automated blocks or
    // threat classifications for review-metric accounting.
    const systemBlocked = log.detectionLevel >= 2; 
    const isActuallyClean = log.resultantSeverity === 'Clean' || log.resultantSeverity === 'Informational';
    const analystScore = severityToScore(log.resultantSeverity);
    const isActuallyThreat = analystScore >= 2;

    if (systemBlocked && isActuallyClean) {
      falsePositives++;
    } else if (systemBlocked && isActuallyThreat) {
      truePositives++;
    } else if (!systemBlocked && isActuallyClean) {
      trueNegatives++;
    } else if (!systemBlocked && isActuallyThreat) {
      falseNegatives++;
    }
  });

  // --- Formula 1: False Positive Rate ---
  // FPR = FP / (FP + TN)
  // Meaning: out of all prompts analysts judged clean/info, what percentage did
  // the system initially block or classify as threat traffic?
  const totalActualClean = falsePositives + trueNegatives;
  const strictFPR = totalActualClean > 0 
    ? (falsePositives / totalActualClean) * 100 
    : 0;

  // --- Formula 2: False Negative Rate ---
  // FNR = FN / (FN + TP)
  // Meaning: out of all prompts analysts judged suspicious/adversarial, what
  // percentage did the system initially allow?
  const totalActualThreats = falseNegatives + truePositives;
  const falseNegativeRate = totalActualThreats > 0 
    ? (falseNegatives / totalActualThreats) * 100 
    : 0;

  return {
    // Percent values are formatted to one decimal place for stable dashboard display.
    strictFPR: strictFPR.toFixed(1),
    falseNegativeRate: falseNegativeRate.toFixed(1),
    // Raw counts remain available for future drill-downs or export surfaces.
    falsePositivesCount: falsePositives,
    falseNegativesCount: falseNegatives,
    truePositivesCount: truePositives,
    totalReviewed: reviewedLogs.length
  };
}

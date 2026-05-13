// Interface defining the structure of a threat log entry
export interface ThreatLog {
  // The unique identifier of the user who generated the threat
  userId: string;
  // The timestamp when the threat occurred
  timestamp: Date;
  // The severity level of the detected threat (e.g., 1=Info, 2=Suspicious, 3=Adversarial)
  detectionLevel: number;
}

// Function to detect sudden spikes in threat activity using a rolling baseline
export function detectThreatSpikes(logs: ThreatLog[]) {
  // Get the current time in milliseconds
  const now = new Date().getTime();
  // Define a constant for one hour in milliseconds
  const ONE_HOUR = 60 * 60 * 1000;

  // 1. Calculate the Baseline (Last 24 hours average)
  // Total logs divided by 24 gives us the expected "Normal" hourly rate
  const baselineHourlyRate = logs.length / 24;

  // 2. Calculate the Current Activity (Last 1 hour)
  // Filter the logs to only include those from the last hour
  const currentHourLogs = logs.filter(log => (now - log.timestamp.getTime()) <= ONE_HOUR);
  // Count the number of logs in the current hour
  const currentHourlyRate = currentHourLogs.length;

  // 3. Prevent division by zero if the baseline is absolutely quiet
  // If the baseline is 0, set it to 1 to avoid Infinity when calculating the ratio
  const safeBaseline = baselineHourlyRate > 0 ? baselineHourlyRate : 1;

  // 4. Calculate the Spike Ratio (Multiplier)
  // Divide the current hourly rate by the baseline to get the multiplier
  const spikeRatio = currentHourlyRate / safeBaseline;

  // 5. Check if it's an anomaly (e.g., 500% increase = 5x multiplier)
  // Flag as an anomaly if the ratio is >= 5.0 AND there are more than 5 events (to avoid noise from low volume)
  const isAnomaly = spikeRatio >= 5.0 && currentHourlyRate > 5; // Require at least 5 events to trigger

  // 6. Identify if a specific user is causing the spike
  // Reduce the current hour's logs into a dictionary counting threats per user
  const userThreatCounts = currentHourLogs.reduce((acc, log) => {
    // Increment the count for the user, initializing to 0 if not seen before
    acc[log.userId] = (acc[log.userId] || 0) + 1;
    // Return the accumulator for the next iteration
    return acc;
  }, {} as Record<string, number>);

  // Find the top attacker by sorting the user counts in descending order and taking the first element
  const topAttacker = Object.entries(userThreatCounts).sort((a, b) => b[1] - a[1])[0];

  // Return the anomaly detection results
  return {
    // Boolean indicating if an anomaly is currently occurring
    isAnomaly,
    // The calculated spike ratio (multiplier)
    spikeRatio,
    // The number of threats in the current hour
    currentHourlyRate,
    // The average number of threats per hour over the last 24 hours
    baselineHourlyRate,
    // The ID of the user with the most threats in the current hour, or null if none
    topAttackerId: topAttacker ? topAttacker[0] : null
  };
}

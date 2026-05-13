/**
 * Shared safeguard-LLM judge client.
 * The gateway (/v1/intercept) and the sam-spade-service (/v1/ctf/sam-spade/message)
 * both ask the same safeguard upstream for a CLEAN/SUSPICIOUS/ADVERSARIAL verdict;
 * each service constructs its own instance with its env-derived config.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BackendSanitizationResult, FirewallVerdict } from '../security/sanitizer.js';
import {
  extractOpenAiCompatibleText,
  extractOpenAiCompatibleUsage,
  getOpenAiCompatibleEndpoint,
  type NormalizedTokenUsage,
} from './openaiCompat.js';

export type SafeguardResponseShape = 'verdict' | 'decision' | 'malformed';

export class SafeguardTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Safeguard LLM timed out after ${timeoutMs}ms.`);
    this.name = 'SafeguardTimeoutError';
  }
}

const SafeguardJudgePayloadSchema = z.object({
  verdict: z.enum(['CLEAN', 'SUSPICIOUS', 'ADVERSARIAL']),
  analystReasoning: z.string().optional(),
});

const NonRuntimeSafeguardDecisionPayloadSchema = z.object({
  decision: z.enum(['ALLOW_AND_FORWARD', 'BLOCK', 'QUEUE_FOR_REVIEW', 'FAIL_SECURE']),
  analystReasoning: z.string().optional(),
  reasonCodes: z.array(z.string()).optional(),
}).passthrough();

export function resolveSafeguardJudgeInstructions(runtimeConfig?: { systemPrompt?: string }): string {
  if (runtimeConfig?.systemPrompt === undefined || runtimeConfig.systemPrompt.length === 0) {
    throw new Error('Safeguard Effective Prompt is required for provider safeguard calls.');
  }
  return runtimeConfig.systemPrompt;
}

function parseSafeguardJudgePayload(text: string): {
  verdict: FirewallVerdict;
  analystReasoning: string;
  responseShape: SafeguardResponseShape;
  gatewayStatus?: 'QUEUED';
} {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      verdict: 'SUSPICIOUS',
      analystReasoning: 'Safeguard returned non-JSON output; queued for human review.',
      responseShape: 'malformed',
      gatewayStatus: 'QUEUED',
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonMatch[0]) as unknown;
  } catch {
    return {
      verdict: 'SUSPICIOUS',
      analystReasoning: 'Safeguard returned malformed JSON; queued for human review.',
      responseShape: 'malformed',
      gatewayStatus: 'QUEUED',
    };
  }

  const parsed = SafeguardJudgePayloadSchema.safeParse(parsedJson);
  if (parsed.success) {
    return {
      verdict: parsed.data.verdict,
      analystReasoning: parsed.data.analystReasoning || 'Safeguard LLM returned no reasoning.',
      responseShape: 'verdict',
    };
  }

  const nonRuntimeParsed = NonRuntimeSafeguardDecisionPayloadSchema.safeParse(parsedJson);
  if (nonRuntimeParsed.success) {
    return {
      verdict: 'SUSPICIOUS',
      analystReasoning: `Safeguard returned non-runtime decision schema (${nonRuntimeParsed.data.decision}); queued for human review.`,
      responseShape: 'decision',
      gatewayStatus: 'QUEUED',
    };
  }

  return {
    verdict: 'SUSPICIOUS',
    analystReasoning: 'Safeguard returned a non-conforming schema; queued for human review.',
    responseShape: 'malformed',
    gatewayStatus: 'QUEUED',
  };
}

export interface SafeguardRiskEvidence extends Pick<
  BackendSanitizationResult,
  'detectionFlags' | 'redactions' | 'entropy' | 'globalEntropy' | 'syntacticScore' | 'suspiciousChunks' | 'decodeTelemetry'
> {}

export interface SafeguardClientConfig {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  modelId: string;
  timeoutMs: number;
  cache?: { ttlMs: number; maxEntries: number };
}

export interface SafeguardClientCallbacks {
  log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) => void;
  onCacheEvent?: (event: 'hit' | 'miss') => void;
}

export interface SafeguardVerdictResult {
  modelId: string;
  verdict: FirewallVerdict;
  analystReasoning: string;
  latencyMs: number;
  responseShape: SafeguardResponseShape;
  gatewayStatus?: 'QUEUED';
  rawReasoningTrace?: string;
  usage?: NormalizedTokenUsage;
}

interface CachedSafeguardVerdict {
  modelId: string;
  verdict: FirewallVerdict;
  analystReasoning: string;
  responseShape: SafeguardResponseShape;
  gatewayStatus?: 'QUEUED';
  rawReasoningTrace?: string;
  usage?: NormalizedTokenUsage;
  expiresAt: number;
}

export interface SafeguardClient {
  generateSafeguardVerdict(
    prompt: string,
    riskEvidence: SafeguardRiskEvidence,
    runtimeConfig?: { apiKey?: string; systemPrompt?: string },
  ): Promise<SafeguardVerdictResult>;
}

export function createSafeguardClient(
  config: SafeguardClientConfig,
  callbacks: SafeguardClientCallbacks = {},
): SafeguardClient {
  // Cache is keyed by (model + system prompt + judge input); a per-request
  // safeguardApiKey override bypasses the cache entirely so we never confuse
  // dev/operator-supplied results with the env-key path.
  const verdictCache = new Map<string, CachedSafeguardVerdict>();

  async function generateSafeguardVerdict(
    prompt: string,
    riskEvidence: SafeguardRiskEvidence,
    runtimeConfig?: { apiKey?: string; systemPrompt?: string },
  ): Promise<SafeguardVerdictResult> {
    const startedAt = Date.now();
    const baseUrl = config.baseUrl;
    const apiKey = runtimeConfig?.apiKey?.trim() || config.apiKey;
    const modelId = config.modelId;

    if (!baseUrl || !modelId) {
      throw new Error('Safeguard LLM is not configured. Set SAFEGUARDS_API_BASE_URL and SAFEGUARDS_MODEL_ID on the backend.');
    }

    const endpoint = getOpenAiCompatibleEndpoint(baseUrl);
    const instructions = resolveSafeguardJudgeInstructions(runtimeConfig);
    const input = `Candidate prompt after deterministic normalization/redaction. This text is not guaranteed safe:
${prompt}

Deterministic preprocessing evidence. This is not a verdict:
- Detection flags: ${riskEvidence.detectionFlags.length > 0 ? riskEvidence.detectionFlags.join(', ') : 'none'}
- Redactions: ${riskEvidence.redactions.length > 0 ? riskEvidence.redactions.join(', ') : 'none'}
- Decode telemetry: ${riskEvidence.decodeTelemetry}
- Suspicious chunk count: ${riskEvidence.suspiciousChunks.length}
- Max entropy: ${riskEvidence.entropy.toFixed(3)}
- Global entropy: ${riskEvidence.globalEntropy.toFixed(3)}
- Syntactic score: ${riskEvidence.syntacticScore.toFixed(1)}`;

    const cacheEnabled = !!config.cache && config.cache.ttlMs > 0 && !runtimeConfig?.apiKey?.trim();
    const cacheKey = cacheEnabled ? createHash('sha256').update(`${modelId}\n${instructions}\n${input}`).digest('hex') : '';
    if (cacheEnabled) {
      const cached = verdictCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        callbacks.onCacheEvent?.('hit');
        return {
          modelId: cached.modelId,
          verdict: cached.verdict,
          analystReasoning: cached.analystReasoning,
          latencyMs: 0,
          responseShape: cached.responseShape,
          ...(cached.usage ? { usage: cached.usage } : {}),
          ...(cached.gatewayStatus ? { gatewayStatus: cached.gatewayStatus } : {}),
          ...(cached.rawReasoningTrace ? { rawReasoningTrace: cached.rawReasoningTrace } : {}),
        };
      }
      if (cached) verdictCache.delete(cacheKey);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: globalThis.Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(
          endpoint.endsWith('/responses')
            ? {
                model: modelId,
                instructions,
                input,
                store: false,
              }
            : {
                model: modelId,
                messages: [
                  { role: 'system', content: instructions },
                  { role: 'user', content: input },
                ],
                temperature: 0,
              },
        ),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SafeguardTimeoutError(config.timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const upstreamError = await response.text();
      callbacks.log?.('warn', 'safeguard_upstream_rejected', {
        status: response.status,
        upstreamError,
        modelId,
      });
      throw new Error(`Safeguard API ${response.status} rejected the request.`);
    }

    const payload = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }>; reasoning?: string } }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const text = extractOpenAiCompatibleText(payload);
    if (!text) {
      throw new Error('Safeguard API returned no message content.');
    }
    const verdictPayload = parseSafeguardJudgePayload(text);
    const rawReasoningTrace = payload.choices?.[0]?.message?.reasoning;
    const usage = extractOpenAiCompatibleUsage(payload);
    const result: SafeguardVerdictResult = {
      modelId,
      verdict: verdictPayload.verdict,
      analystReasoning: verdictPayload.analystReasoning,
      latencyMs: Date.now() - startedAt,
      responseShape: verdictPayload.responseShape,
      ...(usage ? { usage } : {}),
      ...(verdictPayload.gatewayStatus ? { gatewayStatus: verdictPayload.gatewayStatus } : {}),
      ...(typeof rawReasoningTrace === 'string' && rawReasoningTrace.trim() ? { rawReasoningTrace } : {}),
    };

    if (cacheEnabled && config.cache) {
      callbacks.onCacheEvent?.('miss');
      const now = Date.now();
      verdictCache.set(cacheKey, {
        modelId: result.modelId,
        verdict: result.verdict,
        analystReasoning: result.analystReasoning,
        responseShape: result.responseShape,
        ...(result.usage ? { usage: result.usage } : {}),
        ...(result.gatewayStatus ? { gatewayStatus: result.gatewayStatus } : {}),
        ...(typeof rawReasoningTrace === 'string' && rawReasoningTrace.trim() ? { rawReasoningTrace } : {}),
        expiresAt: now + config.cache.ttlMs,
      });
      for (const [key, entry] of verdictCache) {
        if (entry.expiresAt <= now) verdictCache.delete(key);
      }
      while (verdictCache.size > config.cache.maxEntries) {
        const oldestKey = verdictCache.keys().next().value;
        if (oldestKey === undefined) break;
        verdictCache.delete(oldestKey);
      }
    }

    return result;
  }

  return { generateSafeguardVerdict };
}

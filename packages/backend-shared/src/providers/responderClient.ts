/**
 * Shared responder-LLM client.
 * Wraps the two production responder providers (OpenAI-compatible / Gemini) so
 * the gateway and the sam-spade-service can both produce downstream model
 * output through the same shape. Each service constructs its own instance with
 * its env-derived config.
 */
import {
  extractOpenAiCompatibleText,
  getOpenAiCompatibleEndpoint,
  type NormalizedTokenUsage,
} from './openaiCompat.js';

export type ResponderProvider = 'openai_compatible' | 'gemini';

export class UpstreamResponderError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'UpstreamResponderError';
    this.status = status;
  }
}

export function inferResponderProvider(provider?: string, baseUrl?: string): ResponderProvider {
  if (provider === 'gemini') return 'gemini';
  if (provider === 'openai_compatible') return 'openai_compatible';
  return baseUrl?.includes('generativelanguage.googleapis.com') ? 'gemini' : 'openai_compatible';
}

export interface ResponderClientConfig {
  // Hint from RESPONDER_PROVIDER env var. Falls back to URL sniffing.
  configuredProvider: string | undefined;
  // The primary responder base URL (e.g. https://generativelanguage... or
  // https://openrouter.ai/api/v1). When provider === 'openai_compatible' this
  // falls back to fallbackOpenAiBaseUrl below if unset.
  responderBaseUrl: string | undefined;
  // Legacy LLM_API_BASE_URL fallback for the openai_compatible path.
  fallbackOpenAiBaseUrl: string | undefined;
  // Primary responder API key, with legacy LLM_API_KEY fallback.
  apiKey: string | undefined;
  fallbackApiKey: string | undefined;
  // OpenAI-compatible model id (Bedrock-via-LiteLLM, etc.).
  openAiModelId: string;
  // Gemini default model id; used when provider resolves to 'gemini'.
  geminiModelId: string;
}

export interface ResponderClientCallbacks {
  log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) => void;
}

export interface ResponderResult {
  provider: ResponderProvider;
  modelId: string;
  response: string;
  usage?: NormalizedTokenUsage;
  latencyMs: number;
}

export interface ResponderClient {
  generateResponderOutput(prompt: string, systemPrompt?: string): Promise<ResponderResult>;
}

export function createResponderClient(
  config: ResponderClientConfig,
  callbacks: ResponderClientCallbacks = {},
): ResponderClient {
  async function generateResponderOutput(prompt: string, systemPrompt?: string): Promise<ResponderResult> {
    const startedAt = Date.now();
    const provider = inferResponderProvider(
      config.configuredProvider,
      config.responderBaseUrl || config.fallbackOpenAiBaseUrl,
    );
    const configuredBaseUrl = provider === 'gemini'
      ? config.responderBaseUrl
      : config.responderBaseUrl || config.fallbackOpenAiBaseUrl;
    const baseUrl = configuredBaseUrl || (provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : undefined);
    const apiKey = config.apiKey || config.fallbackApiKey;
    const modelId = provider === 'gemini' ? config.geminiModelId : config.openAiModelId;

    if (!baseUrl || !apiKey || !modelId) {
      return {
        provider,
        modelId,
        response: 'Counter-Spy.ai backend accepted this clean prompt. Configure responder provider, API key, base URL, and model ID to enable live downstream inference.',
        latencyMs: Date.now() - startedAt,
      };
    }

    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    if (provider === 'gemini') {
      const endpoint = `${normalizedBaseUrl}/models/${encodeURIComponent(modelId)}:generateContent`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
        }),
      });

      if (!response.ok) {
        const upstreamError = await response.text();
        callbacks.log?.('warn', 'responder_upstream_rejected', {
          provider,
          status: response.status,
          upstreamError,
          modelId,
        });
        throw new UpstreamResponderError(response.status, `Responder API ${response.status} rejected the request.`);
      }

      const payload = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const geminiText = payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim();
      if (!geminiText) {
        throw new Error('Responder API returned no Gemini candidate text.');
      }
      return {
        provider,
        modelId,
        response: geminiText,
        latencyMs: Date.now() - startedAt,
        usage: {
          ...(payload.usageMetadata?.promptTokenCount !== undefined ? { promptTokens: payload.usageMetadata.promptTokenCount } : {}),
          ...(payload.usageMetadata?.candidatesTokenCount !== undefined ? { completionTokens: payload.usageMetadata.candidatesTokenCount } : {}),
          ...(payload.usageMetadata?.totalTokenCount !== undefined ? { totalTokens: payload.usageMetadata.totalTokenCount } : {}),
        },
      };
    }

    const endpoint = getOpenAiCompatibleEndpoint(normalizedBaseUrl);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(
        endpoint.endsWith('/responses')
          ? {
              model: modelId,
              input: prompt,
              ...(systemPrompt ? { instructions: systemPrompt } : {}),
              store: true,
            }
          : {
              model: modelId,
              messages: [
                ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                { role: 'user', content: prompt },
              ],
              temperature: 0,
            },
      ),
    });

    if (!response.ok) {
      const upstreamError = await response.text();
      callbacks.log?.('warn', 'responder_upstream_rejected', {
        status: response.status,
        upstreamError,
        modelId,
      });
      throw new UpstreamResponderError(response.status, `Responder API ${response.status} rejected the request.`);
    }

    const payload = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
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
      throw new Error('Responder API returned no message content.');
    }
    return {
      provider,
      modelId,
      response: text,
      latencyMs: Date.now() - startedAt,
      usage: {
        ...(payload.usage?.input_tokens !== undefined || payload.usage?.prompt_tokens !== undefined
          ? { promptTokens: payload.usage?.input_tokens ?? payload.usage?.prompt_tokens }
          : {}),
        ...(payload.usage?.output_tokens !== undefined || payload.usage?.completion_tokens !== undefined
          ? { completionTokens: payload.usage?.output_tokens ?? payload.usage?.completion_tokens }
          : {}),
        ...(payload.usage?.total_tokens !== undefined ? { totalTokens: payload.usage.total_tokens } : {}),
      },
    };
  }

  return { generateResponderOutput };
}

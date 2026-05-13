/**
 * Shared helpers for talking to OpenAI-compatible upstreams (LM Studio, OpenAI
 * itself, Bedrock-via-LiteLLM, etc.). Pure utilities — no env, no state, no
 * side effects beyond URL parsing — so both the gateway responder/safeguard
 * and the sam-spade-service can call into the same shapes.
 */

export function isLocalOpenAiCompatibleUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const parsedUrl = new URL(baseUrl);
    return parsedUrl.hostname === 'localhost' ||
      parsedUrl.hostname === '127.0.0.1' ||
      (parsedUrl.hostname === '::1' || parsedUrl.hostname === '[::1]') ||
      parsedUrl.hostname === 'host.docker.internal' ||
      parsedUrl.hostname.startsWith('192.168.') ||
      parsedUrl.hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(parsedUrl.hostname);
  } catch {
    return false;
  }
}

export function getOpenAiCompatibleEndpoint(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const isLocalOpenAiCompatibleHost = isLocalOpenAiCompatibleUrl(normalizedBaseUrl);
  if (normalizedBaseUrl.endsWith('/responses') || normalizedBaseUrl.endsWith('/chat/completions')) {
    return normalizedBaseUrl;
  }
  if (normalizedBaseUrl.endsWith('/v1')) {
    return isLocalOpenAiCompatibleHost
      ? `${normalizedBaseUrl}/chat/completions`
      : `${normalizedBaseUrl}/responses`;
  }
  return `${normalizedBaseUrl}/chat/completions`;
}

export function getOpenAiCompatibleEmbeddingsEndpoint(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  return normalizedBaseUrl.endsWith('/embeddings')
    ? normalizedBaseUrl
    : normalizedBaseUrl.endsWith('/chat/completions')
      ? normalizedBaseUrl.replace(/\/chat\/completions$/, '/embeddings')
      : normalizedBaseUrl.endsWith('/v1')
        ? `${normalizedBaseUrl}/embeddings`
        : `${normalizedBaseUrl}/embeddings`;
}

export interface OpenAiCompatibleTextPayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }>; reasoning?: string } }>;
}

export function extractOpenAiCompatibleText(payload: OpenAiCompatibleTextPayload): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }
  const outputText = payload.output
    ?.flatMap((item) => item.content ?? [])
    .filter((part) => part?.type === 'output_text' || typeof part?.text === 'string')
    .map((part) => part?.text ?? '')
    .join('')
    .trim();
  if (outputText) return outputText;

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? '').join('').trim();
  return '';
}

export interface OpenAiCompatibleUsagePayload {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface NormalizedTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export function extractOpenAiCompatibleUsage(payload: OpenAiCompatibleUsagePayload): NormalizedTokenUsage | undefined {
  const promptTokens = payload.usage?.input_tokens ?? payload.usage?.prompt_tokens;
  const completionTokens = payload.usage?.output_tokens ?? payload.usage?.completion_tokens;
  const totalTokens = payload.usage?.total_tokens ??
    (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);

  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) return undefined;
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

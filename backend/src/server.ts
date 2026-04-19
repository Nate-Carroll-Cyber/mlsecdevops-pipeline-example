/**
 * Counter-Spy backend gateway.
 * Hosts the local firewall intercept API, translation proxy, health endpoint,
 * and the governed Sam Spade CTF routes.
 */
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { sanitizePrompt, type FirewallVerdict } from './security/sanitizer.js';
import {
  createSamSpadeSession,
  getSamSpadeSession,
  solveSamSpadeCase,
  submitSamSpadeMessage,
  type SamSpadeReviewArtifact,
  type SamSpadeSessionRecord,
} from './services/sam-spade/index.js';
import { samSpadeConfig } from './services/sam-spade/config.js';

const EnvSchema = z.object({
  APP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  APP_ENV: z.enum(['dev', 'test', 'prod']).default('dev'),
  ALLOWED_ORIGINS: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SAFEGUARDS_MODEL_ID: z.string().min(1).default('gpt-oss-safeguards20B'),
  RESPONDER_MODEL_ID: z.string().min(1).default('amazon.nova-micro-v1:0'),
  INTERCEPT_BEARER_TOKEN: z.string().min(16).optional(),
  DEEPL_API_KEY: z.string().optional(),
  GOOGLE_TRANSLATE_API_KEY: z.string().optional(),
  AZURE_TRANSLATOR_API_KEY: z.string().optional(),
});

// Validate backend configuration once before the server boots.
const env = EnvSchema.parse(process.env);

if (env.APP_ENV !== 'dev' && !env.INTERCEPT_BEARER_TOKEN) {
  throw new Error('INTERCEPT_BEARER_TOKEN is required outside dev.');
}

const app = express();
const port = env.APP_PORT || env.PORT || 8080;
const appEnv = env.APP_ENV;
const allowedOrigins = (
  env.ALLOWED_ORIGINS ||
  [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:3003',
    'http://127.0.0.1:3003',
    'https://app.cyber-spy.ai',
  ].join(',')
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const safeguardsModelId = env.SAFEGUARDS_MODEL_ID;
const responderModelId = env.RESPONDER_MODEL_ID;

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

// Emit simple structured JSON logs so local demos and future CloudWatch ingestion
// have consistent machine-readable events.
function log(level: keyof typeof LOG_LEVELS, message: string, extra: Record<string, unknown> = {}) {
  if (LOG_LEVELS[level] < LOG_LEVELS[env.LOG_LEVEL]) {
    return;
  }

  console.log(JSON.stringify({
    level,
    message,
    service: 'counter-spy-backend',
    environment: appEnv,
    timestamp: new Date().toISOString(),
    ...extra,
  }));
}

// Request shape for the main firewall intercept endpoint.
const InterceptRequestSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  userId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type InterceptRequest = z.infer<typeof InterceptRequestSchema>;

// Translation proxy contracts used by the Playground language pipeline.
const TranslationProviderSchema = z.enum(['deepl', 'google', 'azure']);

const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(20_000),
  provider: TranslationProviderSchema,
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  targetLang: z.string().min(2).max(16),
  sourceLang: z.string().min(2).max(16).optional(),
});

type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

interface TranslateResponse {
  text: string;
  original: string;
  sourceLang: string;
  targetLang: string;
  targetLangName: string;
  provider: TranslateRequest['provider'];
}

// Sam Spade API contracts kept local to the backend route layer.
const SamSpadeSessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['player', 'npc', 'system']),
  text: z.string(),
  createdAt: z.string(),
  reviewDisposition: z.enum(['clean', 'intercepted', 'queued']),
});

const SamSpadeSessionSchema = z.object({
  sessionId: z.string(),
  caseId: z.string(),
  status: z.enum(['ACTIVE', 'SOLVED', 'INTERCEPTED']),
  createdAt: z.string(),
  updatedAt: z.string(),
  solvedAt: z.string().optional(),
  messages: z.array(SamSpadeSessionMessageSchema),
  lastReview: z.object({
    requestId: z.string(),
    sessionId: z.string(),
    source: z.literal('ctf_chat'),
    action: z.enum(['message', 'solve']),
    timestamp: z.string(),
    sanitizedPrompt: z.string(),
    detectionFlags: z.array(z.string()),
    entropy: z.number(),
    globalEntropy: z.number(),
    suspiciousChunks: z.array(z.string()),
    detectionLevel: z.enum(['Clean', 'Informational', 'Suspicious', 'Adversarial']),
    escalationRecommended: z.boolean(),
    response: z.string(),
    analystReasoning: z.string(),
    latencyMs: z.number(),
    decodeTelemetry: z.enum(['plain_text', 'single_hop_decode', 'recursive_decode']),
    status: z.enum(['REVIEWED', 'PENDING_REVIEW']),
  }).optional(),
});

const SamSpadeCreateSessionRequestSchema = z.object({
  caseId: z.string().min(1).optional(),
});

const SamSpadeMessageRequestSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1).max(10_000),
});

const SamSpadeSolveRequestSchema = z.object({
  sessionId: z.string().min(1),
  theory: z.string().min(1).max(10_000),
});

type SamSpadeSession = z.infer<typeof SamSpadeSessionSchema>;

interface SamSpadeSessionResponse {
  session: SamSpadeSessionRecord;
}

interface SamSpadeMessageResponse {
  session: SamSpadeSessionRecord;
  review: SamSpadeReviewArtifact;
}

interface SamSpadeSolveResponse {
  session: SamSpadeSessionRecord;
  solved: boolean;
  evaluation: string;
  review: SamSpadeReviewArtifact;
}

interface InterceptResponse {
  requestId: string;
  status: 'CLEAN' | 'QUEUED' | 'INTERCEPTED' | 'SHIELD_ERROR';
  sanitizedPrompt: string;
  detectionFlags: string[];
  safeguards: {
    modelId: string;
    verdict: FirewallVerdict;
    analystReasoning: string;
    entropy: number;
    globalEntropy: number;
    syntacticScore: number;
    latencyMs: number;
  };
  responder?: {
    modelId: string;
    response: string;
  };
}

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

const PROVIDER_LANGUAGE_CODES: Record<TranslateRequest['provider'], Record<string, string>> = {
  deepl: {
    zh: 'ZH', ar: 'AR', ru: 'RU', ja: 'JA', hi: 'HI', ko: 'KO', fa: 'FA', tr: 'TR',
    de: 'DE', fr: 'FR', es: 'ES', pt: 'PT', it: 'IT', pl: 'PL', uk: 'UK',
  },
  google: {
    zh: 'zh', ar: 'ar', ru: 'ru', ja: 'ja', hi: 'hi', ko: 'ko', fa: 'fa', tr: 'tr',
    de: 'de', fr: 'fr', es: 'es', pt: 'pt', it: 'it', pl: 'pl', uk: 'uk',
  },
  azure: {
    zh: 'zh-Hans', ar: 'ar', ru: 'ru', ja: 'ja', hi: 'hi', ko: 'ko', fa: 'fa', tr: 'tr',
    de: 'de', fr: 'fr', es: 'es', pt: 'pt', it: 'it', pl: 'pl', uk: 'uk',
  },
};

function resolveLanguageCode(langKey: string, provider: TranslateRequest['provider']): string {
  return PROVIDER_LANGUAGE_CODES[provider][langKey] ?? langKey;
}

function getTargetLanguageName(langKey: string): string {
  return TARGET_LANGUAGE_NAMES[langKey] ?? langKey;
}

// Cheap preflight guard to avoid sending obviously encoded garbage to translation providers.
function isTextLikelyEncodedForTranslation(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return (
    /(?:%[0-9A-Fa-f]{2}){6,}/.test(text) ||
    /(?:&#(?:x[0-9A-Fa-f]+|\d+);){4,}/.test(text) ||
    /\b(?:0x)?(?:[A-Fa-f0-9]{2}){12,}\b/.test(compact) ||
    /(?:^|[^A-Za-z0-9+/=])[A-Za-z0-9+/]{20,}={0,2}(?=$|[^A-Za-z0-9+/=])/.test(text)
  );
}

// Provider-specific HTTP wrappers. These keep the route handler small and make it
// easier to replace or move translation behavior later.
async function translateDeepl(text: string, opts: TranslateRequest): Promise<string> {
  const response = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/v2/translate`, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${opts.apiKey ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: [text],
      source_lang: (opts.sourceLang ?? 'en').toUpperCase(),
      target_lang: resolveLanguageCode(opts.targetLang, 'deepl'),
    }),
  });
  if (!response.ok) throw new Error(`DeepL ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { translations: Array<{ text: string }> }).translations[0]?.text ?? text;
}

async function translateGoogle(text: string, opts: TranslateRequest): Promise<string> {
  const url = new URL(`${opts.baseUrl.replace(/\/$/, '')}/language/translate/v2`);
  url.searchParams.set('key', opts.apiKey ?? '');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: opts.sourceLang ?? 'en',
      target: resolveLanguageCode(opts.targetLang, 'google'),
      format: 'text',
    }),
  });
  if (!response.ok) throw new Error(`Google Translate ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { data: { translations: Array<{ translatedText: string }> } }).data.translations[0]?.translatedText ?? text;
}

async function translateAzure(text: string, opts: TranslateRequest): Promise<string> {
  const url = new URL(`${opts.baseUrl.replace(/\/$/, '')}/translate`);
  url.searchParams.set('api-version', '3.0');
  url.searchParams.set('from', opts.sourceLang ?? 'en');
  url.searchParams.set('to', resolveLanguageCode(opts.targetLang, 'azure'));

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': opts.apiKey ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ Text: text }]),
  });
  if (!response.ok) throw new Error(`Azure Translator ${response.status}: ${await response.text()}`);
  return ((await response.json()) as Array<{ translations: Array<{ text: string }> }>)[0]?.translations[0]?.text ?? text;
}

async function translateText(input: TranslateRequest): Promise<TranslateResponse> {
  if (isTextLikelyEncodedForTranslation(input.text)) {
    throw new Error('Translation skipped because the prompt already looks encoded or heavily obfuscated.');
  }

  const resolvedInput: TranslateRequest = {
    ...input,
    apiKey: input.apiKey
      ?? (input.provider === 'deepl'
        ? env.DEEPL_API_KEY
        : input.provider === 'google'
          ? env.GOOGLE_TRANSLATE_API_KEY
          : env.AZURE_TRANSLATOR_API_KEY),
  };

  let translated = input.text;
  switch (resolvedInput.provider) {
    case 'deepl':
      translated = await translateDeepl(input.text, resolvedInput);
      break;
    case 'google':
      translated = await translateGoogle(input.text, resolvedInput);
      break;
    case 'azure':
      translated = await translateAzure(input.text, resolvedInput);
      break;
  }

  return {
    text: translated,
    original: resolvedInput.text,
    sourceLang: resolvedInput.sourceLang ?? 'en',
    targetLang: resolvedInput.targetLang,
    targetLangName: getTargetLanguageName(resolvedInput.targetLang),
    provider: resolvedInput.provider,
  };
}

// Basic hardening middleware:
// - disable x-powered-by
// - apply permissive-but-explicit local CORS rules for dev/demo
// - parse bounded JSON bodies
// - assign a request id and structured start/finish logs
app.disable('x-powered-by');
app.use((req: Request, res: Response, next) => {
  const origin = req.header('origin');
  const allowOrigin = origin ? appEnv === 'dev' || allowedOrigins.includes(origin) : false;

  if (origin && allowOrigin) {
    res.header('access-control-allow-origin', origin);
    res.header('vary', 'Origin');
  }
  res.header('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.header('access-control-allow-headers', 'authorization,content-type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});
app.use(express.json({ limit: '256kb' }));
app.use((req: Request, res: Response, next) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  res.locals.requestId = requestId;

  log('info', 'request_started', {
    requestId,
    method: req.method,
    path: req.path,
  });

  res.on('finish', () => {
    log('info', 'request_finished', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
});

app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: 'counter-spy-backend',
    environment: appEnv,
  });
});

// Firewall intercept route:
// validates input, sanitizes the prompt, and returns a governed decision that the
// frontend can treat as clean, queued, or intercepted without calling a model directly.
app.post('/v1/intercept', (req: Request, res: Response<InterceptResponse | { error: string }>) => {
  if (env.INTERCEPT_BEARER_TOKEN) {
    const authHeader = req.header('authorization');
    if (authHeader !== `Bearer ${env.INTERCEPT_BEARER_TOKEN}`) {
      res.status(401).json({ error: 'Unauthorized intercept request.' });
      return;
    }
  }

  const parsed = InterceptRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid intercept request.' });
    return;
  }

  const requestId = crypto.randomUUID();
  const input = parsed.data;
  const sanitization = sanitizePrompt(input.prompt);

  const baseResponse: Omit<InterceptResponse, 'responder'> = {
    requestId,
    status: sanitization.verdict === 'CLEAN' ? 'CLEAN' : 'INTERCEPTED',
    sanitizedPrompt: sanitization.sanitized,
    detectionFlags: sanitization.detectionFlags,
    safeguards: {
      modelId: safeguardsModelId,
      verdict: sanitization.verdict,
      analystReasoning: sanitization.analystReasoning,
      entropy: sanitization.entropy,
      globalEntropy: sanitization.globalEntropy,
      syntacticScore: sanitization.syntacticScore,
      latencyMs: sanitization.latencyMs,
    },
  };

  if (sanitization.verdict !== 'CLEAN') {
    res.status(403).json(baseResponse);
    return;
  }

  const response: InterceptResponse = {
    ...baseResponse,
    responder: {
      modelId: responderModelId,
      response: 'Counter-Spy.ai backend accepted this clean prompt. Bedrock Nova integration is not wired yet.',
    },
  };

  res.status(200).json(response);
});

// Translation proxy route:
// keeps provider keys on the server side and gives the Playground a single stable
// API shape no matter which translation vendor is in use.
app.post('/v1/translate', async (req: Request, res: Response<TranslateResponse | { error: string }>) => {
  if (env.INTERCEPT_BEARER_TOKEN) {
    const authHeader = req.header('authorization');
    if (authHeader !== `Bearer ${env.INTERCEPT_BEARER_TOKEN}`) {
      res.status(401).json({ error: 'Unauthorized translation request.' });
      return;
    }
  }

  const parsed = TranslateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid translation request.' });
    return;
  }

  try {
    const translation = await translateText(parsed.data);
    res.status(200).json(translation);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation request failed.';
    log('warn', 'translation_failed', {
      requestId: res.locals.requestId,
      provider: parsed.data.provider,
      error: message,
    });
    res.status(502).json({ error: message });
  }
});

// Sam Spade session lifecycle routes:
// create, resume, message, and solve all live here so the future service split can
// lift this surface almost wholesale into its own container later.
app.post('/v1/ctf/sam-spade/session', (req: Request, res: Response<SamSpadeSessionResponse | { error: string }>) => {
  if (!samSpadeConfig.SAM_SPADE_ENABLED) {
    res.status(503).json({ error: 'Sam Spade service is disabled.' });
    return;
  }
  const parsed = SamSpadeCreateSessionRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Sam Spade session request.' });
    return;
  }

  const session = createSamSpadeSession(parsed.data.caseId);
  res.status(201).json({ session });
});

app.get('/v1/ctf/sam-spade/session/:sessionId', (req: Request, res: Response<SamSpadeSessionResponse | { error: string }>) => {
  if (!samSpadeConfig.SAM_SPADE_ENABLED) {
    res.status(503).json({ error: 'Sam Spade service is disabled.' });
    return;
  }
  const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : '';
  const session = getSamSpadeSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Sam Spade session not found.' });
    return;
  }

  res.status(200).json({ session });
});

app.post('/v1/ctf/sam-spade/message', (req: Request, res: Response<SamSpadeMessageResponse | { error: string }>) => {
  if (!samSpadeConfig.SAM_SPADE_ENABLED) {
    res.status(503).json({ error: 'Sam Spade service is disabled.' });
    return;
  }
  const parsed = SamSpadeMessageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Sam Spade message request.' });
    return;
  }

  try {
    const result = submitSamSpadeMessage(parsed.data);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sam Spade message request failed.';
    const status = /not found/i.test(message) ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/v1/ctf/sam-spade/solve', (req: Request, res: Response<SamSpadeSolveResponse | { error: string }>) => {
  if (!samSpadeConfig.SAM_SPADE_ENABLED) {
    res.status(503).json({ error: 'Sam Spade service is disabled.' });
    return;
  }
  const parsed = SamSpadeSolveRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Sam Spade solve request.' });
    return;
  }

  try {
    const result = solveSamSpadeCase(parsed.data);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sam Spade solve request failed.';
    const status = /not found/i.test(message) ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found.' });
});

app.listen(port, '0.0.0.0', () => {
  log('info', 'backend_listening', {
    port,
    safeguardsModelId,
    responderModelId,
    samSpadeEnabled: samSpadeConfig.SAM_SPADE_ENABLED,
    samSpadeStorePath: samSpadeConfig.SAM_SPADE_STORE_PATH,
  });
});

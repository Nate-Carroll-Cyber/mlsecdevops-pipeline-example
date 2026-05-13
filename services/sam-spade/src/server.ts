/**
 * Sam Spade CTF service.
 * Standalone backend for the /v1/ctf/sam-spade/* gameplay surface. Independently
 * deployable so a gateway outage doesn't take the CTF offline. The Counter-Spy
 * gateway 404s these paths; the CTF frontend talks to this service directly.
 */
// IMPORTANT: telemetry must be the first import so OpenTelemetry auto-instrumentation
// can patch Express/http/pg before they are loaded. See @counter-spy/backend-shared/telemetry.
import { TELEMETRY_SERVICE_NAME } from '@counter-spy/backend-shared/telemetry.js';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { trace } from '@opentelemetry/api';
import {
  sanitizeOutput,
  sanitizePrompt,
  type FirewallVerdict,
} from '@counter-spy/backend-shared/security/sanitizer.js';
import { DEFAULT_SAFEGUARD_EFFECTIVE_PROMPT } from '@counter-spy/backend-shared/security/safeguardDefaults.js';
import { assertEgressAllowed } from '@counter-spy/backend-shared/security/urlGuard.js';
import { createRateLimiter } from '@counter-spy/backend-shared/middleware/rateLimit.js';
import {
  createBackendAuthMiddleware,
  getAuthenticatedCallerId,
  type AuthenticatedRequest,
} from '@counter-spy/backend-shared/auth.js';
import { createObservability } from '@counter-spy/backend-shared/observability.js';
import { createSafeguardClient } from '@counter-spy/backend-shared/providers/safeguardClient.js';
import { createResponderClient } from '@counter-spy/backend-shared/providers/responderClient.js';
import {
  DEFAULT_SAM_SPADE_PERSONA_PROMPT,
  DEFAULT_SAM_SPADE_RESPONSE_CONTRACT,
  DEFAULT_SAM_SPADE_SCENARIO_PROMPT,
  LOCAL_INSPECTION_RESPONSE_TEXT,
  LOCAL_RESPONDER_PASSTHROUGH_RESPONSE_TEXT,
} from '@counter-spy/backend-shared/prompts/samSpadeDefaults.js';
import {
  createSamSpadeSession,
  getSamSpadeSession,
  shouldInterceptSamSpadeIntake,
  solveSamSpadeCase,
  submitSamSpadeMessage,
  type SamSpadeReviewArtifact,
  type SamSpadeSessionRecord,
} from './services/sam-spade/index.js';
import { samSpadeConfig } from './services/sam-spade/config.js';

const EnvSchema = z.object({
  APP_ENV: z.enum(['dev', 'test', 'prod']).default('dev'),
  ALLOWED_ORIGINS: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SAFEGUARDS_MODEL_ID: z.string().min(1).default('gpt-5.4-mini'),
  SAFEGUARDS_API_BASE_URL: z.string().url().optional(),
  SAFEGUARDS_API_KEY: z.string().optional(),
  SAFEGUARDS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  RESPONDER_PROVIDER: z.enum(['openai_compatible', 'gemini']).optional(),
  RESPONDER_API_BASE_URL: z.string().url().optional(),
  RESPONDER_API_KEY: z.string().optional(),
  RESPONDER_MODEL_ID: z.string().min(1).default('amazon.nova-micro-v1:0'),
  LLM_API_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL_ID: z.string().optional(),
  INTERCEPT_BEARER_TOKEN: z.string().min(16).optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(0).max(1_000_000).default(120),
  EGRESS_ALLOWLIST: z.string().optional(),
  RESPONDER_OUTPUT_SHIELD_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value.toLowerCase() !== 'false')),
});

const env = EnvSchema.parse(process.env);

if (env.APP_ENV !== 'dev' && !env.INTERCEPT_BEARER_TOKEN) {
  throw new Error('INTERCEPT_BEARER_TOKEN is required outside dev.');
}

const port = samSpadeConfig.SAM_SPADE_SERVICE_PORT;
const appEnv = env.APP_ENV;
const allowedOrigins = (
  env.ALLOWED_ORIGINS ||
  [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'https://app.cyber-spy.ai',
  ].join(',')
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// SSRF egress guard: validate every configurable outbound base URL once at boot
// so a tampered/misconfigured endpoint cannot reach cloud metadata or other
// internal hosts. Loopback/RFC1918 targets are tolerated only in dev/demo.
const egressGuardOptions = {
  allowPrivate: appEnv === 'dev',
  ...(env.EGRESS_ALLOWLIST ? { allowlist: env.EGRESS_ALLOWLIST } : {}),
};
for (const [label, value] of [
  ['SAFEGUARDS_API_BASE_URL', env.SAFEGUARDS_API_BASE_URL],
  ['RESPONDER_API_BASE_URL', env.RESPONDER_API_BASE_URL],
  ['LLM_API_BASE_URL', env.LLM_API_BASE_URL],
] as const) {
  if (value) assertEgressAllowed(value, { ...egressGuardOptions, label });
}

const observability = createObservability({
  telemetryServiceName: TELEMETRY_SERVICE_NAME,
  logServiceName: 'counter-spy-sam-spade-service',
  environment: appEnv,
  minLogLevel: env.LOG_LEVEL,
});
const { log, emitMetricIncrement } = observability;
const requestDurationHistogram = observability.meter.createHistogram('counterspy.http.server.duration', {
  description: 'Counter-Spy sam-spade HTTP request duration.',
  unit: 'ms',
});
const responderLatencyHistogram = observability.meter.createHistogram('counterspy.responder.latency', {
  description: 'Sam Spade responder LLM call latency.',
  unit: 'ms',
});

const safeguardClient = createSafeguardClient(
  {
    baseUrl: env.SAFEGUARDS_API_BASE_URL,
    apiKey: env.SAFEGUARDS_API_KEY,
    modelId: env.SAFEGUARDS_MODEL_ID,
    timeoutMs: env.SAFEGUARDS_TIMEOUT_MS,
  },
  { log },
);
const responderClient = createResponderClient(
  {
    configuredProvider: env.RESPONDER_PROVIDER,
    responderBaseUrl: env.RESPONDER_API_BASE_URL,
    fallbackOpenAiBaseUrl: env.LLM_API_BASE_URL,
    apiKey: env.RESPONDER_API_KEY,
    fallbackApiKey: env.LLM_API_KEY,
    openAiModelId: env.LLM_MODEL_ID || env.RESPONDER_MODEL_ID,
    geminiModelId: 'gemini-2.5-flash',
  },
  { log },
);

const requireBackendAuth = createBackendAuthMiddleware(env.INTERCEPT_BEARER_TOKEN);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-counter-spy-user-id');
    res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use(createRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  // Health checks shouldn't burn rate-limit budget.
  exempt: (req) => req.path === '/healthz',
  onLimited: (req) => emitMetricIncrement('ratelimit.dropped', { path: req.path, method: req.method }),
}));

app.use((req: Request, res: Response, next) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  res.locals.requestId = requestId;
  trace.getActiveSpan()?.setAttribute('counterspy.request_id', requestId);

  log('info', 'request_started', {
    requestId,
    method: req.method,
    path: req.path,
  });

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    requestDurationHistogram.record(durationMs, {
      'http.request.method': req.method,
      'http.route': req.path,
      'http.response.status_code': res.statusCode,
    });
    log('info', 'request_finished', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
});

// Only /healthz and /v1/ctf/sam-spade/* are served by this service. Everything
// else 404s — the gateway owns the rest of the /v1 surface.
app.use((req: Request, res: Response, next) => {
  const isCtfGamePath = req.path === '/v1/ctf/sam-spade' || req.path.startsWith('/v1/ctf/sam-spade/');
  if (!isCtfGamePath && req.path !== '/healthz') {
    res.status(404).json({ error: 'Not found.' });
    return;
  }
  next();
});

app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: 'counter-spy-sam-spade-service',
    environment: appEnv,
    samSpadeEnabled: samSpadeConfig.SAM_SPADE_ENABLED,
  });
});

// Validated request shapes for the four CTF routes.
const SamSpadeCreateSessionRequestSchema = z.object({
  caseId: z.string().min(1).max(200).optional(),
}).strict();

const SamSpadeMetadataSchema = z.object({
  providerLlmRoutingEnabled: z.boolean().optional(),
  responderLlmRoutingEnabled: z.boolean().optional(),
  safeguardEffectivePrompt: z.string().optional(),
  safeguardApiKey: z.string().optional(),
}).strict();

const SamSpadeMessageRequestSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1).max(8000),
  metadata: SamSpadeMetadataSchema.optional(),
  tuning: z.object({
    entropyThreshold: z.coerce.number().min(1).max(8).optional(),
    syntacticThreshold: z.coerce.number().min(0).max(100).optional(),
  }).strict().optional(),
}).strict();

const SamSpadeSolveRequestSchema = z.object({
  sessionId: z.string().min(1),
  theory: z.string().min(1).max(8000),
  metadata: SamSpadeMetadataSchema.optional(),
  tuning: z.object({
    entropyThreshold: z.coerce.number().min(1).max(8).optional(),
    syntacticThreshold: z.coerce.number().min(0).max(100).optional(),
  }).strict().optional(),
}).strict();

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

app.post('/v1/ctf/sam-spade/session', requireBackendAuth, (req: AuthenticatedRequest, res: Response<SamSpadeSessionResponse | { error: string }>) => {
  const callerId = getAuthenticatedCallerId(req, res);
  if (!callerId) return;
  if (!samSpadeConfig.SAM_SPADE_ENABLED) {
    res.status(503).json({ error: 'Sam Spade service is disabled.' });
    return;
  }
  const parsed = SamSpadeCreateSessionRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Sam Spade session request.' });
    return;
  }

  const session = createSamSpadeSession(parsed.data.caseId, callerId);
  res.status(201).json({ session });
});

app.get('/v1/ctf/sam-spade/session/:sessionId', requireBackendAuth, (req: AuthenticatedRequest, res: Response<SamSpadeSessionResponse | { error: string }>) => {
  const callerId = getAuthenticatedCallerId(req, res);
  if (!callerId) return;
  if (!samSpadeConfig.SAM_SPADE_ENABLED) {
    res.status(503).json({ error: 'Sam Spade service is disabled.' });
    return;
  }
  const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : '';
  const session = getSamSpadeSession(sessionId, callerId);
  if (!session) {
    res.status(404).json({ error: 'Sam Spade session not found.' });
    return;
  }

  res.status(200).json({ session });
});

app.post('/v1/ctf/sam-spade/message', requireBackendAuth, async (req: AuthenticatedRequest, res: Response<SamSpadeMessageResponse | { error: string }>) => {
  const callerId = getAuthenticatedCallerId(req, res);
  if (!callerId) return;
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
    const sanitization = sanitizePrompt(parsed.data.prompt, parsed.data.tuning);
    const providerLlmRoutingEnabled = parsed.data.metadata?.providerLlmRoutingEnabled !== false;
    const responderLlmRoutingEnabled =
      providerLlmRoutingEnabled &&
      parsed.data.metadata?.responderLlmRoutingEnabled !== false;
    if (shouldInterceptSamSpadeIntake(sanitization)) {
      const result = submitSamSpadeMessage({ ...parsed.data, ownerUserId: callerId });
      res.status(200).json(result);
      return;
    }

    if (!providerLlmRoutingEnabled) {
      const result = submitSamSpadeMessage({
        ...parsed.data,
        ownerUserId: callerId,
        npcResponse: LOCAL_INSPECTION_RESPONSE_TEXT,
        responderTelemetry: {
          promptProfile: 'sam_spade_ctf',
          modelId: 'local-inspection',
          status: 'DISABLED_LOCAL_ONLY',
          latencyMs: 0,
        },
      });
      res.status(200).json(result);
      return;
    }

    // The Sam Spade CTF frontend doesn't share the Analyst Chat console's
    // effective-prompt state, so it sends no metadata. Fall back to the
    // backend's DEFAULT_SAFEGUARD_EFFECTIVE_PROMPT so the CTF can still get a
    // safeguard verdict. The analyst-chat parent window forwards the
    // operator-supplied safeguardApiKey to the CTF iframe via postMessage;
    // the CTF echoes it back here as metadata.safeguardApiKey so the
    // safeguard client can authenticate against LM Studio (or whichever
    // upstream the safeguard targets).
    const safeguardResult = await safeguardClient.generateSafeguardVerdict(
      sanitization.sanitized,
      sanitization,
      {
        systemPrompt: parsed.data.metadata?.safeguardEffectivePrompt && parsed.data.metadata.safeguardEffectivePrompt.length > 0
          ? parsed.data.metadata.safeguardEffectivePrompt
          : DEFAULT_SAFEGUARD_EFFECTIVE_PROMPT,
        ...(parsed.data.metadata?.safeguardApiKey ? { apiKey: parsed.data.metadata.safeguardApiKey } : {}),
      },
    );
    if (safeguardResult.verdict !== 'CLEAN') {
      const result = submitSamSpadeMessage({
        ...parsed.data,
        ownerUserId: callerId,
        externalVerdict: safeguardResult.verdict,
        externalReasoning: safeguardResult.analystReasoning,
      });
      res.status(200).json(result);
      return;
    }

    if (!responderLlmRoutingEnabled) {
      const result = submitSamSpadeMessage({
        ...parsed.data,
        ownerUserId: callerId,
        npcResponse: LOCAL_RESPONDER_PASSTHROUGH_RESPONSE_TEXT,
        responderTelemetry: {
          promptProfile: 'sam_spade_ctf',
          modelId: 'local-responder-passthrough',
          status: 'DISABLED_LOCAL_ONLY',
          latencyMs: 0,
        },
      });
      res.status(200).json(result);
      return;
    }

    const samSpadeResponderSystemPrompt = [
      `### Sam Spade Persona\n${DEFAULT_SAM_SPADE_PERSONA_PROMPT}`,
      `### Active Sam Spade Scenario\n${DEFAULT_SAM_SPADE_SCENARIO_PROMPT}`,
      `### Sam Spade Response Contract\n${DEFAULT_SAM_SPADE_RESPONSE_CONTRACT}`,
    ].filter(Boolean).join('\n\n');
    const responderResult = await responderClient.generateResponderOutput(
      sanitization.sanitized,
      samSpadeResponderSystemPrompt,
    );
    responderLatencyHistogram.record(responderResult.latencyMs, { provider: responderResult.provider, route: 'sam_spade' });
    // Output-side Shield: if Sam Spade's reply carries secrets/PII or echoes
    // blocked policy keywords, withhold the turn and queue it for review rather
    // than letting the leaked text into the noir transcript.
    const outputShield = env.RESPONDER_OUTPUT_SHIELD_ENABLED ? sanitizeOutput(responderResult.response) : undefined;
    if (outputShield?.tripped) {
      emitMetricIncrement('responder.output_redacted', { route: 'sam_spade', highRisk: outputShield.highRiskLeak });
      log('warn', 'responder_output_shield_tripped', {
        requestId: res.locals.requestId,
        route: 'sam_spade',
        highRiskLeak: outputShield.highRiskLeak,
        detectionFlags: outputShield.detectionFlags,
      });
      const verdict: FirewallVerdict = 'ADVERSARIAL';
      const result = submitSamSpadeMessage({
        ...parsed.data,
        ownerUserId: callerId,
        externalVerdict: verdict,
        externalReasoning: `Sam Spade responder output tripped the output Shield (${outputShield.detectionFlags.join(', ') || 'sensitive content'}); turn withheld pending analyst review.`,
      });
      res.status(200).json(result);
      return;
    }
    const result = submitSamSpadeMessage({
      ...parsed.data,
      ownerUserId: callerId,
      npcResponse: responderResult.response,
      responderTelemetry: {
        promptProfile: 'sam_spade_ctf',
        provider: responderResult.provider,
        modelId: responderResult.modelId,
        status: 'COMPLETED',
        latencyMs: responderResult.latencyMs,
      },
    });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sam Spade message request failed.';
    const status = /access denied/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/v1/ctf/sam-spade/solve', requireBackendAuth, (req: AuthenticatedRequest, res: Response<SamSpadeSolveResponse | { error: string }>) => {
  const callerId = getAuthenticatedCallerId(req, res);
  if (!callerId) return;
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
    const result = solveSamSpadeCase({ ...parsed.data, ownerUserId: callerId });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sam Spade solve request failed.';
    const status = /access denied/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found.' });
});

export { app };

if (process.env.COUNTER_SPY_DISABLE_SERVER_LISTEN !== 'true') {
  app.listen(port, '0.0.0.0', () => {
    log('info', 'sam_spade_listening', {
      port,
      samSpadeEnabled: samSpadeConfig.SAM_SPADE_ENABLED,
      samSpadeStorePath: samSpadeConfig.SAM_SPADE_STORE_PATH,
    });
  });
}

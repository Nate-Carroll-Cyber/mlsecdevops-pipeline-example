import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

process.env.COUNTER_SPY_DISABLE_SERVER_LISTEN = 'true';
process.env.APP_ENV = 'dev';
process.env.INTERCEPT_BEARER_TOKEN = 'test-route-token-12345';
delete process.env.SAFEGUARDS_API_KEY;
delete process.env.RESPONDER_API_BASE_URL;
delete process.env.RESPONDER_API_KEY;
delete process.env.LLM_API_BASE_URL;
delete process.env.LLM_API_KEY;
delete process.env.LARA_ACCESS_KEY_ID;
delete process.env.LARA_ACCESS_KEY_SECRET;
delete process.env.LARA_API_BASE_URL;

const safeguardRequests: unknown[] = [];
const safeguardRequestHeaders: Array<Record<string, string | string[] | undefined>> = [];
const safeguardMockServer = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    safeguardRequests.push(body ? JSON.parse(body) : undefined);
    safeguardRequestHeaders.push({ ...req.headers });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: 'CLEAN',
              analystReasoning: 'Test safeguard allowed prompt.',
            }),
          },
        },
      ],
    }));
  });
});
await new Promise<void>((resolve) => safeguardMockServer.listen(0, '127.0.0.1', resolve));
const safeguardAddress = safeguardMockServer.address();
assert.ok(safeguardAddress && typeof safeguardAddress === 'object');
process.env.SAFEGUARDS_API_BASE_URL = `http://127.0.0.1:${safeguardAddress.port}/v1`;

const { app, resolveSafeguardJudgeInstructions } = await import('../src/server.ts');

after(async () => {
  await new Promise<void>((resolve, reject) => {
    safeguardMockServer.close((error) => error ? reject(error) : resolve());
  });
});

async function requestApp(path: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
} = {}): Promise<{ status: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = options.method ?? 'GET';
    req.url = path;
    req.headers = Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    );

    const chunks: Buffer[] = [];
    const res = new ServerResponse(req);
    const originalWriteHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
    res.writeHead = ((statusCode: number, ...args: unknown[]) => {
      res.statusCode = statusCode;
      return originalWriteHead(statusCode, ...args);
    }) as typeof res.writeHead;
    res.write = ((chunk: unknown) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    }) as typeof res.write;
    res.end = ((chunk?: unknown) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        resolve({
          status: res.statusCode,
          payload: body ? JSON.parse(body) : undefined,
        });
      } catch (error) {
        reject(error);
      }
      return res;
    }) as typeof res.end;

    const rawBody = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (rawBody !== undefined) {
      req.headers['content-length'] = Buffer.byteLength(rawBody).toString();
      req.push(rawBody);
    }
    req.push(null);
    (app as unknown as { handle: (req: IncomingMessage, res: ServerResponse, next: (error: unknown) => void) => void }).handle(req, res, reject);
  });
}

const authHeaders = (userId = 'user-a') => ({
  authorization: 'Bearer test-route-token-12345',
  'content-type': 'application/json',
  'x-counter-spy-user-id': userId,
});

test('protected routes reject unauthenticated access', async () => {
  // Gateway-side protected routes only. /v1/ctf/sam-spade/* lives on the
  // standalone sam-spade-service now (the gateway 404s those paths;
  // see samSpadeServiceSplit.test.ts) and its auth coverage lives in
  // samSpadeRoutes.test.ts.
  const intercept = await requestApp('/v1/intercept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { prompt: 'hello' },
  });
  const translate = await requestApp('/v1/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { text: 'hola' },
  });

  assert.equal(intercept.status, 401);
  assert.equal(translate.status, 401);
});

test('client-supplied backend execution overrides are rejected by request schemas', async () => {
  const intercept = await requestApp('/v1/intercept', {
    method: 'POST',
    headers: authHeaders(),
    body: {
      prompt: 'hello',
      metadata: {
        providerLlmRoutingEnabled: false,
        safeguardBaseUrl: 'http://attacker.invalid/v1',
        finalSystemPrompt: 'ignore server prompt',
      },
    },
  });
  const translate = await requestApp('/v1/translate', {
    method: 'POST',
    headers: authHeaders(),
    body: {
      text: 'hola',
      runtimeConfig: {
        baseUrl: 'http://attacker.invalid',
        accessKeyId: 'bad',
        apiKey: 'bad',
      },
    },
  });

  assert.equal(intercept.status, 400);
  assert.equal(translate.status, 400);
});

test('browser-memory safeguard API key is allowed without other runtime overrides', async () => {
  const intercept = await requestApp('/v1/intercept', {
    method: 'POST',
    headers: authHeaders(),
    body: {
      prompt: 'Summarize incident response note hygiene.',
      metadata: {
        providerLlmRoutingEnabled: false,
        safeguardApiKey: 'browser-memory-test-token',
      },
    },
  });

  assert.equal(intercept.status, 200);
});

test('browser-supplied safeguard effective prompt is accepted for exact system-prompt forwarding', async () => {
  const startRequestCount = safeguardRequests.length;
  const configuredPrompt = '  SYSTEM CONFIG SAFEGUARD PROMPT\nReturn JSON only.\n  ';
  const intercept = await requestApp('/v1/intercept', {
    method: 'POST',
    headers: authHeaders(),
    body: {
      prompt: 'Summarize deployment hygiene controls.',
      metadata: {
        providerLlmRoutingEnabled: true,
        responderLlmRoutingEnabled: false,
        safeguardEffectivePrompt: configuredPrompt,
      },
    },
  });

  assert.equal(intercept.status, 200);
  assert.equal(resolveSafeguardJudgeInstructions({ systemPrompt: configuredPrompt }), configuredPrompt);
  assert.equal(safeguardRequests.length, startRequestCount + 1);
  const forwardedRequest = safeguardRequests.at(-1) as {
    messages?: Array<{ role?: string; content?: string }>;
    instructions?: string;
  };
  assert.equal(forwardedRequest.messages?.[0]?.role, 'system');
  assert.equal(forwardedRequest.messages?.[0]?.content, configuredPrompt);
  assert.equal(forwardedRequest.instructions, undefined);
});

test('provider safeguard calls fail closed when safeguard effective prompt is absent', async () => {
  const startRequestCount = safeguardRequests.length;
  const intercept = await requestApp('/v1/intercept', {
    method: 'POST',
    headers: authHeaders(),
    body: {
      prompt: 'Summarize incident response note hygiene.',
      metadata: {
        providerLlmRoutingEnabled: true,
        responderLlmRoutingEnabled: false,
      },
    },
  });

  assert.equal(intercept.status, 202);
  assert.equal((intercept.payload as { status?: string }).status, 'SHIELD_ERROR');
  assert.equal(safeguardRequests.length, startRequestCount);
});

test('translation fails closed when backend Lara configuration is missing', async () => {
  const response = await requestApp('/v1/translate', {
    method: 'POST',
    headers: authHeaders(),
    body: { text: 'hola', provider: 'lara' },
  });
  const payload = response.payload as { error?: string };

  assert.equal(response.status, 502);
  assert.match(payload.error ?? '', /Lara Translate is not configured/);
});

// Sam Spade route coverage moved to backend/test/samSpadeRoutes.test.ts when
// the CTF surface was network-split off the gateway.

test('/v1/metrics/aggregate rejects unauthenticated requests', async () => {
  // Phase 3 step 3: the metrics-aggregate endpoint runs the moved analytics
  // modules (anomalyDetector + metrics) over the Postgres audit-log store.
  // It must be auth-gated like every other /v1/* protected route. The audit
  // store isn't configured in this test (no AUDIT_DATABASE_URL/DATABASE_URL/
  // INSTRUCTION_MONITOR_DATABASE_URL set in the test bootstrap), so an
  // authenticated request returns 503 — also covered here.
  const noAuth = await requestApp('/v1/metrics/aggregate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {},
  });
  assert.equal(noAuth.status, 401);

  const unconfigured = await requestApp('/v1/metrics/aggregate', {
    method: 'POST',
    headers: authHeaders(),
    body: {},
  });
  assert.equal(unconfigured.status, 503);
  assert.match((unconfigured.payload as { error?: string }).error ?? '', /Audit log store is not configured/);
});

test('/v1/metrics/aggregate validates the request body', async () => {
  const badBody = await requestApp('/v1/metrics/aggregate', {
    method: 'POST',
    headers: authHeaders(),
    // Out-of-range entropyThreshold (schema clamps to [3, 4.6]).
    body: { entropyThreshold: 12 },
  });
  // 400 short-circuits before the audit-store check, so we see the schema
  // rejection even without DB config.
  assert.equal(badBody.status, 400);
  assert.match((badBody.payload as { error?: string }).error ?? '', /Invalid metrics aggregate request/);
});

test('/v1/governance rejects unauthenticated GET + PUT', async () => {
  // Phase 3 step 4: governance config moved from Firestore to Postgres-backed
  // app_config. Both reads and writes must be auth-gated like the rest of /v1.
  const getNoAuth = await requestApp('/v1/governance', { method: 'GET' });
  assert.equal(getNoAuth.status, 401);

  const putNoAuth = await requestApp('/v1/governance', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: { isHitlActive: false, isGlobalPause: false, entropyThreshold: 4.0, syntacticThreshold: 65 },
  });
  assert.equal(putNoAuth.status, 401);
});

test('/v1/governance returns 503 when the config store is not configured', async () => {
  // The test bootstrap doesn't set APP_CONFIG_DATABASE_URL/DATABASE_URL/
  // INSTRUCTION_MONITOR_DATABASE_URL, so an authenticated request 503s with
  // a clear message.
  const get = await requestApp('/v1/governance', { method: 'GET', headers: authHeaders() });
  assert.equal(get.status, 503);
  assert.match((get.payload as { error?: string }).error ?? '', /App config store is not configured/);

  const put = await requestApp('/v1/governance', {
    method: 'PUT',
    headers: authHeaders(),
    body: { isHitlActive: false, isGlobalPause: false, entropyThreshold: 4.0, syntacticThreshold: 65 },
  });
  assert.equal(put.status, 503);
  assert.match((put.payload as { error?: string }).error ?? '', /App config store is not configured/);
});

test('/v1/governance PUT validates the body shape', async () => {
  // Body validation runs before the store check (matching /v1/metrics/aggregate),
  // so out-of-range thresholds always 400 even when the store is unconfigured.
  const tooHighEntropy = await requestApp('/v1/governance', {
    method: 'PUT',
    headers: authHeaders(),
    body: { isHitlActive: false, isGlobalPause: false, entropyThreshold: 99, syntacticThreshold: 65 },
  });
  assert.equal(tooHighEntropy.status, 400);
  assert.match((tooHighEntropy.payload as { error?: string }).error ?? '', /Invalid governance config/);

  const missingField = await requestApp('/v1/governance', {
    method: 'PUT',
    headers: authHeaders(),
    body: { isHitlActive: false, entropyThreshold: 4.0, syntacticThreshold: 65 },
  });
  assert.equal(missingField.status, 400);
});

test('/v1/system-config rejects unauthenticated GET + PUT', async () => {
  // Phase 3 step 4: system config moved from Firestore to the shared
  // Postgres app_config table.
  const getNoAuth = await requestApp('/v1/system-config', { method: 'GET' });
  assert.equal(getNoAuth.status, 401);

  const putNoAuth = await requestApp('/v1/system-config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: {
      safeguardEffectivePromptOverride: '', firewallPrompt: '', responderPrompt: '',
      samSpadePersonaPrompt: '', samSpadeScenarioPrompt: '', guardrailsPolicy: '',
      blockedKeywords: '', forbiddenTopics: '', regexRules: '',
    },
  });
  assert.equal(putNoAuth.status, 401);
});

test('/v1/system-config returns 503 when the config store is unconfigured', async () => {
  const get = await requestApp('/v1/system-config', { method: 'GET', headers: authHeaders() });
  assert.equal(get.status, 503);
  assert.match((get.payload as { error?: string }).error ?? '', /App config store is not configured/);

  const put = await requestApp('/v1/system-config', {
    method: 'PUT',
    headers: authHeaders(),
    body: {
      safeguardEffectivePromptOverride: '', firewallPrompt: '', responderPrompt: '',
      samSpadePersonaPrompt: '', samSpadeScenarioPrompt: '', guardrailsPolicy: '',
      blockedKeywords: '', forbiddenTopics: '', regexRules: '',
    },
  });
  assert.equal(put.status, 503);
});

test('/v1/system-config PUT validates the body shape', async () => {
  // Body validation runs before the store check (matches /v1/governance pattern).
  const missingField = await requestApp('/v1/system-config', {
    method: 'PUT',
    headers: authHeaders(),
    // Missing safeguardEffectivePromptOverride + several others.
    body: { firewallPrompt: 'x', guardrailsPolicy: 'y' },
  });
  assert.equal(missingField.status, 400);
  assert.match((missingField.payload as { error?: string }).error ?? '', /Invalid system config/);

  const wrongType = await requestApp('/v1/system-config', {
    method: 'PUT',
    headers: authHeaders(),
    body: {
      safeguardEffectivePromptOverride: 'a', firewallPrompt: 'b', responderPrompt: 'c',
      samSpadePersonaPrompt: 'd', samSpadeScenarioPrompt: 'e', guardrailsPolicy: 'f',
      blockedKeywords: 'g', forbiddenTopics: 'h', regexRules: 42, // number where string expected
    },
  });
  assert.equal(wrongType.status, 400);
});

// Sam Spade safeguard-api-key forwarding + default-prompt fallback tests moved
// to backend/test/samSpadeRoutes.test.ts when the CTF surface was network-split
// off the gateway.

/**
 * Route-level integration tests for the standalone sam-spade-service.
 *
 * These tests used to live in securityRoutes.test.ts when the gateway also
 * served the CTF surface in-process. Post network split (the gateway 404s
 * /v1/ctf/sam-spade/* now), they boot server.ts with COUNTER_SPY_ROLE=sam-spade
 * so the CTF route handlers register and can be exercised in-process here.
 *
 * Covered:
 *  - Session ownership / cross-user 403/404 (the per-caller scoping the service
 *    enforces on read + message).
 *  - metadata.safeguardApiKey is forwarded to the safeguard upstream as the
 *    bearer (the cross-frame Runtime Settings bridge).
 *  - When the CTF browser sends no metadata.safeguardEffectivePrompt, the
 *    route falls back to DEFAULT_SAFEGUARD_EFFECTIVE_PROMPT (the analyst chat
 *    /v1/intercept path stays strict; that's tested in securityRoutes.test.ts).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

process.env.COUNTER_SPY_DISABLE_SERVER_LISTEN = 'true';
process.env.APP_ENV = 'dev';
process.env.INTERCEPT_BEARER_TOKEN = 'sam-spade-route-token-12345';
process.env.COUNTER_SPY_ROLE = 'sam-spade';
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
            content: JSON.stringify({ verdict: 'CLEAN', analystReasoning: 'Test safeguard allowed prompt.' }),
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

const { app } = await import('../src/server.ts');

after(async () => {
  await new Promise<void>((resolve, reject) => safeguardMockServer.close((error) => (error ? reject(error) : resolve())));
});

async function requestApp(path: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = options.method ?? 'GET';
    req.url = path;
    req.headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const chunks: Buffer[] = [];
    const res = new ServerResponse(req);
    const originalWriteHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
    res.writeHead = ((statusCode: number, ...args: unknown[]) => { res.statusCode = statusCode; return originalWriteHead(statusCode, ...args); }) as typeof res.writeHead;
    res.write = ((chunk: unknown) => { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true; }) as typeof res.write;
    res.end = ((chunk?: unknown) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      const body = Buffer.concat(chunks).toString('utf8');
      try { resolve({ status: res.statusCode, payload: body ? JSON.parse(body) : undefined }); } catch (error) { reject(error); }
      return res;
    }) as typeof res.end;
    const rawBody = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (rawBody !== undefined) { req.headers['content-length'] = Buffer.byteLength(rawBody).toString(); req.push(rawBody); }
    req.push(null);
    (app as unknown as { handle: (req: IncomingMessage, res: ServerResponse, next: (error: unknown) => void) => void }).handle(req, res, reject);
  });
}

const authHeaders = (userId = 'user-a') => ({
  authorization: 'Bearer sam-spade-route-token-12345',
  'content-type': 'application/json',
  'x-counter-spy-user-id': userId,
});

test('sam-spade-service: /v1/ctf/sam-spade/session rejects unauthenticated requests', async () => {
  const response = await requestApp('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { caseId: 'case-067' },
  });
  assert.equal(response.status, 401);
});

test('sam-spade-service: sessions are scoped to the authenticated caller', async () => {
  const created = await requestApp('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: authHeaders('user-a'),
    body: { caseId: 'case-067' },
  });
  assert.equal(created.status, 201);
  const createdPayload = created.payload as { session: { sessionId: string; ownerUserId: string } };
  assert.equal(createdPayload.session.ownerUserId, 'user-a');

  const sameUserFetch = await requestApp(`/v1/ctf/sam-spade/session/${createdPayload.session.sessionId}`, {
    headers: authHeaders('user-a'),
  });
  const crossUserFetch = await requestApp(`/v1/ctf/sam-spade/session/${createdPayload.session.sessionId}`, {
    headers: authHeaders('user-b'),
  });
  const crossUserMessage = await requestApp('/v1/ctf/sam-spade/message', {
    method: 'POST',
    headers: authHeaders('user-b'),
    body: {
      sessionId: createdPayload.session.sessionId,
      prompt: 'What happened at the hotel?',
      metadata: { providerLlmRoutingEnabled: false },
    },
  });

  assert.equal(sameUserFetch.status, 200);
  assert.equal(crossUserFetch.status, 404);
  assert.equal(crossUserMessage.status, 403);
});

test('sam-spade-service: message route forwards a metadata.safeguardApiKey as the upstream bearer', async () => {
  // The analyst-chat parent window postMessages its Runtime Settings
  // safeguardApiKey into the CTF iframe; the CTF echoes it back as
  // metadata.safeguardApiKey. The service must use it as the LM Studio
  // (or whichever safeguard upstream) bearer instead of falling back to
  // env.SAFEGUARDS_API_KEY (which isn't set in this test).
  const session = await requestApp('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: authHeaders('ctf-key-user'),
    body: { caseId: 'case-067' },
  });
  assert.equal(session.status, 201);
  const sessionId = (session.payload as { session: { sessionId: string } }).session.sessionId;

  const startRequestCount = safeguardRequests.length;
  const ctfSafeguardToken = 'ctf-supplied-safeguard-token-abc123';
  const message = await requestApp('/v1/ctf/sam-spade/message', {
    method: 'POST',
    headers: authHeaders('ctf-key-user'),
    body: {
      sessionId,
      prompt: 'Did the witness recognize the locksmith?',
      metadata: { safeguardApiKey: ctfSafeguardToken },
    },
  });

  assert.equal(message.status, 200);
  assert.equal(safeguardRequests.length, startRequestCount + 1);
  const forwardedHeaders = safeguardRequestHeaders.at(-1);
  assert.equal(forwardedHeaders?.authorization, `Bearer ${ctfSafeguardToken}`);
});

test('sam-spade-service: message route falls back to DEFAULT_SAFEGUARD_EFFECTIVE_PROMPT when metadata is absent', async () => {
  // The CTF iframe doesn't share state with the Analyst Chat console and sends
  // no metadata.safeguardEffectivePrompt; the route must still get a safeguard
  // verdict by falling back to the backend's hardcoded default rubric.
  const { DEFAULT_SAFEGUARD_EFFECTIVE_PROMPT } = await import('@counter-spy/backend-shared/security/safeguardDefaults.js');

  const session = await requestApp('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: authHeaders('ctf-user'),
    body: { caseId: 'case-067' },
  });
  assert.equal(session.status, 201);
  const sessionId = (session.payload as { session: { sessionId: string } }).session.sessionId;

  const startRequestCount = safeguardRequests.length;
  const message = await requestApp('/v1/ctf/sam-spade/message', {
    method: 'POST',
    headers: authHeaders('ctf-user'),
    body: {
      sessionId,
      prompt: 'What did the witness see in the alley?',
      // Note: no `metadata` field at all — this is the real CTF browser shape.
    },
  });

  assert.equal(message.status, 200);
  assert.equal(safeguardRequests.length, startRequestCount + 1);
  const forwarded = safeguardRequests.at(-1) as { messages?: Array<{ role?: string; content?: string }> };
  assert.equal(forwarded.messages?.[0]?.role, 'system');
  assert.equal(forwarded.messages?.[0]?.content, DEFAULT_SAFEGUARD_EFFECTIVE_PROMPT);
});

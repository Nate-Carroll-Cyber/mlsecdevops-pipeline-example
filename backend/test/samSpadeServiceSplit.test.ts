/**
 * Verifies the COUNTER_SPY_ROLE network split:
 *  - the gateway 404s every /v1/ctf/sam-spade/* request (no reverse-proxy: the
 *    standalone sam-spade-service is now directly addressable, and the CTF
 *    frontend's vite proxy routes those requests to it without the gateway in
 *    the path);
 *  - /v1/ctf/review-artifacts stays on the gateway (the analyst console reads
 *    that feed; CTF turns POST artifacts here).
 *
 * The standalone-service mode (COUNTER_SPY_ROLE=sam-spade) is exercised by the
 * unit-level Sam Spade tests plus the route registration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

process.env.COUNTER_SPY_DISABLE_SERVER_LISTEN = 'true';
process.env.APP_ENV = 'dev';
process.env.INTERCEPT_BEARER_TOKEN = 'split-test-token-1234567';
delete process.env.SAFEGUARDS_API_BASE_URL;
delete process.env.SAFEGUARDS_API_KEY;
delete process.env.RESPONDER_API_BASE_URL;
delete process.env.RESPONDER_API_KEY;
delete process.env.LLM_API_BASE_URL;
delete process.env.LLM_API_KEY;
process.env.COUNTER_SPY_ROLE = 'gateway';

const { app } = await import('../src/server.ts');

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

test('gateway 404s authenticated CTF game-surface requests (no reverse-proxy)', async () => {
  const response = await requestApp('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: {
      authorization: 'Bearer split-test-token-1234567',
      'content-type': 'application/json',
      'x-counter-spy-user-id': 'user-z',
    },
    body: { caseId: 'case-067' },
  });
  assert.equal(response.status, 404);
  assert.match((response.payload as { error?: string }).error ?? '', /standalone sam-spade-service/);
});

test('gateway 404s unauthenticated CTF requests too (path-level rejection wins over auth)', async () => {
  const response = await requestApp('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { caseId: 'case-067' },
  });
  // The role-aware gate runs before requireBackendAuth on this path; the
  // gateway just doesn't serve CTF anymore, so we 404 without leaking that
  // an authenticated request would have been valid.
  assert.equal(response.status, 404);
});

test('non-CTF routes on the gateway are unaffected', async () => {
  const health = await requestApp('/healthz');
  assert.equal(health.status, 200);
  assert.equal((health.payload as { service?: string }).service, 'counter-spy-backend');
});

test('review-artifact feed stays on the gateway: POST stores, GET returns (with since/limit filtering)', async () => {
  const auth = { authorization: 'Bearer split-test-token-1234567', 'content-type': 'application/json' };
  const baseArtifact = {
    requestId: 'art-1',
    sessionId: 's1',
    source: 'ctf_chat' as const,
    action: 'message' as const,
    timestamp: '2026-05-12T10:00:00.000Z',
    sanitizedPrompt: 'What did the witness see?',
    detectionFlags: [],
    entropy: 3.1,
    globalEntropy: 3.0,
    suspiciousChunks: [],
    detectionLevel: 'Clean' as const,
    escalationRecommended: false,
    response: 'A switch, maybe. Hard to say.',
    analystReasoning: 'clean',
    latencyMs: 5,
    decodeTelemetry: 'plain_text' as const,
    status: 'REVIEWED' as const,
  };

  const post1 = await requestApp('/v1/ctf/review-artifacts', { method: 'POST', headers: auth, body: { artifact: baseArtifact } });
  assert.equal(post1.status, 202);
  const post2 = await requestApp('/v1/ctf/review-artifacts', {
    method: 'POST',
    headers: auth,
    body: { artifact: { ...baseArtifact, requestId: 'art-2', timestamp: '2026-05-12T11:00:00.000Z', detectionLevel: 'Adversarial', escalationRecommended: true, status: 'PENDING_REVIEW', response: 'Bad content.' } },
  });
  assert.equal(post2.status, 202);

  const all = await requestApp('/v1/ctf/review-artifacts', { headers: auth });
  assert.equal(all.status, 200);
  const artifacts = (all.payload as { artifacts: Array<{ requestId: string }> }).artifacts;
  assert.ok(artifacts.some((a) => a.requestId === 'art-1'));
  assert.ok(artifacts.some((a) => a.requestId === 'art-2'));

  const since = await requestApp('/v1/ctf/review-artifacts?sinceTimestamp=2026-05-12T10:30:00.000Z', { headers: auth });
  const sinceArtifacts = (since.payload as { artifacts: Array<{ requestId: string }> }).artifacts;
  assert.ok(sinceArtifacts.every((a) => a.requestId !== 'art-1'));
  assert.ok(sinceArtifacts.some((a) => a.requestId === 'art-2'));

  const rejected = await requestApp('/v1/ctf/review-artifacts', { method: 'POST', headers: auth, body: { artifact: { requestId: 'bad' } } });
  assert.equal(rejected.status, 400);

  const unauth = await requestApp('/v1/ctf/review-artifacts', { headers: { 'content-type': 'application/json' } });
  assert.equal(unauth.status, 401);
});

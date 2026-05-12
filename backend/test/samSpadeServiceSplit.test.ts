/**
 * Verifies the COUNTER_SPY_ROLE / SAM_SPADE_SERVICE_URL split:
 *  - a gateway with SAM_SPADE_SERVICE_URL set reverse-proxies /v1/ctf/sam-spade/*
 *    to the standalone service (and still 401s unauthenticated requests at the edge);
 *  - other routes on the gateway are untouched.
 *
 * The standalone-service mode (COUNTER_SPY_ROLE=sam-spade) is exercised by the
 * unit-level Sam Spade tests plus the route registration; here we only need the
 * gateway proxy behavior.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
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

const forwarded: Array<{ method: string; url: string; auth?: string; callerId?: string; body: unknown }> = [];
const samSpadeMock = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    forwarded.push({
      method: req.method ?? '',
      url: req.url ?? '',
      auth: req.headers.authorization,
      callerId: typeof req.headers['x-counter-spy-user-id'] === 'string' ? req.headers['x-counter-spy-user-id'] : undefined,
      body: raw ? JSON.parse(raw) : undefined,
    });
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ session: { sessionId: 'proxied-session', caseId: 'case-067', status: 'ACTIVE' } }));
  });
});
await new Promise<void>((resolve) => samSpadeMock.listen(0, '127.0.0.1', resolve));
const mockAddress = samSpadeMock.address();
assert.ok(mockAddress && typeof mockAddress === 'object');
process.env.COUNTER_SPY_ROLE = 'gateway';
process.env.SAM_SPADE_SERVICE_URL = `http://127.0.0.1:${mockAddress.port}`;

const { app } = await import('../src/server.ts');

after(async () => {
  await new Promise<void>((resolve, reject) => samSpadeMock.close((error) => (error ? reject(error) : resolve())));
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

test('gateway with SAM_SPADE_SERVICE_URL proxies CTF requests to the standalone service', async () => {
  const before = forwarded.length;
  const response = await requestApp('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: {
      authorization: 'Bearer split-test-token-1234567',
      'content-type': 'application/json',
      'x-counter-spy-user-id': 'user-z',
    },
    body: { caseId: 'case-067' },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(response.payload, { session: { sessionId: 'proxied-session', caseId: 'case-067', status: 'ACTIVE' } });
  assert.equal(forwarded.length, before + 1);
  const last = forwarded.at(-1);
  assert.equal(last?.method, 'POST');
  assert.equal(last?.url, '/v1/ctf/sam-spade/session');
  assert.equal(last?.auth, 'Bearer split-test-token-1234567');
  assert.equal(last?.callerId, 'user-z');
  assert.deepEqual(last?.body, { caseId: 'case-067' });
});

test('gateway proxy rejects unauthenticated CTF requests at the edge (no forward)', async () => {
  const before = forwarded.length;
  const response = await requestApp('/v1/ctf/sam-spade/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { caseId: 'case-067' },
  });
  assert.equal(response.status, 401);
  assert.equal(forwarded.length, before);
});

test('non-CTF routes on a delegating gateway are unaffected', async () => {
  const health = await requestApp('/healthz');
  assert.equal(health.status, 200);
  assert.equal((health.payload as { service?: string }).service, 'counter-spy-backend');
});

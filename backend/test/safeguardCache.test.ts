/**
 * Verifies the opt-in safeguard-verdict cache (SAFEGUARD_CACHE_TTL_MS):
 *  - identical prompts hit the safeguard LLM once, then serve from cache;
 *  - a different prompt is a cache miss (hits the LLM again).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

process.env.COUNTER_SPY_DISABLE_SERVER_LISTEN = 'true';
process.env.APP_ENV = 'dev';
process.env.INTERCEPT_BEARER_TOKEN = 'cache-test-token-1234567';
process.env.SAFEGUARD_CACHE_TTL_MS = '60000';
delete process.env.RESPONDER_API_BASE_URL;
delete process.env.RESPONDER_API_KEY;
delete process.env.LLM_API_BASE_URL;
delete process.env.LLM_API_KEY;
delete process.env.SAFEGUARDS_API_KEY;

let safeguardCallCount = 0;
const safeguardMock = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(Buffer.from(c)));
  req.on('end', () => {
    safeguardCallCount += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: 'CLEAN', analystReasoning: 'cache test allowed.' }) } }] }));
  });
});
await new Promise<void>((resolve) => safeguardMock.listen(0, '127.0.0.1', resolve));
const addr = safeguardMock.address();
assert.ok(addr && typeof addr === 'object');
process.env.SAFEGUARDS_API_BASE_URL = `http://127.0.0.1:${addr.port}/v1`;

const { app } = await import('../src/server.ts');

after(async () => {
  await new Promise<void>((resolve, reject) => safeguardMock.close((e) => (e ? reject(e) : resolve())));
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

const headers = { authorization: 'Bearer cache-test-token-1234567', 'content-type': 'application/json' };
const body = (prompt: string) => ({
  prompt,
  metadata: { providerLlmRoutingEnabled: true, responderLlmRoutingEnabled: false, safeguardEffectivePrompt: 'CACHE TEST SAFEGUARD PROMPT\nReturn JSON only.' },
});

test('identical safeguard requests hit the LLM once and then serve from cache', async () => {
  const before = safeguardCallCount;
  const first = await requestApp('/v1/intercept', { method: 'POST', headers, body: body('Summarize incident response hygiene controls.') });
  const second = await requestApp('/v1/intercept', { method: 'POST', headers, body: body('Summarize incident response hygiene controls.') });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(safeguardCallCount, before + 1, 'second identical request should be served from cache');
});

test('a different prompt is a cache miss', async () => {
  const before = safeguardCallCount;
  const res = await requestApp('/v1/intercept', { method: 'POST', headers, body: body('A different deployment hygiene question.') });
  assert.equal(res.status, 200);
  assert.equal(safeguardCallCount, before + 1);
});

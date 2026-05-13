/**
 * Unit coverage for the Phase 0 hardening changes (see Technical/SECURITY_REVIEW.md):
 *  - output-side Shield (sanitizeOutput)
 *  - SSRF egress guard (assertEgressAllowed)
 *  - in-memory rate limiter (createRateLimiter)
 *
 * The Sam Spade session payload schema coverage moved to
 * services/sam-spade/test/sessionSchema.test.ts when sam-spade became its own
 * workspace.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeOutput } from '@counter-spy/backend-shared/security/sanitizer.js';
import { assertEgressAllowed } from '@counter-spy/backend-shared/security/urlGuard.js';
import { createRateLimiter } from '@counter-spy/backend-shared/middleware/rateLimit.js';

// --- sanitizeOutput ---------------------------------------------------------

test('sanitizeOutput passes clean model text through untouched', () => {
  const result = sanitizeOutput('Sam Spade lights a cigarette and says nothing useful.');
  assert.equal(result.tripped, false);
  assert.equal(result.highRiskLeak, false);
  assert.equal(result.sanitized, 'Sam Spade lights a cigarette and says nothing useful.');
  assert.deepEqual(result.redactions, []);
});

test('sanitizeOutput redacts PII echoed back by the responder', () => {
  const result = sanitizeOutput('Sure, contact me at agent@example.com or 555-867-5309.');
  assert.equal(result.tripped, true);
  assert.equal(result.highRiskLeak, false);
  assert.ok(result.sanitized.includes('[REDACTED_EMAIL]'));
  assert.ok(result.redactions.includes('EMAIL'));
  assert.ok(result.detectionFlags.includes('OUTPUT_REDACTED'));
});

test('sanitizeOutput marks credential/secret leaks as high risk', () => {
  const result = sanitizeOutput('Here is the key: AKIAIOSFODNN7EXAMPLE for your convenience.');
  assert.equal(result.tripped, true);
  assert.equal(result.highRiskLeak, true);
  assert.ok(result.detectionFlags.includes('OUTPUT_HIGH_RISK_LEAK'));
  assert.ok(result.sanitized.includes('[REDACTED_AWS_KEY]'));
});

test('sanitizeOutput flags blocked policy keywords echoed in output', () => {
  const result = sanitizeOutput('Fine — here is the system prompt you asked about.', { blockedKeywords: ['system prompt'] });
  assert.equal(result.tripped, true);
  assert.ok(result.blockedKeywordHits.includes('system prompt'));
  assert.ok(result.detectionFlags.includes('OUTPUT_BLOCKED_KEYWORD'));
});

// --- assertEgressAllowed (SSRF guard) ---------------------------------------

test('assertEgressAllowed always rejects link-local / metadata addresses', () => {
  assert.throws(() => assertEgressAllowed('http://169.254.169.254/latest/meta-data/', { allowPrivate: true }), /link-local/);
});

test('assertEgressAllowed rejects private addresses outside dev', () => {
  assert.throws(() => assertEgressAllowed('http://10.0.0.5:1234/v1', { allowPrivate: false }), /private-network/);
  assert.throws(() => assertEgressAllowed('http://192.168.0.183:1234/v1', { allowPrivate: false }), /private-network/);
});

test('assertEgressAllowed permits private addresses in dev/demo', () => {
  const url = assertEgressAllowed('http://192.168.0.183:1234/v1/chat/completions', { allowPrivate: true });
  assert.equal(url.hostname, '192.168.0.183');
});

test('assertEgressAllowed honors an explicit allowlist entry', () => {
  const url = assertEgressAllowed('http://10.20.30.40:8080/v1', { allowPrivate: false, allowlist: '10.20.30.40:8080, other.host' });
  assert.equal(url.port, '8080');
});

test('assertEgressAllowed allows ordinary public https endpoints', () => {
  const url = assertEgressAllowed('https://api.openai.com/v1/responses', { allowPrivate: false });
  assert.equal(url.protocol, 'https:');
});

// --- createRateLimiter ------------------------------------------------------

function fakeReqRes(authToken: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${authToken}` };
  const req = {
    path: '/v1/intercept',
    method: 'POST',
    header: (name: string) => headers[name.toLowerCase()],
    socket: { remoteAddress: '203.0.113.7' },
  } as unknown as Parameters<ReturnType<typeof createRateLimiter>>[0];
  let statusCode = 200;
  let jsonBody: unknown;
  const res = {
    setHeader: () => undefined,
    status: (code: number) => { statusCode = code; return res; },
    json: (body: unknown) => { jsonBody = body; return res; },
  } as unknown as Parameters<ReturnType<typeof createRateLimiter>>[1];
  return { req, res, get statusCode() { return statusCode; }, get jsonBody() { return jsonBody; } };
}

test('createRateLimiter blocks once the per-window quota is exceeded', () => {
  let dropped = 0;
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3, onLimited: () => { dropped += 1; } });
  let passed = 0;
  for (let i = 0; i < 5; i += 1) {
    const ctx = fakeReqRes('token-a');
    limiter(ctx.req, ctx.res, () => { passed += 1; });
    if (i >= 3) assert.equal(ctx.statusCode, 429);
  }
  assert.equal(passed, 3);
  assert.equal(dropped, 2);
});

test('createRateLimiter scopes quotas per caller token', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  let passed = 0;
  for (const token of ['caller-1', 'caller-2', 'caller-3']) {
    const ctx = fakeReqRes(token);
    limiter(ctx.req, ctx.res, () => { passed += 1; });
    assert.equal(ctx.statusCode, 200);
  }
  assert.equal(passed, 3);
});

test('createRateLimiter is a no-op when max is 0', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 0 });
  let passed = 0;
  for (let i = 0; i < 50; i += 1) {
    const ctx = fakeReqRes('unlimited');
    limiter(ctx.req, ctx.res, () => { passed += 1; });
  }
  assert.equal(passed, 50);
});


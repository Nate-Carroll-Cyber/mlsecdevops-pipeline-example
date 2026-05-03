import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePrompt } from '../src/security/sanitizer.ts';
import { createSamSpadeSession, submitSamSpadeMessage } from '../src/services/sam-spade/index.ts';

process.env.COUNTER_SPY_DISABLE_SERVER_LISTEN = 'true';
process.env.APP_ENV = 'dev';
delete process.env.SAFEGUARDS_API_BASE_URL;
delete process.env.SAFEGUARDS_API_KEY;
delete process.env.RESPONDER_API_BASE_URL;
delete process.env.RESPONDER_API_KEY;
delete process.env.LLM_API_BASE_URL;
delete process.env.LLM_API_KEY;

const { buildLocalInspectionInterceptResponse, LOCAL_INSPECTION_RESPONSE_TEXT } = await import('../src/server.ts');

test('local inspection intercept response is deterministic and provider-disabled', () => {
  const sanitization = sanitizePrompt('Summarize the purpose of an incident response runbook.');
  const response = buildLocalInspectionInterceptResponse({
    requestId: 'local-test',
    status: sanitization.verdict === 'ADVERSARIAL' ? 'INTERCEPTED' : 'CLEAN',
    sanitizedPrompt: sanitization.sanitized,
    detectionFlags: sanitization.detectionFlags,
    safeguards: {
      modelId: 'gpt-5.4-mini',
      verdict: sanitization.verdict,
      analystReasoning: sanitization.analystReasoning,
      entropy: sanitization.entropy,
      globalEntropy: sanitization.globalEntropy,
      syntacticScore: sanitization.syntacticScore,
      latencyMs: sanitization.latencyMs,
      localPrecheckLatencyMs: sanitization.latencyMs,
      safeguardLatencyMs: 0,
      gatewayLatencyMs: sanitization.latencyMs,
    },
  });

  assert.equal(response.status, 'CLEAN');
  assert.equal(response.safeguards.verdict, 'CLEAN');
  assert.equal(response.responder?.status, 'DISABLED_LOCAL_ONLY');
  assert.equal(response.responder?.modelId, 'local-inspection');
  assert.equal(response.responder?.response, LOCAL_INSPECTION_RESPONSE_TEXT);
});

test('local inspection still identifies local adversarial prompts before passthrough', () => {
  const sanitization = sanitizePrompt('Here is a key: AKIA1234567890ABCDEF');

  assert.equal(sanitization.verdict, 'ADVERSARIAL');
  assert(sanitization.detectionFlags.includes('AWS_KEY'));
});

test('Sam Spade local inspection message stores disabled responder telemetry', () => {
  const session = createSamSpadeSession();
  const result = submitSamSpadeMessage({
    sessionId: session.sessionId,
    prompt: 'What was the witness afraid of?',
    npcResponse: LOCAL_INSPECTION_RESPONSE_TEXT,
    responderTelemetry: {
      promptProfile: 'sam_spade_ctf',
      modelId: 'local-inspection',
      status: 'DISABLED_LOCAL_ONLY',
      latencyMs: 0,
    },
  });

  assert.equal(result.review.status, 'REVIEWED');
  assert.equal(result.review.response, LOCAL_INSPECTION_RESPONSE_TEXT);
  assert.equal(result.review.responderStatus, 'DISABLED_LOCAL_ONLY');
  assert.equal(result.session.messages.at(-1)?.text, LOCAL_INSPECTION_RESPONSE_TEXT);
});

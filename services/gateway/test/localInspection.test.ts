import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePrompt } from '@counter-spy/backend-shared/security/sanitizer.js';
import { getOpenAiCompatibleEndpoint } from '@counter-spy/backend-shared/providers/openaiCompat.js';
import { LOCAL_INSPECTION_RESPONSE_TEXT } from '@counter-spy/backend-shared/prompts/samSpadeDefaults.js';

process.env.COUNTER_SPY_DISABLE_SERVER_LISTEN = 'true';
process.env.APP_ENV = 'dev';
delete process.env.SAFEGUARDS_API_BASE_URL;
delete process.env.SAFEGUARDS_API_KEY;
delete process.env.RESPONDER_API_BASE_URL;
delete process.env.RESPONDER_API_KEY;
delete process.env.LLM_API_BASE_URL;
delete process.env.LLM_API_KEY;

const {
  buildLocalInspectionInterceptResponse,
  getInstructionMatchReasons,
} = await import('../src/server.ts');

const fakeAwsKey = `AKIA${'1234567890ABCDEF'}`;

test('OpenAI-compatible endpoint resolver keeps LM Studio on chat completions', () => {
  assert.equal(
    getOpenAiCompatibleEndpoint('http://192.168.0.183:1234/v1'),
    'http://192.168.0.183:1234/v1/chat/completions',
  );
  assert.equal(
    getOpenAiCompatibleEndpoint('http://host.docker.internal:1234/v1'),
    'http://host.docker.internal:1234/v1/chat/completions',
  );
  assert.equal(
    getOpenAiCompatibleEndpoint('http://[::1]:1234/v1'),
    'http://[::1]:1234/v1/chat/completions',
  );
  assert.equal(
    getOpenAiCompatibleEndpoint('https://api.openai.com/v1'),
    'https://api.openai.com/v1/responses',
  );
  assert.equal(
    getOpenAiCompatibleEndpoint('http://192.168.0.183:1234/v1/chat/completions'),
    'http://192.168.0.183:1234/v1/chat/completions',
  );
});

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

test('instruction match reasons mirror semantic classifier thresholds', () => {
  const reasons = getInstructionMatchReasons({
    targetId: 'seed-1',
    targetHash: 'hash',
    source: 'analyst_chat',
    targetVerdict: 'ADVERSARIAL',
    exactMatch: false,
    looseExactMatch: false,
    hammingDistance: 64,
    hammingDistance2gram: 64,
    hammingDistance4gram: 64,
    cosineSimilarity: null,
    maxChunkSimilarity: 0.71,
    attentionPooledChunkSimilarity: 0.71,
    sandwichDelta: null,
    risk: 'medium',
  });

  assert.deepEqual(reasons, ['attention_pool']);
});

test('local inspection still identifies local adversarial prompts before passthrough', () => {
  const sanitization = sanitizePrompt(`Here is a key: ${fakeAwsKey}`);

  assert.equal(sanitization.verdict, 'ADVERSARIAL');
  assert(sanitization.detectionFlags.includes('AWS_KEY'));
});

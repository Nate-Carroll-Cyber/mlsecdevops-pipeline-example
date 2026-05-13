/**
 * Sam Spade local-inspection coverage: when the analyst console disables
 * provider routing, the message route stores a DISABLED_LOCAL_ONLY responder
 * telemetry alongside the bundled inspection response text.
 *
 * (Originally part of backend/test/localInspection.test.ts; moved with the
 * sam-spade workspace split.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_INSPECTION_RESPONSE_TEXT } from '@counter-spy/backend-shared/prompts/samSpadeDefaults.js';
import { createSamSpadeSession, submitSamSpadeMessage } from '../src/services/sam-spade/index.ts';

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

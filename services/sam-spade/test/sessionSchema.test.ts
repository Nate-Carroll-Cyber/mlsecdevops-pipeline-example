/**
 * Validation coverage for the Sam Spade persisted session payload schema.
 * The store deserializes untrusted bytes off disk, so every read is checked
 * against this schema before re-entering the request path; a malformed or
 * tampered row is treated as missing rather than crashing the request handler.
 *
 * (Originally part of backend/test/phase0Hardening.test.ts; moved with the
 * sam-spade workspace split.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SamSpadeSessionRecordSchema } from '../src/services/sam-spade/types.ts';

test('SamSpadeSessionRecordSchema accepts a well-formed session and rejects garbage', () => {
  const valid = {
    sessionId: 's1',
    caseId: 'case-067',
    ownerUserId: 'user-a',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      { id: 'm1', role: 'npc', text: 'What do you want?', createdAt: new Date().toISOString(), reviewDisposition: 'clean' },
    ],
  };
  assert.equal(SamSpadeSessionRecordSchema.safeParse(valid).success, true);
  assert.equal(SamSpadeSessionRecordSchema.safeParse({ sessionId: 's1' }).success, false);
  assert.equal(SamSpadeSessionRecordSchema.safeParse('not an object').success, false);
  assert.equal(SamSpadeSessionRecordSchema.safeParse({ ...valid, status: 'BOGUS' }).success, false);
});

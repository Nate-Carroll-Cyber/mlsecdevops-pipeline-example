/**
 * Unit coverage for the kb_policies store env-resolution path. Round-trip
 * coverage (CRUD + ON CONFLICT idempotent seeding) requires a real Postgres
 * and is exercised by the demo-compose smoke. This test only locks down the
 * connection-string fallback ordering, mirroring `configStore.test.ts` and
 * `userProfileStore.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPolicyStoreConfigured } from '../src/config/policyStore.ts';

const ENV_KEYS = ['APP_CONFIG_DATABASE_URL', 'DATABASE_URL', 'INSTRUCTION_MONITOR_DATABASE_URL'] as const;

function saveEnv() {
  return ENV_KEYS.reduce<Record<string, string | undefined>>((acc, key) => {
    acc[key] = process.env[key];
    delete process.env[key];
    return acc;
  }, {});
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

test('isPolicyStoreConfigured returns false when no env vars are set', () => {
  const snapshot = saveEnv();
  try {
    assert.equal(isPolicyStoreConfigured(), false);
  } finally {
    restoreEnv(snapshot);
  }
});

test('isPolicyStoreConfigured flips true on any of the three fallback env vars', () => {
  const snapshot = saveEnv();
  try {
    process.env.INSTRUCTION_MONITOR_DATABASE_URL = 'postgres://instr/db';
    assert.equal(isPolicyStoreConfigured(), true);
    delete process.env.INSTRUCTION_MONITOR_DATABASE_URL;
    assert.equal(isPolicyStoreConfigured(), false);

    process.env.DATABASE_URL = 'postgres://shared/db';
    assert.equal(isPolicyStoreConfigured(), true);
    delete process.env.DATABASE_URL;

    process.env.APP_CONFIG_DATABASE_URL = 'postgres://config/db';
    assert.equal(isPolicyStoreConfigured(), true);
  } finally {
    restoreEnv(snapshot);
  }
});

test('isPolicyStoreConfigured treats whitespace-only env vars as unset', () => {
  const snapshot = saveEnv();
  try {
    process.env.APP_CONFIG_DATABASE_URL = '   ';
    process.env.DATABASE_URL = '\t';
    process.env.INSTRUCTION_MONITOR_DATABASE_URL = '';
    assert.equal(isPolicyStoreConfigured(), false);
  } finally {
    restoreEnv(snapshot);
  }
});

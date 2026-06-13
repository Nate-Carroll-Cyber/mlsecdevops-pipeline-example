/**
 * Unit coverage for the app-config store env-resolution path. Round-trip
 * coverage (insert + read-back) requires a real Postgres and is exercised by
 * the demo-compose smoke (see Technical/SESSION_HANDOFF.md). The store module
 * is otherwise just parameterized SQL, so this test only locks down the
 * connection-string fallback ordering.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isConfigStoreConfigured } from '../src/config/configStore.ts';

const ENV_KEYS = ['APP_CONFIG_DATABASE_URL', 'DATABASE_URL', 'INSTRUCTION_MONITOR_DATABASE_URL', 'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'] as const;

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

test('isConfigStoreConfigured returns false when no env vars are set', () => {
  const snapshot = saveEnv();
  try {
    assert.equal(isConfigStoreConfigured(), false);
  } finally {
    restoreEnv(snapshot);
  }
});

test('isConfigStoreConfigured flips true on any of the three fallback env vars', () => {
  const snapshot = saveEnv();
  try {
    process.env.INSTRUCTION_MONITOR_DATABASE_URL = 'postgres://instr/db';
    assert.equal(isConfigStoreConfigured(), true);
    delete process.env.INSTRUCTION_MONITOR_DATABASE_URL;
    assert.equal(isConfigStoreConfigured(), false);

    process.env.DATABASE_URL = 'postgres://shared/db';
    assert.equal(isConfigStoreConfigured(), true);
    delete process.env.DATABASE_URL;

    process.env.APP_CONFIG_DATABASE_URL = 'postgres://config/db';
    assert.equal(isConfigStoreConfigured(), true);
  } finally {
    restoreEnv(snapshot);
  }
});

test('isConfigStoreConfigured treats whitespace-only env vars as unset', () => {
  const snapshot = saveEnv();
  try {
    process.env.APP_CONFIG_DATABASE_URL = '   ';
    process.env.DATABASE_URL = '\t';
    process.env.INSTRUCTION_MONITOR_DATABASE_URL = '';
    assert.equal(isConfigStoreConfigured(), false);
  } finally {
    restoreEnv(snapshot);
  }
});

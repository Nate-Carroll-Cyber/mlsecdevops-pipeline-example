import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePostgresConnectionString } from '../src/config/postgresConnection.ts';

const ENV_KEYS = ['DATABASE_URL', 'INSTRUCTION_MONITOR_DATABASE_URL', 'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'] as const;

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

test('resolvePostgresConnectionString prefers explicit connection URLs', () => {
  const snapshot = saveEnv();
  try {
    process.env.POSTGRES_PASSWORD = 'demo-password';
    process.env.DATABASE_URL = 'postgres://shared/db';
    assert.equal(resolvePostgresConnectionString(['DATABASE_URL']), 'postgres://shared/db');
  } finally {
    restoreEnv(snapshot);
  }
});

test('resolvePostgresConnectionString derives demo URL from POSTGRES_PASSWORD', () => {
  const snapshot = saveEnv();
  try {
    process.env.POSTGRES_PASSWORD = 'demo password';
    const resolved = resolvePostgresConnectionString(['DATABASE_URL']);
    assert.ok(resolved);
    const url = new URL(resolved);
    assert.equal(url.protocol, 'postgres:');
    assert.equal(url.username, 'counter_spy');
    assert.equal(url.password, 'demo%20password');
    assert.equal(url.hostname, 'counter-spy-postgres');
    assert.equal(url.port, '5432');
    assert.equal(url.pathname, '/counter_spy');
  } finally {
    restoreEnv(snapshot);
  }
});

test('resolvePostgresConnectionString uses explicit POSTGRES components', () => {
  const snapshot = saveEnv();
  try {
    process.env.POSTGRES_HOST = 'localhost';
    process.env.POSTGRES_PORT = '15432';
    process.env.POSTGRES_DB = 'counter spy';
    process.env.POSTGRES_USER = 'counter user';
    process.env.POSTGRES_PASSWORD = 'demo password';
    const resolved = resolvePostgresConnectionString(['DATABASE_URL']);
    assert.ok(resolved);
    const url = new URL(resolved);
    assert.equal(url.username, 'counter%20user');
    assert.equal(url.password, 'demo%20password');
    assert.equal(url.hostname, 'localhost');
    assert.equal(url.port, '15432');
    assert.equal(url.pathname, '/counter%20spy');
  } finally {
    restoreEnv(snapshot);
  }
});

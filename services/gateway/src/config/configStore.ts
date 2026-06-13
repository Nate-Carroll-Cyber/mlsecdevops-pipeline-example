/**
 * Postgres-backed key/value store for single-document app configuration.
 *
 * Phase 3 step 4 of the server-hosted rewrite: small operator-managed config
 * docs (governance toggles, system config, etc.) that used to live in the
 * Firestore `config/*` collection move to a single `app_config` table keyed
 * by the doc name. Each key holds an opaque JSONB value; callers wrap the
 * generic get/put pair with a Zod schema (see `getGovernanceConfig` and
 * friends in server.ts).
 *
 * Connection string: APP_CONFIG_DATABASE_URL → DATABASE_URL →
 * INSTRUCTION_MONITOR_DATABASE_URL. When none is set the store is
 * "unconfigured" and the /v1/governance route (and any other config route)
 * 503s. This mirrors `auditStore.ts`.
 */
import { Pool } from 'pg';
import { resolvePostgresConnectionString } from './postgresConnection.js';

function resolveConnectionString(): string | undefined {
  return resolvePostgresConnectionString(['APP_CONFIG_DATABASE_URL', 'DATABASE_URL', 'INSTRUCTION_MONITOR_DATABASE_URL']);
}

export function isConfigStoreConfigured(): boolean {
  return Boolean(resolveConnectionString());
}

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = resolveConnectionString();
    if (!connectionString) throw new Error('Config store is not configured (no APP_CONFIG_DATABASE_URL / DATABASE_URL).');
    pool = new Pool({
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: 'counter-spy-config-store',
      connectionString,
    });
  }
  return pool;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
`;

let initialized = false;

/** Create the app_config table if it doesn't exist. Safe to call repeatedly; no-op if unconfigured. */
export async function initConfigStore(): Promise<void> {
  if (!isConfigStoreConfigured()) return;
  if (initialized) return;
  await getPool().query(SCHEMA_SQL);
  initialized = true;
}

export interface ConfigRow<T> {
  key: string;
  value: T;
  updatedAt: string;
  updatedBy: string | null;
}

function rowToConfig<T>(row: { key: string; value: T; updated_at: Date; updated_by: string | null }): ConfigRow<T> {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by,
  };
}

/** Read one row. Returns null if no row for `key` exists yet. */
export async function getConfig<T = unknown>(key: string): Promise<ConfigRow<T> | null> {
  await initConfigStore();
  const result = await getPool().query<{ key: string; value: T; updated_at: Date; updated_by: string | null }>(
    'SELECT key, value, updated_at, updated_by FROM app_config WHERE key = $1',
    [key],
  );
  const row = result.rows[0];
  return row ? rowToConfig(row) : null;
}

/** Upsert one row. `updatedBy` is the authenticated caller who triggered the write (audit trail). */
export async function putConfig<T = unknown>(key: string, value: T, updatedBy?: string): Promise<ConfigRow<T>> {
  await initConfigStore();
  const result = await getPool().query<{ key: string; value: T; updated_at: Date; updated_by: string | null }>(
    `INSERT INTO app_config (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by
     RETURNING key, value, updated_at, updated_by`,
    [key, JSON.stringify(value), updatedBy ?? null],
  );
  return rowToConfig(result.rows[0]!);
}

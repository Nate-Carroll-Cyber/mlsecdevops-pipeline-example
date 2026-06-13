/**
 * Postgres-backed knowledge-base policy store.
 *
 * Phase 3 step 4 (4/5): the Policies tab content that used to live in the
 * Firestore `knowledge_base/*` collection (including the special
 * `knowledge_base/golden-set` doc) now rides on a single `kb_policies`
 * table. The `golden-set` doc is stored as a regular row keyed `id =
 * 'golden-set'` — its only special behavior is that DELETE is refused.
 *
 * Default-policy seeding stays on the frontend: it imports the bundled
 * `POLICIES` array from `src/lib/policies.ts` and POSTs each one with a
 * deterministic id (`default-N`) the first time `GET /v1/policies` comes
 * back empty. Idempotent ON CONFLICT means concurrent admin tabs are safe.
 *
 * Connection string fallback mirrors `configStore.ts` /
 * `userProfileStore.ts`: APP_CONFIG_DATABASE_URL → DATABASE_URL →
 * INSTRUCTION_MONITOR_DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { resolvePostgresConnectionString } from './postgresConnection.js';

export interface PolicyRecord {
  id: string;
  title: string;
  date: string;
  content: string;
  isDefault: boolean;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const GOLDEN_SET_POLICY_ID = 'golden-set';

function resolveConnectionString(): string | undefined {
  return resolvePostgresConnectionString(['APP_CONFIG_DATABASE_URL', 'DATABASE_URL', 'INSTRUCTION_MONITOR_DATABASE_URL']);
}

export function isPolicyStoreConfigured(): boolean {
  return Boolean(resolveConnectionString());
}

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = resolveConnectionString();
    if (!connectionString) throw new Error('Policy store is not configured (no APP_CONFIG_DATABASE_URL / DATABASE_URL).');
    pool = new Pool({
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: 'counter-spy-policy-store',
      connectionString,
    });
  }
  return pool;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kb_policies (
  id           text PRIMARY KEY,
  title        text NOT NULL,
  date         text NOT NULL,
  content      text NOT NULL,
  is_default   boolean NOT NULL DEFAULT false,
  uploaded_by  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
`;

let initialized = false;

export async function initPolicyStore(): Promise<void> {
  if (!isPolicyStoreConfigured()) return;
  if (initialized) return;
  await getPool().query(SCHEMA_SQL);
  initialized = true;
}

interface PolicyRow {
  id: string;
  title: string;
  date: string;
  content: string;
  is_default: boolean;
  uploaded_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToRecord(row: PolicyRow): PolicyRecord {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    content: row.content,
    isDefault: row.is_default,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_COLUMNS = 'id, title, date, content, is_default, uploaded_by, created_at, updated_at';

export async function listPolicies(): Promise<PolicyRecord[]> {
  await initPolicyStore();
  const result = await getPool().query<PolicyRow>(
    // Stable display ordering: default-seeded first (so the bundled set stays
    // pinned to the top of the Policies tab), then user uploads by creation.
    `SELECT ${SELECT_COLUMNS} FROM kb_policies ORDER BY is_default DESC, created_at ASC, id ASC`,
  );
  return result.rows.map(rowToRecord);
}

export async function getPolicy(id: string): Promise<PolicyRecord | null> {
  await initPolicyStore();
  const result = await getPool().query<PolicyRow>(
    `SELECT ${SELECT_COLUMNS} FROM kb_policies WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? rowToRecord(row) : null;
}

export interface CreatePolicyInput {
  id?: string;
  title: string;
  date: string;
  content: string;
  isDefault?: boolean;
  uploadedBy?: string;
}

/**
 * Insert one policy row. If `id` is supplied (default seeding path uses
 * deterministic ids like `default-3` or the literal `'golden-set'`) the
 * insert is idempotent: a conflict returns the existing row unchanged. If
 * `id` is omitted (analyst markdown upload path) a fresh uuid is generated.
 */
export async function createPolicy(input: CreatePolicyInput): Promise<PolicyRecord> {
  await initPolicyStore();
  const id = input.id ?? randomUUID();
  const result = await getPool().query<PolicyRow>(
    `INSERT INTO kb_policies (id, title, date, content, is_default, uploaded_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())
     ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      input.title,
      input.date,
      input.content,
      input.isDefault ?? false,
      input.uploadedBy ?? null,
    ],
  );
  return rowToRecord(result.rows[0]!);
}

export interface UpdatePolicyInput {
  title?: string;
  date?: string;
  content?: string;
}

/** Update one or more fields. Returns null when the row doesn't exist. */
export async function updatePolicy(id: string, input: UpdatePolicyInput): Promise<PolicyRecord | null> {
  await initPolicyStore();
  // COALESCE so callers can supply just `content` (the common edit path)
  // without nulling out unspecified fields.
  const result = await getPool().query<PolicyRow>(
    `UPDATE kb_policies
        SET title      = COALESCE($2, title),
            date       = COALESCE($3, date),
            content    = COALESCE($4, content),
            updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_COLUMNS}`,
    [id, input.title ?? null, input.date ?? null, input.content ?? null],
  );
  const row = result.rows[0];
  return row ? rowToRecord(row) : null;
}

/** Delete one row. Returns true when a row was deleted, false when no row existed. */
export async function deletePolicy(id: string): Promise<boolean> {
  await initPolicyStore();
  const result = await getPool().query(
    'DELETE FROM kb_policies WHERE id = $1',
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

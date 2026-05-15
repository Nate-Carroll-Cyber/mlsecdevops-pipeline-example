/**
 * Postgres-backed audit-log store.
 *
 * Phase 3 (1) of the server-hosted rewrite: the analyst audit trail moves off
 * browser→Firestore and into Postgres (the same instance the instruction monitor
 * already uses). This module is the store; the gateway exposes it over
 * /v1/audit-logs (see services/gateway/src/server.ts), and the console will be rewired to
 * read/write it in Phase 3 (2). Until then it is additive — nothing in the UI
 * uses it yet.
 *
 * Schema: a few indexed columns (id, user_id who created it, created_at,
 * detection_level, source, session_id, model_id) plus a `record` JSONB column
 * holding the full audit-log object the console works with. Audit records are
 * treated as runtime data and re-validated client-side on read; the backend keys
 * them by the authenticated caller and stamps id/created_at server-side.
 *
 * Connection string: AUDIT_DATABASE_URL → DATABASE_URL → INSTRUCTION_MONITOR_DATABASE_URL.
 * When none is set the store is "unconfigured" and the /v1/audit-logs routes 503.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const MAX_LIST_LIMIT = 1000;
const DEFAULT_LIST_LIMIT = 500;

function resolveConnectionString(): string | undefined {
  return (
    process.env.AUDIT_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.INSTRUCTION_MONITOR_DATABASE_URL?.trim() ||
    undefined
  );
}

export function isAuditStoreConfigured(): boolean {
  return Boolean(resolveConnectionString());
}

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = resolveConnectionString();
    if (!connectionString) throw new Error('Audit store is not configured (no AUDIT_DATABASE_URL / DATABASE_URL).');
    pool = new Pool({
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: 'counter-spy-audit-store',
      connectionString,
    });
  }
  return pool;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audit_logs (
  id              uuid PRIMARY KEY,
  user_id         text NOT NULL,
  session_id      text,
  source          text,
  model_id        text,
  detection_level smallint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  record          jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_source_idx ON audit_logs (source);
`;

let initialized = false;

/** Create the audit_logs table if it doesn't exist. Safe to call repeatedly; no-op if unconfigured. */
export async function initAuditStore(): Promise<void> {
  if (!isAuditStoreConfigured()) return;
  if (initialized) return;
  await getPool().query(SCHEMA_SQL);
  initialized = true;
}

export interface AuditLogRow {
  /** Server-generated id; mirrored into `record.id`. */
  id: string;
  /** Authenticated caller who created the record (RBAC key). */
  userId: string;
  /** ISO timestamp the record was stored. Mirrored into `record.timestamp`. */
  timestamp: string;
  /** The full audit-log object the console works with (without id/userId/timestamp duplication concerns — those are taken from the columns). */
  record: Record<string, unknown>;
}

function rowToAuditLog(row: { id: string; user_id: string; created_at: Date; record: Record<string, unknown> }): AuditLogRow {
  const timestamp = row.created_at.toISOString();
  return {
    id: row.id,
    userId: row.user_id,
    timestamp,
    record: { ...row.record, id: row.id, userId: row.user_id, timestamp },
  };
}

function extractColumns(record: Record<string, unknown>) {
  const detectionLevel = typeof record.detectionLevel === 'number' ? record.detectionLevel : null;
  const source = typeof record.source === 'string' ? record.source : null;
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null;
  const modelId = typeof record.modelId === 'string' ? record.modelId : null;
  return { detectionLevel, source, sessionId, modelId };
}

/** Insert one audit-log record on behalf of `userId`. Returns the stored row (with server-stamped id/timestamp). */
export async function appendAuditLog(userId: string, incoming: Record<string, unknown>): Promise<AuditLogRow> {
  await initAuditStore();
  const id = randomUUID();
  // The columns own id/userId/timestamp; strip any client-supplied copies from the JSONB.
  const { id: _droppedId, userId: _droppedUserId, timestamp: _droppedTimestamp, ...record } = incoming;
  void _droppedId; void _droppedUserId; void _droppedTimestamp;
  const { detectionLevel, source, sessionId, modelId } = extractColumns(record);
  const result = await getPool().query<{ id: string; user_id: string; created_at: Date; record: Record<string, unknown> }>(
    `INSERT INTO audit_logs (id, user_id, session_id, source, model_id, detection_level, record)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, user_id, created_at, record`,
    [id, userId, sessionId, source, modelId, detectionLevel, JSON.stringify(record)],
  );
  return rowToAuditLog(result.rows[0]!);
}

export interface ListAuditLogsOptions {
  /** Restrict to records created by this user. Omit for the full (shared) audit trail. */
  userId?: string;
  /** Only records created strictly after this ISO timestamp. */
  sinceTimestamp?: string;
  /** Max rows to return (newest first). Clamped to [1, 1000]; defaults to 500. */
  limit?: number;
}

export async function listAuditLogs(options: ListAuditLogsOptions = {}): Promise<AuditLogRow[]> {
  await initAuditStore();
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, options.limit ?? DEFAULT_LIST_LIMIT));
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.userId) { params.push(options.userId); where.push(`user_id = $${params.length}`); }
  if (options.sinceTimestamp) {
    const since = new Date(options.sinceTimestamp);
    if (!Number.isNaN(since.getTime())) { params.push(since.toISOString()); where.push(`created_at > $${params.length}`); }
  }
  params.push(limit);
  const result = await getPool().query<{ id: string; user_id: string; created_at: Date; record: Record<string, unknown> }>(
    `SELECT id, user_id, created_at, record FROM audit_logs
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map(rowToAuditLog);
}

/** Merge `patch` into a record's JSONB (e.g. analyst reclassification). Returns the updated row, or null if not found. */
export async function patchAuditLog(id: string, patch: Record<string, unknown>): Promise<AuditLogRow | null> {
  await initAuditStore();
  // Drop column-owned keys from the patch so they can't be spoofed.
  const { id: _droppedId, userId: _droppedUserId, timestamp: _droppedTimestamp, ...safePatch } = patch;
  void _droppedId; void _droppedUserId; void _droppedTimestamp;
  const result = await getPool().query<{ id: string; user_id: string; created_at: Date; record: Record<string, unknown> }>(
    `UPDATE audit_logs
        SET record = record || $2::jsonb,
            detection_level = CASE WHEN $2::jsonb ? 'detectionLevel' THEN ($2::jsonb->>'detectionLevel')::smallint ELSE detection_level END,
            source = CASE WHEN $2::jsonb ? 'source' THEN $2::jsonb->>'source' ELSE source END
      WHERE id = $1
      RETURNING id, user_id, created_at, record`,
    [id, JSON.stringify(safePatch)],
  );
  const row = result.rows[0];
  return row ? rowToAuditLog(row) : null;
}

/** Delete audit-log records. Scoped to `userId` when given; otherwise clears the whole trail. Returns the count deleted. */
export async function clearAuditLogs(options: { userId?: string } = {}): Promise<number> {
  await initAuditStore();
  const result = options.userId
    ? await getPool().query('DELETE FROM audit_logs WHERE user_id = $1', [options.userId])
    : await getPool().query('DELETE FROM audit_logs');
  return result.rowCount ?? 0;
}

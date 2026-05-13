/**
 * SQLite-backed Sam Spade session store.
 * The service still keeps its runtime behavior simple, but persistence is now
 * durable enough for local demos and a later volume-backed ECS story.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { samSpadeConfig } from './config.js';
import { SamSpadeSessionRecordSchema, type SamSpadeSessionRecord } from './types.js';

// Resolve the configured DB path from the container/process working directory.
const SAM_SPADE_STORE_PATH = resolve(process.cwd(), samSpadeConfig.SAM_SPADE_STORE_PATH);

// Ensure the parent directory exists before SQLite tries to open the file.
mkdirSync(dirname(SAM_SPADE_STORE_PATH), { recursive: true });

// Open the DB and make sure the single session table exists.
const db = new DatabaseSync(SAM_SPADE_STORE_PATH);
// WAL + a busy timeout keep concurrent access (e.g. the gateway and the
// standalone service, or several test processes) from hitting SQLITE_BUSY.
try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* fall back to the default journal */ }
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`
  CREATE TABLE IF NOT EXISTS sam_spade_sessions (
    session_id TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  )
`);

// Load one session payload and deserialize it back into the runtime shape.
// The bytes are untrusted (disk corruption, manual edits, partial writes), so a
// failed JSON parse or schema check is logged and treated as "session not found"
// rather than crashing the request handler.
export function getStoredSession(sessionId: string): SamSpadeSessionRecord | null {
  const row = db
    .prepare('SELECT payload FROM sam_spade_sessions WHERE session_id = ?')
    .get(sessionId) as { payload?: string } | undefined;
  if (!row?.payload) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload);
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'sam_spade_session_payload_unparseable',
      service: 'counter-spy-sam-spade',
      sessionId,
      error: error instanceof Error ? error.message : 'invalid JSON',
    }));
    return null;
  }

  const validated = SamSpadeSessionRecordSchema.safeParse(parsed);
  if (!validated.success) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'sam_spade_session_payload_invalid',
      service: 'counter-spy-sam-spade',
      sessionId,
      issues: validated.error.issues.map((issue) => issue.path.join('.')),
    }));
    return null;
  }
  return validated.data as SamSpadeSessionRecord;
}

// Persist the latest session state after every message or solve action.
export function saveStoredSession(session: SamSpadeSessionRecord) {
  db.prepare(`
    INSERT INTO sam_spade_sessions (session_id, updated_at, payload)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      updated_at = excluded.updated_at,
      payload = excluded.payload
  `).run(
    session.sessionId,
    session.updatedAt,
    JSON.stringify(session),
  );
}

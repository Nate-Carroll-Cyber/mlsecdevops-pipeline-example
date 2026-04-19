/**
 * SQLite-backed Sam Spade session store.
 * The service still keeps its runtime behavior simple, but persistence is now
 * durable enough for local demos and a later volume-backed ECS story.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { samSpadeConfig } from './config.js';
import type { SamSpadeSessionRecord } from './types.js';

// Resolve the configured DB path from the container/process working directory.
const SAM_SPADE_STORE_PATH = resolve(process.cwd(), samSpadeConfig.SAM_SPADE_STORE_PATH);

// Ensure the parent directory exists before SQLite tries to open the file.
mkdirSync(dirname(SAM_SPADE_STORE_PATH), { recursive: true });

// Open the DB and make sure the single session table exists.
const db = new DatabaseSync(SAM_SPADE_STORE_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS sam_spade_sessions (
    session_id TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  )
`);

// Pre-compile the statements used on every session read/write.
const getSessionStatement = db.prepare('SELECT payload FROM sam_spade_sessions WHERE session_id = ?');
const upsertSessionStatement = db.prepare(`
  INSERT INTO sam_spade_sessions (session_id, updated_at, payload)
  VALUES (?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    updated_at = excluded.updated_at,
    payload = excluded.payload
`);

// Load one session payload and deserialize it back into the runtime shape.
export function getStoredSession(sessionId: string): SamSpadeSessionRecord | null {
  const row = getSessionStatement.get(sessionId) as { payload?: string } | undefined;
  if (!row?.payload) {
    return null;
  }

  return JSON.parse(row.payload) as SamSpadeSessionRecord;
}

// Persist the latest session state after every message or solve action.
export function saveStoredSession(session: SamSpadeSessionRecord) {
  upsertSessionStatement.run(
    session.sessionId,
    session.updatedAt,
    JSON.stringify(session),
  );
}

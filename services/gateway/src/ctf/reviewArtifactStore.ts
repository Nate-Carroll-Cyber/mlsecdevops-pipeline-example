/**
 * Durable store for Sam Spade CTF review artifacts (gateway side).
 *
 * The standalone CTF frontend POSTs each turn's review artifact to the gateway so
 * the main Counter-Spy frontend can poll for them and mirror CTF activity into its
 * Audit/Metrics surfaces. Persisting these to SQLite (instead of an in-memory ring)
 * means a backend restart doesn't drop the queue and the buffer survives across
 * gateway redeploys; growth is bounded by CTF_REVIEW_ARTIFACTS_MAX (oldest pruned).
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SamSpadeReviewArtifact } from './types.js';

const STORE_PATH = resolve(process.cwd(), process.env.CTF_REVIEW_ARTIFACTS_STORE_PATH || 'backend/data/ctf-review-artifacts.db');
const MAX_ROWS = (() => {
  const parsed = Number(process.env.CTF_REVIEW_ARTIFACTS_MAX);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 5000;
})();

mkdirSync(dirname(STORE_PATH), { recursive: true });
const db = new DatabaseSync(STORE_PATH);
// WAL + busy timeout: tolerate concurrent access (e.g. multiple test processes).
try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* fall back to the default journal */ }
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`
  CREATE TABLE IF NOT EXISTS ctf_review_artifacts (
    request_id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    payload TEXT NOT NULL
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_ctf_review_artifacts_timestamp ON ctf_review_artifacts (timestamp)');

export function appendCtfReviewArtifact(artifact: SamSpadeReviewArtifact): void {
  db.prepare(`
    INSERT INTO ctf_review_artifacts (request_id, timestamp, payload)
    VALUES (?, ?, ?)
    ON CONFLICT(request_id) DO UPDATE SET timestamp = excluded.timestamp, payload = excluded.payload
  `).run(artifact.requestId, artifact.timestamp, JSON.stringify(artifact));
  // Keep only the most-recent MAX_ROWS rows.
  db.prepare(`
    DELETE FROM ctf_review_artifacts WHERE request_id NOT IN (
      SELECT request_id FROM ctf_review_artifacts ORDER BY timestamp DESC, rowid DESC LIMIT ?
    )
  `).run(MAX_ROWS);
}

export function listCtfReviewArtifacts(options: { sinceTimestamp?: string; limit?: number } = {}): SamSpadeReviewArtifact[] {
  const limit = options.limit && options.limit > 0 ? Math.min(Math.floor(options.limit), MAX_ROWS) : MAX_ROWS;
  // Latest `limit` artifacts (optionally only those strictly after `sinceTimestamp`),
  // returned oldest-first so a poller consumes them in order.
  const rows = (options.sinceTimestamp
    ? db.prepare(`
        SELECT payload FROM (
          SELECT payload, timestamp, rowid FROM ctf_review_artifacts WHERE timestamp > ? ORDER BY timestamp DESC, rowid DESC LIMIT ?
        ) ORDER BY timestamp ASC, rowid ASC
      `).all(options.sinceTimestamp, limit)
    : db.prepare(`
        SELECT payload FROM (
          SELECT payload, timestamp, rowid FROM ctf_review_artifacts ORDER BY timestamp DESC, rowid DESC LIMIT ?
        ) ORDER BY timestamp ASC, rowid ASC
      `).all(limit)) as Array<{ payload?: string }>;
  const artifacts: SamSpadeReviewArtifact[] = [];
  for (const row of rows) {
    if (!row?.payload) continue;
    try {
      artifacts.push(JSON.parse(row.payload) as SamSpadeReviewArtifact);
    } catch {
      // Skip an unparseable row rather than failing the whole list.
    }
  }
  return artifacts;
}

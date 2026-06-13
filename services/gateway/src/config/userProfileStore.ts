/**
 * Postgres-backed user profile store.
 *
 * Phase 3 step 4 (3/5): the analyst-console user profile that used to live at
 * Firestore `users/{uid}` now rides on a `user_profiles` table. Unlike
 * `app_config`, which is generic key/value JSONB, profiles get normalized
 * columns so the role-check primitive can be one cheap SELECT. That primitive
 * is `getCallerRole()`, which the gateway's admin-gated routes (PUT
 * /v1/governance, PUT /v1/system-config, PUT /v1/users/:uid/role) call to
 * decide whether to 403.
 *
 * Connection string: APP_CONFIG_DATABASE_URL → DATABASE_URL →
 * INSTRUCTION_MONITOR_DATABASE_URL — same fallback chain as `configStore.ts`
 * so a single demo Postgres backs both stores.
 */
import { Pool } from 'pg';
import { resolvePostgresConnectionString } from './postgresConnection.js';

export const USER_ROLES = ['developer', 'analyst', 'engineer', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserProfileRecord {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

function resolveConnectionString(): string | undefined {
  return resolvePostgresConnectionString(['APP_CONFIG_DATABASE_URL', 'DATABASE_URL', 'INSTRUCTION_MONITOR_DATABASE_URL']);
}

export function isUserProfileStoreConfigured(): boolean {
  return Boolean(resolveConnectionString());
}

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = resolveConnectionString();
    if (!connectionString) throw new Error('User profile store is not configured (no APP_CONFIG_DATABASE_URL / DATABASE_URL).');
    pool = new Pool({
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: 'counter-spy-user-profile-store',
      connectionString,
    });
  }
  return pool;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_profiles (
  uid          text PRIMARY KEY,
  email        text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  photo_url    text NOT NULL DEFAULT '',
  role         text NOT NULL DEFAULT 'developer'
               CHECK (role IN ('developer','analyst','engineer','admin')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
`;

let initialized = false;

/** Create the user_profiles table if it doesn't exist. Safe to call repeatedly. */
export async function initUserProfileStore(): Promise<void> {
  if (!isUserProfileStoreConfigured()) return;
  if (initialized) return;
  await getPool().query(SCHEMA_SQL);
  initialized = true;
}

interface UserProfileRow {
  uid: string;
  email: string;
  display_name: string;
  photo_url: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

function rowToRecord(row: UserProfileRow): UserProfileRecord {
  return {
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    photoURL: row.photo_url,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Read one profile. Returns null when no row for `uid` exists. */
export async function getUserProfile(uid: string): Promise<UserProfileRecord | null> {
  await initUserProfileStore();
  const result = await getPool().query<UserProfileRow>(
    'SELECT uid, email, display_name, photo_url, role, created_at, updated_at FROM user_profiles WHERE uid = $1',
    [uid],
  );
  const row = result.rows[0];
  return row ? rowToRecord(row) : null;
}

export interface UpsertUserProfileInput {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
}

/**
 * Upsert the caller's own profile. Role is intentionally *not* an input here:
 * - first-time materialization seeds `role = 'developer'` via the column default;
 * - subsequent writes preserve the stored role via `ON CONFLICT DO UPDATE` that
 *   leaves the `role` column alone.
 *
 * That keeps PUT /v1/users/me from being a role-escalation vector — role
 * changes must go through `setUserRole` on the admin-gated endpoint.
 */
export async function upsertOwnProfile(input: UpsertUserProfileInput): Promise<UserProfileRecord> {
  await initUserProfileStore();
  const result = await getPool().query<UserProfileRow>(
    `INSERT INTO user_profiles (uid, email, display_name, photo_url, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (uid) DO UPDATE
       SET email        = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           photo_url    = EXCLUDED.photo_url,
           updated_at   = EXCLUDED.updated_at
     RETURNING uid, email, display_name, photo_url, role, created_at, updated_at`,
    [input.uid, input.email, input.displayName, input.photoURL],
  );
  return rowToRecord(result.rows[0]!);
}

/** Admin-only: update one user's role. Returns null when the uid doesn't exist. */
export async function setUserRole(uid: string, role: UserRole): Promise<UserProfileRecord | null> {
  await initUserProfileStore();
  const result = await getPool().query<UserProfileRow>(
    `UPDATE user_profiles
        SET role = $2, updated_at = now()
      WHERE uid = $1
      RETURNING uid, email, display_name, photo_url, role, created_at, updated_at`,
    [uid, role],
  );
  const row = result.rows[0];
  return row ? rowToRecord(row) : null;
}

/**
 * Cheap role lookup for the admin-gate middleware. Returns null when the
 * caller has no profile row yet (treated as "not admin" by callers).
 */
export async function getCallerRole(uid: string): Promise<UserRole | null> {
  await initUserProfileStore();
  const result = await getPool().query<{ role: UserRole }>(
    'SELECT role FROM user_profiles WHERE uid = $1',
    [uid],
  );
  return result.rows[0]?.role ?? null;
}

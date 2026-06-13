const DEFAULT_POSTGRES_HOST = 'counter-spy-postgres';
const DEFAULT_POSTGRES_PORT = '5432';
const DEFAULT_POSTGRES_DB = 'counter_spy';
const DEFAULT_POSTGRES_USER = 'counter_spy';

function firstConfiguredEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function resolvePostgresConnectionString(keys: string[]): string | undefined {
  const configured = firstConfiguredEnv(keys);
  if (configured) return configured;

  const password = process.env.POSTGRES_PASSWORD?.trim();
  if (!password) return undefined;

  const host = process.env.POSTGRES_HOST?.trim() || DEFAULT_POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT?.trim() || DEFAULT_POSTGRES_PORT;
  const database = process.env.POSTGRES_DB?.trim() || DEFAULT_POSTGRES_DB;
  const user = process.env.POSTGRES_USER?.trim() || DEFAULT_POSTGRES_USER;

  const url = new URL(`postgres://${host}:${port}/${encodeURIComponent(database)}`);
  url.username = user;
  url.password = password;
  return url.toString();
}

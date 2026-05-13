/**
 * SSRF egress guard for outbound provider calls (safeguard judge, responder LLM,
 * embeddings, translation).
 *
 * The backend talks to several configurable HTTP endpoints. A misconfigured or
 * tampered base URL must not let it reach cloud metadata services or other
 * internal hosts. Loopback / link-local addresses are always rejected; RFC1918
 * private ranges are allowed only when `allowPrivate` is true (dev/demo, where
 * the safeguard model is typically a LAN box). An optional EGRESS_ALLOWLIST of
 * `host` or `host:port` entries always wins.
 */

const LINK_LOCAL_V4 = /^169\.254\./;
const LOOPBACK_V4 = /^127\./;
const PRIVATE_V4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
];

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || LOOPBACK_V4.test(host) || host === '::1' || host === '0.0.0.0' || host === '::';
}

function isLinkLocal(host: string): boolean {
  return LINK_LOCAL_V4.test(host) || host.startsWith('fe80:') || host.startsWith('fe80::');
}

function isPrivate(host: string): boolean {
  return PRIVATE_V4.some((re) => re.test(host)) ||
    host.startsWith('fd') || host.startsWith('fc') || // unique local fc00::/7
    host === 'host.docker.internal';
}

function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export interface EgressGuardOptions {
  /** Allow RFC1918 / CGNAT / docker-internal hosts (true in dev/demo). */
  allowPrivate: boolean;
  /** Comma-separated `host` or `host:port` allowlist (overrides all checks). */
  allowlist?: string;
  /** Label used in thrown error messages, e.g. "SAFEGUARDS_API_BASE_URL". */
  label?: string;
}

/**
 * Throws if `rawUrl` is not a safe outbound target. Returns the parsed URL on success.
 */
export function assertEgressAllowed(rawUrl: string, options: EgressGuardOptions): URL {
  const label = options.label ?? 'outbound URL';
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use http(s).`);
  }

  const host = normalizeHost(url.hostname);
  const allowlist = parseAllowlist(options.allowlist);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (allowlist.has(host) || allowlist.has(`${host}:${port}`)) {
    return url;
  }

  if (isLinkLocal(host)) {
    throw new Error(`${label} resolves to a link-local address (${host}); refusing to send traffic there.`);
  }
  if (isLoopback(host)) {
    if (!options.allowPrivate) {
      throw new Error(`${label} points at loopback (${host}); not allowed outside dev.`);
    }
    return url;
  }
  if (isPrivate(host) && !options.allowPrivate) {
    throw new Error(`${label} points at a private-network address (${host}); not allowed outside dev. Add it to EGRESS_ALLOWLIST to override.`);
  }
  return url;
}

/** Convenience wrapper: validate only if a value is present. Returns the input unchanged. */
export function assertOptionalEgressAllowed(rawUrl: string | undefined, options: EgressGuardOptions): string | undefined {
  if (rawUrl) assertEgressAllowed(rawUrl, options);
  return rawUrl;
}

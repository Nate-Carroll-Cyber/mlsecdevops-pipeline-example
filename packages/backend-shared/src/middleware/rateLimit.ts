/**
 * Dependency-free fixed-window rate limiter.
 *
 * Keyed by the caller's bearer token (so a leaked token cannot be used to run up
 * the safeguard/responder bill unbounded) and falling back to the client IP.
 * Configure via RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX; set RATE_LIMIT_MAX=0 to
 * disable. /healthz is always exempt so container health checks keep working.
 */
import { createHash } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Optional hook fired once per dropped request (e.g. to emit a metric). */
  onLimited?: (req: Request) => void;
  /** Paths that bypass the limiter entirely. */
  exempt?: (req: Request) => boolean;
}

interface WindowState {
  count: number;
  resetAt: number;
}

function callerKey(req: Request): string {
  const auth = req.header('authorization');
  if (auth) {
    return `t:${createHash('sha256').update(auth).digest('hex').slice(0, 24)}`;
  }
  const forwarded = req.header('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0] : undefined)?.trim() || req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const windows = new Map<string, WindowState>();

  return (req: Request, res: Response, next): void => {
    if (options.max <= 0 || (options.exempt && options.exempt(req))) {
      next();
      return;
    }

    const now = Date.now();
    const key = callerKey(req);
    let state = windows.get(key);
    if (!state || state.resetAt <= now) {
      state = { count: 0, resetAt: now + options.windowMs };
      windows.set(key, state);
    }
    state.count += 1;

    // Opportunistic cleanup so the map does not grow without bound.
    if (windows.size > 10_000) {
      for (const [existingKey, existingState] of windows) {
        if (existingState.resetAt <= now) windows.delete(existingKey);
      }
    }

    const remaining = Math.max(0, options.max - state.count);
    res.setHeader('x-ratelimit-limit', String(options.max));
    res.setHeader('x-ratelimit-remaining', String(remaining));
    res.setHeader('x-ratelimit-reset', String(Math.ceil(state.resetAt / 1000)));

    if (state.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
      res.setHeader('retry-after', String(retryAfterSeconds));
      options.onLimited?.(req);
      res.status(429).json({ error: 'Too many requests. Slow down and retry shortly.' });
      return;
    }

    next();
  };
}

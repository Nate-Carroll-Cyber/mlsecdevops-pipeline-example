/**
 * Dev-only console helpers.
 *
 * `devLog` / `devWarn` are no-ops in a production build (`import.meta.env.PROD`),
 * so debug noise doesn't ship to the analyst console. Genuine errors should keep
 * using `console.error` directly — they're meant to surface in any environment.
 */
/* eslint-disable no-console */
const IS_DEV = !import.meta.env.PROD;

export function devLog(...args: unknown[]): void {
  if (IS_DEV) console.log(...args);
}

export function devWarn(...args: unknown[]): void {
  if (IS_DEV) console.warn(...args);
}

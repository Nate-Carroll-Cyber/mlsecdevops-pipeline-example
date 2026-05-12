// Minimal ambient declaration for the bits of `react-dom/server` the SSR entry
// uses. `@types/react-dom` is intentionally not installed (mirrors the existing
// `react-dom-client.d.ts` shim), so this declares just the surface we rely on.
declare module 'react-dom/server' {
  import type { ReactNode } from 'react';

  export function renderToString(children: ReactNode): string;
  export function renderToStaticMarkup(children: ReactNode): string;
}

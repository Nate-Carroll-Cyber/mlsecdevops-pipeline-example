/**
 * Server-side rendering of the analyst console.
 *
 * The React app lives in /src and is built by Vite into two artifact trees:
 *   - dist/client/                  the browser bundle + index.html (hashed asset links)
 *   - dist/server/entry-server.js   the SSR bundle exporting `render(url)`
 *
 * `mountWebApp` adds, to the gateway Express app:
 *   - express.static over dist/client for hashed assets / public files (long-lived
 *     cache for fingerprinted files, no-store for everything else)
 *   - a catch-all GET handler that renders the React tree into the HTML template
 *
 * Degradation:
 *   - if the SSR bundle is missing or render throws, the raw template is served and
 *     the client bundle takes over (CSR) — the console still works;
 *   - if there is no client build at all, a clear 503 is returned.
 *
 * Mounting is the caller's responsibility (server.ts) and must be skipped on the
 * standalone sam-spade service role — the analyst console is a gateway concern.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This module is services/gateway/src/web/ssr.ts in dev (tsx) and
// services/gateway/dist/web/ssr.js when built — both are four levels below
// the repo root.
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const clientDir = path.join(repoRoot, 'dist', 'client');
const templatePath = path.join(clientDir, 'index.html');
const entryServerPath = path.join(repoRoot, 'dist', 'server', 'entry-server.js');

const SSR_OUTLET = '<!--ssr-outlet-->';
const ROOT_DIV_EMPTY = '<div id="root"></div>';
// Vite emits fingerprinted asset filenames like `index-a1b2c3d4.js`; cache those
// forever, and never cache anything else (the HTML template, /sam-spade-ctf-logo.png …).
const FINGERPRINTED_ASSET = /[.\-][0-9a-z]{8,}\.(?:js|mjs|css|woff2?|ttf|eot|png|jpe?g|gif|webp|avif|svg|ico)$/i;

type RenderFn = (url: string) => { html: string };

// `undefined` = not yet attempted, `null` = unavailable (no SSR bundle / failed to load).
let cachedRender: RenderFn | null | undefined;
let cachedTemplate: string | undefined;

async function loadRender(isDev: boolean): Promise<RenderFn | null> {
  if (!isDev && cachedRender !== undefined) return cachedRender;
  if (!existsSync(entryServerPath)) {
    cachedRender = null;
    return null;
  }
  try {
    // In dev, bust the ESM module cache so `vite build --watch` rebuilds are
    // picked up without a server restart. The non-literal specifier also keeps
    // tsc from trying to type-check this Vite artifact (it is not part of
    // services/gateway/tsconfig.json).
    const specifier = isDev
      ? `${pathToFileURL(entryServerPath).href}?t=${Date.now()}`
      : pathToFileURL(entryServerPath).href;
    const mod = (await import(specifier)) as { render?: unknown };
    const render = typeof mod.render === 'function' ? (mod.render as RenderFn) : null;
    if (!isDev) cachedRender = render;
    return render;
  } catch (error) {
    if (!isDev) cachedRender = null;
    console.error('[ssr] failed to load entry-server bundle:', error instanceof Error ? error.message : error);
    return null;
  }
}

function loadTemplate(isDev: boolean): string | null {
  if (!isDev && cachedTemplate !== undefined) return cachedTemplate || null;
  let template: string;
  try {
    template = readFileSync(templatePath, 'utf8');
  } catch {
    template = '';
  }
  if (!isDev) cachedTemplate = template;
  return template || null;
}

function injectAppHtml(template: string, appHtml: string): string {
  if (template.includes(SSR_OUTLET)) return template.replace(SSR_OUTLET, appHtml);
  // Build minifiers can drop HTML comments; fall back to the empty root div Vite leaves behind.
  if (template.includes(ROOT_DIV_EMPTY)) return template.replace(ROOT_DIV_EMPTY, `<div id="root">${appHtml}</div>`);
  return template;
}

async function renderPage(req: Request, res: Response, isDev: boolean): Promise<void> {
  const template = loadTemplate(isDev);
  if (!template) {
    res
      .status(503)
      .type('text/plain; charset=utf-8')
      .send('Analyst console bundle not built. Run `npm run build` (vite client + ssr) before starting the gateway.');
    return;
  }

  let appHtml = '';
  try {
    const render = await loadRender(isDev);
    if (render) appHtml = render(req.originalUrl).html;
  } catch (error) {
    // SSR threw — fall back to client-side rendering of the empty template.
    console.error('[ssr] render failed; serving template for client-side render:', error instanceof Error ? error.stack ?? error.message : error);
    appHtml = '';
  }

  res
    .status(200)
    .type('text/html; charset=utf-8')
    .setHeader('Cache-Control', 'no-store')
    .send(injectAppHtml(template, appHtml));
}

export interface MountWebAppOptions {
  /** When true (APP_ENV=dev) the template and SSR bundle are re-read per request. */
  isDev: boolean;
}

/**
 * Mount static asset serving + the SSR catch-all on `app`.
 *
 * Call this AFTER all `/v1/*` and `/healthz` routes (so API paths win) and BEFORE
 * the JSON 404 handler. The catch-all only handles `GET`/`HEAD` for non-API paths;
 * everything else is passed through untouched.
 */
export function mountWebApp(app: Express, opts: MountWebAppOptions): void {
  const { isDev } = opts;

  if (existsSync(clientDir)) {
    app.use(
      express.static(clientDir, {
        index: false, // '/' must fall through to the SSR handler
        setHeaders: (res, filePath) => {
          res.setHeader('Cache-Control', FINGERPRINTED_ASSET.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (req.path === '/healthz' || req.path === '/v1' || req.path.startsWith('/v1/')) {
      next();
      return;
    }
    void renderPage(req, res, isDev);
  });
}

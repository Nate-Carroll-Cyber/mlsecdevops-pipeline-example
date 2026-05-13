import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The CTF frontend talks to the Counter-Spy gateway (which reverse-proxies
// /v1/ctf/sam-spade/* to the standalone Sam Spade service and handles
// /v1/ctf/review-artifacts itself). Set BACKEND_PROXY_TARGET to the gateway.
//
// CTF_ALLOWED_FRAME_ANCESTORS controls who may embed this app in an <iframe>
// (clickjacking guard). Default allows same-origin plus the local main app.

// Minimal security headers for both the dev server (`vite`) AND the preview
// server (`vite preview`), since the production demo container runs preview.
// The main app embeds this in an iframe — frame-ancestors is the clickjacking guard.
function securityHeadersPlugin(frameAncestors: string): Plugin {
  const applyHeaders = (_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('content-security-policy', `frame-ancestors ${frameAncestors}`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    next();
  };
  return {
    name: 'ctf-frontend-security-headers',
    configureServer(server) { server.middlewares.use(applyHeaders); },
    configurePreviewServer(server) { server.middlewares.use(applyHeaders); },
  };
}

export default defineConfig(() => {
  const backendProxyTarget = process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:18080';
  // The analyst console is now gateway-served on :18080 (the older SPA-only shape
  // lived on :3000); both origins are listed so a clone on either shape can embed
  // the CTF iframe. Override with CTF_ALLOWED_FRAME_ANCESTORS for non-localhost
  // deployments.
  const frameAncestors = process.env.CTF_ALLOWED_FRAME_ANCESTORS || "'self' http://localhost:18080 http://127.0.0.1:18080 http://localhost:3000 http://127.0.0.1:3000";
  const proxy = {
    '/v1': { target: backendProxyTarget, changeOrigin: true },
    '/healthz': { target: backendProxyTarget, changeOrigin: true },
  };
  return {
    plugins: [react(), tailwindcss(), securityHeadersPlugin(frameAncestors)],
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy,
    },
    // The demo container runs `vite preview` against the production build (no
    // HMR client injected). The proxy + host/port mirror the dev server so the
    // CTF iframe at :3001 still routes /v1/* and /healthz to the gateway.
    preview: {
      host: '0.0.0.0',
      port: 3001,
      proxy,
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              // OpenTelemetry web SDK is only imported dynamically by
              // src/lib/webTelemetry.ts — isolate it so it isn't fetched unless
              // VITE_OTEL_EXPORTER_OTLP_ENDPOINT is set.
              { name: 'otel-vendor', test: /node_modules[\\/]@opentelemetry[\\/]/, priority: 30 },
              { name: 'react-vendor', test: /node_modules[\\/](react|react-dom)[\\/]/, priority: 20 },
              { name: 'vendor', test: /node_modules[\\/]/, priority: 10 },
            ],
          },
        },
      },
    },
  };
});

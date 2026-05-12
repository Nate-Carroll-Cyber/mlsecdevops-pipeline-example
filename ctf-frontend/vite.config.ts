import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The CTF frontend talks to the Counter-Spy gateway (which reverse-proxies
// /v1/ctf/sam-spade/* to the standalone Sam Spade service and handles
// /v1/ctf/review-artifacts itself). Set BACKEND_PROXY_TARGET to the gateway.
//
// CTF_ALLOWED_FRAME_ANCESTORS controls who may embed this app in an <iframe>
// (clickjacking guard). Default allows same-origin plus the local main app.

// Minimal security headers for the dev server (the main app embeds this in an iframe).
function securityHeadersPlugin(frameAncestors: string): Plugin {
  return {
    name: 'ctf-frontend-security-headers',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        res.setHeader('content-security-policy', `frame-ancestors ${frameAncestors}`);
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('referrer-policy', 'no-referrer');
        next();
      });
    },
  };
}

export default defineConfig(() => {
  const backendProxyTarget = process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:18080';
  const frameAncestors = process.env.CTF_ALLOWED_FRAME_ANCESTORS || "'self' http://localhost:3000 http://127.0.0.1:3000";
  return {
    plugins: [react(), tailwindcss(), securityHeadersPlugin(frameAncestors)],
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/v1': { target: backendProxyTarget, changeOrigin: true },
        '/healthz': { target: backendProxyTarget, changeOrigin: true },
      },
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

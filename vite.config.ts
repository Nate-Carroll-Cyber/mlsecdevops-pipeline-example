import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Two build outputs feed the server-hosted analyst console:
//   - `vite build`                          -> dist/client/  (browser bundle + index.html template)
//   - `vite build --ssr src/entry-server.tsx` -> dist/server/entry-server.js  (rendered by the gateway)
// The backend gateway (backend/src/web/ssr.ts) serves dist/client statically and
// renders the React tree into the template per request.
export default defineConfig(({isSsrBuild}) => {
  const backendProxyTarget = process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:18080';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/v1': {
          target: backendProxyTarget,
          changeOrigin: true,
        },
        '/healthz': {
          target: backendProxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: isSsrBuild ? 'dist/server' : 'dist/client',
      emptyOutDir: true,
      ...(isSsrBuild
        ? {}
        : {
            rolldownOptions: {
              output: {
                codeSplitting: {
                  groups: [
                    {
                      name: 'react-vendor',
                      test: /node_modules[\\/](react|react-dom)[\\/]/,
                      priority: 50,
                    },
                    {
                      name: 'firebase-vendor',
                      test: /node_modules[\\/](@firebase|firebase)[\\/]/,
                      priority: 40,
                    },
                    {
                      name: 'charts-vendor',
                      test: /node_modules[\\/](recharts|d3-|react-smooth|tiny-invariant)[\\/]/,
                      priority: 35,
                    },
                    {
                      name: 'markdown-vendor',
                      test: /node_modules[\\/](react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|unist-|vfile|trough|bail|zwitch|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities|devlop)[\\/]/,
                      priority: 30,
                    },
                    {
                      // OpenTelemetry web SDK is only imported dynamically by
                      // src/lib/webTelemetry.ts, so isolating it keeps it out of the
                      // eager bundle — the chunk is only fetched when
                      // VITE_OTEL_EXPORTER_OTLP_ENDPOINT is set.
                      name: 'otel-vendor',
                      test: /node_modules[\\/]@opentelemetry[\\/]/,
                      priority: 28,
                    },
                    {
                      name: 'ui-vendor',
                      test: /node_modules[\\/](@base-ui|lucide-react|sonner|next-themes|class-variance-authority|tailwind-merge|clsx|motion)[\\/]/,
                      priority: 20,
                    },
                    {
                      name: 'vendor',
                      test: /node_modules[\\/]/,
                      priority: 10,
                    },
                  ],
                },
              },
            },
          }),
    },
  };
});

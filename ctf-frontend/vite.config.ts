import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The CTF frontend talks to the Counter-Spy gateway (which reverse-proxies
// /v1/ctf/sam-spade/* to the standalone Sam Spade service and handles
// /v1/ctf/review-artifacts itself). Set BACKEND_PROXY_TARGET to the gateway.
export default defineConfig(() => {
  const backendProxyTarget = process.env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:18080';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/v1': { target: backendProxyTarget, changeOrigin: true },
        '/healthz': { target: backendProxyTarget, changeOrigin: true },
      },
    },
  };
});

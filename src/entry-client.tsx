// Browser entry. Built by `vite build` into dist/client/; referenced by index.html.
//
// When the page was server-rendered (the backend gateway injected markup into
// `#root`) we hydrate it; when the same template is served without SSR markup —
// e.g. the Vite dev server, or the gateway's CSR fallback when the SSR bundle is
// missing — we render from scratch instead, which avoids a hydration-mismatch.
import {StrictMode} from 'react';
import {createRoot, hydrateRoot} from 'react-dom/client';
// Optional browser-side OpenTelemetry (no-op unless VITE_OTEL_EXPORTER_OTLP_ENDPOINT is set).
import {startWebTelemetry} from './lib/webTelemetry.ts';
import App from './App.tsx';
// Global CSS / Tailwind directives — importing here makes Vite emit the stylesheet
// and inject its <link> into index.html for both SSR and CSR.
import './index.css';

void startWebTelemetry('counter-spy-frontend');

const container = document.getElementById('root')!;
const tree = (
  <StrictMode>
    <App />
  </StrictMode>
);

if (container.firstElementChild) {
  // Server-rendered markup present → hydrate it.
  hydrateRoot(container, tree);
} else {
  // No SSR markup (dev server / CSR fallback) → render fresh.
  createRoot(container).render(tree);
}

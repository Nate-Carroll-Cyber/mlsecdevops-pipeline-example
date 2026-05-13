// Server-side render entry. Built by `vite build --ssr src/entry-server.tsx` into
// dist/server/entry-server.js, which the backend gateway imports to render the
// analyst console into the HTML template. See services/gateway/src/web/ssr.ts.
import {StrictMode} from 'react';
import {renderToString} from 'react-dom/server';
import App from './App.tsx';

export interface RenderResult {
  html: string;
}

// `url` is the requested path (e.g. `/audit`). The console is currently a
// client-routed single view, so the markup is the same for every path; the
// parameter is kept for when server-side routing/data is wired in (Phase 1b+).
export function render(url: string): RenderResult {
  void url;
  const html = renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return {html};
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installRuntimeSettingsBridge } from './lib/api.ts';
import { startWebTelemetry } from './lib/webTelemetry.ts';
import './index.css';
import { App } from './App.tsx';

// Listen for cross-frame Runtime Settings (safeguardApiKey) from the parent
// Analyst Chat console BEFORE the React tree mounts, so the first postMessage
// the parent fires on iframe `onLoad` is captured.
installRuntimeSettingsBridge();

void startWebTelemetry('counter-spy-ctf-frontend');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

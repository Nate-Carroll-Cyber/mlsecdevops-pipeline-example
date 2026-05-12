import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startWebTelemetry } from './lib/webTelemetry.ts';
import './index.css';
import { App } from './App.tsx';

void startWebTelemetry('counter-spy-ctf-frontend');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

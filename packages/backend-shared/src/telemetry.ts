/**
 * OpenTelemetry bootstrap for the Counter-Spy backend.
 *
 * This module is imported FIRST by backend/src/server.ts (and, for the strongest
 * ESM auto-instrumentation guarantees, can also be passed via
 * `NODE_OPTIONS=--import=./backend/dist/telemetry.js`). It starts an OTel NodeSDK
 * with:
 *   - traces  → OTLP/HTTP (auto-instrumentation for Express, http/https, pg, ...)
 *   - metrics → OTLP/HTTP via a PeriodicExportingMetricReader
 *   - logs    → OTLP/HTTP via a BatchLogRecordProcessor
 *
 * Everything is driven by the standard OTEL_* environment variables
 * (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SERVICE_NAME, OTEL_TRACES_SAMPLER, ...).
 * If no OTLP endpoint / exporter is configured (typical for `npm run backend:dev`
 * and the test suite) the SDK is not started, so the only observability sink is
 * the existing structured stdout JSON in server.ts — i.e. OTEL_SDK_DISABLED=true,
 * or simply leaving OTEL_EXPORTER_OTLP_ENDPOINT unset, is a clean no-op.
 *
 * The OpenTelemetry API surface (trace/metrics/logs) is always safe to call:
 * when the SDK is not started it resolves to no-op providers.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { createRequire } from 'node:module';

export const TELEMETRY_SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'counter-spy-backend';

let sdkRef: NodeSDK | undefined;
let started = false;

function readPackageVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)('../../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function telemetryEnabled(): boolean {
  if (String(process.env.OTEL_SDK_DISABLED).toLowerCase() === 'true') return false;
  // Only stand up the SDK when an exporter is actually configured, so dev and
  // CI runs do not spam OTLP connection-refused warnings.
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
    process.env.OTEL_TRACES_EXPORTER ||
    process.env.OTEL_METRICS_EXPORTER ||
    process.env.OTEL_LOGS_EXPORTER,
  );
}

/** Idempotently start the OpenTelemetry SDK. Safe to call from multiple entrypoints. */
export function startTelemetry(): void {
  if (started) return;
  started = true;
  if (!telemetryEnabled()) return;

  if (process.env.OTEL_LOG_LEVEL) {
    const level = DiagLogLevel[(process.env.OTEL_LOG_LEVEL.toUpperCase() as keyof typeof DiagLogLevel)] ?? DiagLogLevel.INFO;
    diag.setLogger(new DiagConsoleLogger(), level);
  }

  const resource = resourceFromAttributes({
    'service.name': TELEMETRY_SERVICE_NAME,
    'service.version': readPackageVersion(),
    'service.namespace': 'counter-spy',
    'deployment.environment.name': process.env.APP_ENV ?? process.env.NODE_ENV ?? 'dev',
  });

  sdkRef = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 30_000),
    }),
    logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
    instrumentations: [
      getNodeAutoInstrumentations({
        // The local sqlite file is hot; instrumenting fs would be noisy and useless.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdkRef.start();

  const shutdown = () => {
    sdkRef?.shutdown().catch(() => undefined).finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

/** True when the SDK actually started (an OTLP exporter was configured). */
export function isTelemetryActive(): boolean {
  return Boolean(sdkRef);
}

// Auto-start on import so both `import './telemetry.js'` (from server.ts) and
// `node --import ./backend/dist/telemetry.js` work; the `started` guard makes the
// double-entry harmless.
startTelemetry();

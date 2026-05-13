/**
 * Optional browser-side OpenTelemetry tracing.
 *
 * When `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` is set, registers a Web tracer with
 * fetch auto-instrumentation so calls to the Counter-Spy backend (`/v1/*`) become
 * spans and carry a W3C `traceparent` header — the backend's auto-instrumentation
 * picks that up, so frontend and backend traces stitch together. With the env var
 * unset (the default), this is a no-op AND the OpenTelemetry web SDK is never
 * loaded (the imports are dynamic), so it stays out of the initial bundle.
 *
 * The OTLP endpoint is the host-reachable collector URL (e.g. `http://localhost:4318`);
 * the collector must allow the page's origin in its OTLP/HTTP CORS config.
 */
let started = false;

export async function startWebTelemetry(serviceName: string): Promise<void> {
  if (started) return;
  started = true;
  const endpoint = (import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
  if (!endpoint) return;

  const [
    { WebTracerProvider, BatchSpanProcessor },
    { registerInstrumentations },
    { FetchInstrumentation },
    { OTLPTraceExporter },
    { resourceFromAttributes },
  ] = await Promise.all([
    import('@opentelemetry/sdk-trace-web'),
    import('@opentelemetry/instrumentation'),
    import('@opentelemetry/instrumentation-fetch'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
  ]);

  const traceUrl = `${endpoint.replace(/\/$/, '')}/v1/traces`;
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'service.namespace': 'counter-spy',
      'deployment.environment.name': import.meta.env.MODE ?? 'development',
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: traceUrl }))],
  });
  provider.register();

  // Propagate trace context to our own backend (relative `/v1/...` paths and the
  // configured API base URL); don't add headers to third-party requests.
  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
  const propagateUrls: Array<string | RegExp> = [/\/v1\//];
  if (apiBase) propagateUrls.push(apiBase);

  // FetchInstrumentation wraps `window.fetch` globally — even when no
  // traceparent is propagated, the wrapper inspects the Request/Response which
  // can break long-polling cross-origin endpoints. Firestore's Listen channel
  // fails CORS preflight with a "Fetch API cannot load … due to access control
  // checks" error when the wrapped fetch flows through it, killing real-time
  // listeners (and with them the app's auth/governance state). Also exclude
  // Firebase Auth and Identity-Toolkit endpoints for the same reason.
  const ignoreUrls: Array<string | RegExp> = [
    traceUrl,
    /firestore\.googleapis\.com/,
    /firebaseapp\.com/,
    /identitytoolkit\.googleapis\.com/,
    /securetoken\.googleapis\.com/,
  ];

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: propagateUrls,
        clearTimingResources: true,
        ignoreUrls,
      }),
    ],
  });
}

/**
 * Shared structured logging + OpenTelemetry instruments.
 * Each service builds its own observability instance at boot with its service
 * name and log level; the helpers below emit to stdout JSON (CloudWatch
 * friendly) and forward to the OTel SDK installed by telemetry.ts.
 */
import { metrics, trace, type Attributes } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

export const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

const OTEL_SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export interface ObservabilityConfig {
  // OTel meter/logger name; also tagged on each stdout log record.
  telemetryServiceName: string;
  // Friendly service name written into each stdout log record (e.g. counter-spy-backend).
  logServiceName: string;
  // 'dev' | 'test' | 'prod' or similar — appears on each stdout record.
  environment: string;
  // Minimum severity to emit (debug | info | warn | error).
  minLogLevel: LogLevel;
}

export interface Observability {
  log: (level: LogLevel, message: string, extra?: Record<string, unknown>) => void;
  emitMetricIncrement: (name: string, tags: Record<string, string | boolean | number | undefined>) => void;
  toOtelAttributes: (tags: Record<string, unknown>) => Attributes;
  // Direct access to the underlying meter so a service can mint its own
  // histograms/counters with custom descriptions/units.
  meter: ReturnType<typeof metrics.getMeter>;
}

export function createObservability(config: ObservabilityConfig): Observability {
  const meter = metrics.getMeter(config.telemetryServiceName);
  const logger = logs.getLogger(config.telemetryServiceName);
  const dynamicCounters = new Map<string, ReturnType<typeof meter.createCounter>>();

  function toOtelAttributes(tags: Record<string, unknown>): Attributes {
    const attributes: Attributes = {};
    for (const [key, value] of Object.entries(tags)) {
      if (value === undefined || value === null) continue;
      attributes[key] = typeof value === 'object' ? JSON.stringify(value) : (value as string | number | boolean);
    }
    return attributes;
  }

  function getDynamicCounter(metricName: string) {
    const fullName = `counterspy.${metricName}`;
    let counter = dynamicCounters.get(fullName);
    if (!counter) {
      counter = meter.createCounter(fullName, { description: `Counter-Spy event counter: ${metricName}.` });
      dynamicCounters.set(fullName, counter);
    }
    return counter;
  }

  function log(level: LogLevel, message: string, extra: Record<string, unknown> = {}) {
    if (LOG_LEVELS[level] < LOG_LEVELS[config.minLogLevel]) {
      return;
    }

    const spanContext = trace.getActiveSpan()?.spanContext();
    const record = {
      level,
      message,
      service: config.logServiceName,
      environment: config.environment,
      timestamp: new Date().toISOString(),
      ...(spanContext ? { trace_id: spanContext.traceId, span_id: spanContext.spanId } : {}),
      ...extra,
    };
    console.log(JSON.stringify(record));
    logger.emit({
      severityNumber: OTEL_SEVERITY[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: toOtelAttributes(extra),
    });
  }

  function emitMetricIncrement(name: string, tags: Record<string, string | boolean | number | undefined>) {
    getDynamicCounter(name).add(1, toOtelAttributes(tags));
    log('info', 'metric_increment', {
      metric: name,
      value: 1,
      tags,
    });
  }

  return { log, emitMetricIncrement, toOtelAttributes, meter };
}

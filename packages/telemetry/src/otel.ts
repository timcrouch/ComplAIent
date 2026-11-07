import { loadConfig, telemetryConfig } from "@isms/config";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { NestInstrumentation } from "@opentelemetry/instrumentation-nestjs-core";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | undefined;

/**
 * Starts tracing and metrics. Call before any instrumented library (http, pg, ioredis,
 * express) is loaded. Traces are exported over OTLP only when an endpoint is configured;
 * Prometheus metrics are always served on METRICS_PORT, or on `options.metricsPort` when
 * given (the worker passes its own port so it can run beside the API). SIGTERM shuts the SDK
 * down unless `handleSignals` is false.
 */
export function startTelemetry(
  service: string,
  options: { metricsPort?: number; handleSignals?: boolean } = {},
): void {
  if (sdk) return;
  const config = loadConfig(telemetryConfig);
  const endpoint = config.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, "");
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": service }),
    metricReaders: [new PrometheusExporter({ port: options.metricsPort ?? config.METRICS_PORT })],
    ...(endpoint ? { traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) } : {}),
    instrumentations: [
      new HttpInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });
  sdk.start();
  // The worker passes handleSignals: false and calls shutdownTelemetry() from its own handler.
  if (options.handleSignals ?? true) {
    process.once("SIGTERM", () => {
      void shutdownTelemetry();
    });
  }
}

/** Flushes and stops the SDK. Safe to call more than once. */
export async function shutdownTelemetry(): Promise<void> {
  const current = sdk;
  sdk = undefined;
  await current?.shutdown();
}

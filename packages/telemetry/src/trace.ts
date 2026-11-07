import {
  type Context,
  context as otelContext,
  isSpanContextValid,
  trace,
} from "@opentelemetry/api";

/** The trace id of the span active in `ctx` (default: the current context), if valid. */
export function activeTraceId(ctx: Context = otelContext.active()): string | undefined {
  const spanContext = trace.getSpan(ctx)?.spanContext();
  return spanContext && isSpanContextValid(spanContext) ? spanContext.traceId : undefined;
}

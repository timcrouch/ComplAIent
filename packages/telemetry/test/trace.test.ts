import { ROOT_CONTEXT, TraceFlags, trace } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { activeTraceId } from "../src/index.js";

describe("activeTraceId", () => {
  it("is undefined when no span is active", () => {
    expect(activeTraceId()).toBeUndefined();
    expect(activeTraceId(ROOT_CONTEXT)).toBeUndefined();
  });

  it("returns the trace id of the span in the context", () => {
    const span = trace.wrapSpanContext({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
    });
    expect(activeTraceId(trace.setSpan(ROOT_CONTEXT, span))).toBe(
      "0af7651916cd43dd8448eb211c80319c",
    );
  });

  it("ignores an invalid span context", () => {
    const span = trace.wrapSpanContext({
      traceId: "00000000000000000000000000000000",
      spanId: "0000000000000000",
      traceFlags: TraceFlags.NONE,
    });
    expect(activeTraceId(trace.setSpan(ROOT_CONTEXT, span))).toBeUndefined();
  });
});

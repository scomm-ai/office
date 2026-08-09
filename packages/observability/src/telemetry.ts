/** Optional OpenTelemetry-compatible span interface — no hard OTEL dependency. */

export interface TelemetrySpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface TelemetrySpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attributes: TelemetrySpanAttributes): void;
  recordException(error: unknown): void;
  end(): void;
}

export interface TelemetryTracer {
  startSpan(name: string, attributes?: TelemetrySpanAttributes): TelemetrySpan;
}

export const noopTelemetrySpan: TelemetrySpan = {
  setAttribute() {},
  setAttributes() {},
  recordException() {},
  end() {},
};

export const noopTelemetryTracer: TelemetryTracer = {
  startSpan() {
    return noopTelemetrySpan;
  },
};

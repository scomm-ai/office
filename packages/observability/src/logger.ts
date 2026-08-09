const DEFAULT_REDACTED_KEYS = [
  "token",
  "accessToken",
  "access_token",
  "authorization",
  "Authorization",
  "privateKey",
  "private_key",
  "secret",
  "password",
  "apiKey",
  "api_key",
  "body",
  "html",
  "plainText",
  "messageBody",
  "prompt",
  "credentials",
] as const;

const REDACTED = "[REDACTED]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redact<T>(value: T, keys: string[] = [...DEFAULT_REDACTED_KEYS]): T {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));

  function walk(current: unknown): unknown {
    if (Array.isArray(current)) {
      return current.map(walk);
    }
    if (!isPlainObject(current)) {
      return current;
    }

    const result: Record<string, unknown> = {};
    for (const [field, fieldValue] of Object.entries(current)) {
      if (keySet.has(field.toLowerCase())) {
        result[field] = REDACTED;
      } else {
        result[field] = walk(fieldValue);
      }
    }
    return result;
  }

  return walk(value) as T;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function writeLog(
  level: LogLevel,
  name: string,
  message: string,
  fields?: Record<string, unknown>,
): void {
  const payload = redact({
    level,
    logger: name,
    message,
    timestamp: new Date().toISOString(),
    ...fields,
  });

  const line = JSON.stringify(payload);

  switch (level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export function createLogger(name: string): StructuredLogger {
  return {
    debug(message, fields) {
      writeLog("debug", name, message, fields);
    },
    info(message, fields) {
      writeLog("info", name, message, fields);
    },
    warn(message, fields) {
      writeLog("warn", name, message, fields);
    },
    error(message, fields) {
      writeLog("error", name, message, fields);
    },
  };
}

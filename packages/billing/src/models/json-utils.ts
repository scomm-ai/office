export function getKey(obj: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(obj, name) && obj[name] !== undefined) {
      return obj[name];
    }
  }
  return undefined;
}

export function parseIntValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function dateTimeFromUnixSeconds(seconds: number): Date {
  return new Date(seconds * 1000);
}

export function decodeJwtPayloadJson(token: string): Record<string, unknown> | null {
  try {
    const parts = token.trim().split(".");
    if (parts.length < 2 || !parts[1]) {
      return null;
    }
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = raw.length % 4 === 2 ? "==" : raw.length % 4 === 3 ? "=" : "";
    const json = atob(raw + pad);
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function decodeJwtAlg(token: string): string | null {
  try {
    const parts = token.trim().split(".");
    if (parts.length < 2 || !parts[0]) {
      return null;
    }
    const raw = parts[0].replace(/-/g, "+").replace(/_/g, "/");
    const pad = raw.length % 4 === 2 ? "==" : raw.length % 4 === 3 ? "=" : "";
    const parsed: unknown = JSON.parse(atob(raw + pad));
    if (typeof parsed !== "object" || parsed === null || !("alg" in parsed)) {
      return null;
    }
    const alg = (parsed as { alg: unknown }).alg;
    return typeof alg === "string" ? alg : null;
  } catch {
    return null;
  }
}

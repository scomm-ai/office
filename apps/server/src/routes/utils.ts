const PRIVATE_KEY_FIELD_PATTERN =
  /^(private[_-]?key|secret[_-]?key|privatekeymaterial|x$|d$|p$|q$|dp$|dq$|qi$)$/i;

export function assertNoPrivateKeyMaterial(value: unknown, path = "body"): void {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateKeyMaterial(entry, `${path}[${index}]`));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_KEY_FIELD_PATTERN.test(key)) {
      throw new Error(`Private key material is not accepted at ${path}.${key}`);
    }
    assertNoPrivateKeyMaterial(nested, `${path}.${key}`);
  }
}

export function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

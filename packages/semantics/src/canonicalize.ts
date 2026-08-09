import { createHash } from "node:crypto";
import type { SemanticMailDocument } from "./models.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }

  return value;
}

export function canonicalizeSemanticDocument(doc: SemanticMailDocument): string {
  return JSON.stringify(sortValue(doc));
}

async function sha256HexViaWebCrypto(input: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return null;
  }

  const encoded = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256SemanticDocument(doc: SemanticMailDocument): Promise<string> {
  const canonical = canonicalizeSemanticDocument(doc);
  const webDigest = await sha256HexViaWebCrypto(canonical);
  if (webDigest) {
    return webDigest;
  }

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

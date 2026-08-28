import type { PublicKeyCache, PublicKeyCacheEntry, CryptoFamily } from "./types.js";

export class MemoryPublicKeyCache implements PublicKeyCache {
  private readonly entries = new Map<string, PublicKeyCacheEntry>();

  private key(identity: string, family: CryptoFamily, purpose: string): string {
    return `${identity.toLowerCase()}:${family}:${purpose}`;
  }

  async get(
    identity: string,
    family: CryptoFamily,
    purpose: "sign" | "encrypt",
  ): Promise<PublicKeyCacheEntry | null> {
    return this.entries.get(this.key(identity, family, purpose)) ?? null;
  }

  async put(entry: PublicKeyCacheEntry): Promise<void> {
    this.entries.set(this.key(entry.identity, entry.family, "encrypt"), entry);
    this.entries.set(this.key(entry.identity, entry.family, "sign"), entry);
  }

  isFresh(entry: PublicKeyCacheEntry, maxAgeMs: number): boolean {
    const last = Date.parse(entry.lastValidated ?? entry.lastSeen);
    return Date.now() - last < maxAgeMs;
  }
}

/** Format full fingerprint to SComm short display id (abcd-1234 style from last 8 hex). */
export function formatShortKeyId(fingerprint: string): string {
  const hex = fingerprint.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  const short = hex.slice(-8);
  if (short.length < 8) return short;
  return `${short.slice(0, 4)}-${short.slice(4)}`;
}

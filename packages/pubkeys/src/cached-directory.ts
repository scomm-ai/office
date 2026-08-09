import {
  identityComparisonKey,
  parseIdentity,
  type ScommIdentity,
} from "@scomm-office/identity";
import type { PublicKeyRecord } from "@scomm-office/protocol";
import type { PublicKeyDirectory } from "./directory.js";
import { filterUsableKeys } from "./filter.js";

interface CacheEntry {
  records: PublicKeyRecord[];
  expiresAt: number;
}

export interface CachedPublicKeyDirectoryOptions {
  /** TTL for usable key lists (default 5 minutes). */
  ttlMs?: number;
  /** Short TTL when upstream returns unusable keys that were filtered out (default 30 seconds). */
  shortTtlMs?: number;
  now?: () => number;
}

export class CachedPublicKeyDirectory implements PublicKeyDirectory {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly shortTtlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly inner: PublicKeyDirectory,
    options: CachedPublicKeyDirectoryOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.shortTtlMs = options.shortTtlMs ?? 30 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  async getKeys(identity: ScommIdentity): Promise<PublicKeyRecord[]> {
    const cacheKey = identityComparisonKey(identity);
    const currentTime = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > currentTime) {
      return [...cached.records];
    }

    const upstream = await this.inner.getKeys(identity);
    const usable = filterUsableKeys(upstream, currentTime);
    const hadFiltered = usable.length < upstream.length;
    const ttl = hadFiltered ? this.shortTtlMs : this.ttlMs;

    this.cache.set(cacheKey, {
      records: usable,
      expiresAt: currentTime + ttl,
    });

    return [...usable];
  }

  async setKey(record: PublicKeyRecord): Promise<PublicKeyRecord> {
    const saved = await this.inner.setKey(record);
    const identity = parseIdentity(record.identity.type, record.identity.value);
    this.cache.delete(identityComparisonKey(identity));
    return saved;
  }

  async revokeKey(identity: ScommIdentity, keyId: string, reason?: string): Promise<void> {
    if (this.inner.revokeKey) {
      await this.inner.revokeKey(identity, keyId, reason);
    }
    this.cache.delete(identityComparisonKey(identity));
  }

  invalidate(identity: ScommIdentity): void {
    this.cache.delete(identityComparisonKey(identity));
  }

  clearCache(): void {
    this.cache.clear();
  }
}

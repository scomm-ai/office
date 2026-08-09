import {
  createEmailIdentity,
  identityComparisonKey,
  identityToProtocolIdentity,
  type ScommIdentity,
} from "@scomm-office/identity";
import type { PublicKeyRecord } from "@scomm-office/protocol";
import type { PublicKeyDirectory } from "./directory.js";

export class MockPublicKeyDirectory implements PublicKeyDirectory {
  private readonly store = new Map<string, Map<string, PublicKeyRecord>>();

  async getKeys(identity: ScommIdentity): Promise<PublicKeyRecord[]> {
    const bucket = this.store.get(identityComparisonKey(identity));
    if (!bucket) {
      return [];
    }
    return [...bucket.values()];
  }

  async setKey(record: PublicKeyRecord): Promise<PublicKeyRecord> {
    const identity = record.identity;
    const key =
      identity.type === "email"
        ? createEmailIdentity(identity.value)
        : ({ type: identity.type, value: identity.value } as ScommIdentity);
    const bucketKey = identityComparisonKey(key);
    let bucket = this.store.get(bucketKey);
    if (!bucket) {
      bucket = new Map();
      this.store.set(bucketKey, bucket);
    }
    bucket.set(record.keyId, { ...record });
    return { ...record };
  }

  async revokeKey(identity: ScommIdentity, keyId: string, reason?: string): Promise<void> {
    const bucket = this.store.get(identityComparisonKey(identity));
    if (!bucket) {
      return;
    }
    const existing = bucket.get(keyId);
    if (!existing) {
      return;
    }
    bucket.set(keyId, {
      ...existing,
      state: "revoked",
      metadata: {
        ...existing.metadata,
        ...(reason !== undefined ? { revokeReason: reason } : {}),
      },
    });
  }

  clear(): void {
    this.store.clear();
  }

  /** Test helper — direct lookup without protocol identity normalization. */
  snapshot(): PublicKeyRecord[] {
    const records: PublicKeyRecord[] = [];
    for (const bucket of this.store.values()) {
      records.push(...bucket.values());
    }
    return records;
  }

  /** Ensures protocol identity on stored records matches lookup identity. */
  static identityKey(identity: ScommIdentity): string {
    return identityComparisonKey(identity);
  }

  static protocolIdentity(identity: ScommIdentity) {
    return identityToProtocolIdentity(identity);
  }
}

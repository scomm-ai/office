import { describe, expect, it, vi } from "vitest";
import { createEmailIdentity } from "@scomm-office/identity";
import type { PublicKeyRecord } from "@scomm-office/protocol";
import { CachedPublicKeyDirectory } from "./cached-directory.js";
import { MockPublicKeyDirectory } from "./mock-directory.js";

const alice = createEmailIdentity("alice@example.com");

function makeRecord(overrides: Partial<PublicKeyRecord> = {}): PublicKeyRecord {
  return {
    version: 1,
    identity: { type: "email", value: "alice@example.com" },
    keyId: "key-001",
    algorithm: "Ed25519",
    publicKey: "dGVzdC1rZXk",
    encoding: "base64url",
    purpose: "signing",
    state: "active",
    trust: "directory-asserted",
    createdAt: "2026-01-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("MockPublicKeyDirectory", () => {
  it("stores and retrieves keys by identity", async () => {
    const dir = new MockPublicKeyDirectory();
    const record = makeRecord();
    await dir.setKey(record);

    const keys = await dir.getKeys(alice);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.keyId).toBe("key-001");
  });

  it("revokes a key", async () => {
    const dir = new MockPublicKeyDirectory();
    await dir.setKey(makeRecord());
    await dir.revokeKey(alice, "key-001", "compromised");

    const keys = await dir.getKeys(alice);
    expect(keys[0]?.state).toBe("revoked");
    expect(keys[0]?.metadata?.revokeReason).toBe("compromised");
  });

  it("returns empty list for unknown identity", async () => {
    const dir = new MockPublicKeyDirectory();
    expect(await dir.getKeys(createEmailIdentity("nobody@example.com"))).toEqual([]);
  });
});

describe("CachedPublicKeyDirectory", () => {
  it("filters revoked keys on get and uses short TTL when filtering occurs", async () => {
    const inner = new MockPublicKeyDirectory();
    await inner.setKey(makeRecord({ keyId: "active-key", state: "active" }));
    await inner.setKey(makeRecord({ keyId: "revoked-key", state: "revoked" }));

    let now = 1_000_000;
    const getKeysSpy = vi.spyOn(inner, "getKeys");
    const cached = new CachedPublicKeyDirectory(inner, {
      ttlMs: 60_000,
      shortTtlMs: 5_000,
      now: () => now,
    });

    const first = await cached.getKeys(alice);
    expect(first).toHaveLength(1);
    expect(first[0]?.keyId).toBe("active-key");
    expect(getKeysSpy).toHaveBeenCalledTimes(1);

    now += 2_000;
    await cached.getKeys(alice);
    expect(getKeysSpy).toHaveBeenCalledTimes(1);

    now += 4_000;
    await cached.getKeys(alice);
    expect(getKeysSpy).toHaveBeenCalledTimes(2);
  });

  it("invalidates cache after setKey", async () => {
    const inner = new MockPublicKeyDirectory();
    const cached = new CachedPublicKeyDirectory(inner);
    await cached.getKeys(alice);
    await cached.setKey(makeRecord({ keyId: "key-002" }));

    const keys = await cached.getKeys(alice);
    expect(keys.some((key) => key.keyId === "key-002")).toBe(true);
  });
});

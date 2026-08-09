import { describe, expect, it } from "vitest";
import { publicKeyRecordSchema } from "./pubkey.js";

const validRecord = {
  version: 1 as const,
  identity: { type: "email" as const, value: "alice@example.com" },
  keyId: "key-001",
  algorithm: "Ed25519" as const,
  publicKey: "dGVzdC1rZXk",
  encoding: "base64url" as const,
  purpose: "signing" as const,
  state: "active" as const,
  trust: "directory-asserted" as const,
  createdAt: "2026-01-15T12:00:00.000Z",
};

describe("publicKeyRecordSchema", () => {
  it("accepts a valid Ed25519 signing record", () => {
    const parsed = publicKeyRecordSchema.parse(validRecord);
    expect(parsed.version).toBe(1);
    expect(parsed.identity.type).toBe("email");
    expect(parsed.algorithm).toBe("Ed25519");
  });

  it("accepts custom algorithm strings", () => {
    const parsed = publicKeyRecordSchema.parse({
      ...validRecord,
      algorithm: "RSA-PSS-4096",
    });
    expect(parsed.algorithm).toBe("RSA-PSS-4096");
  });

  it("accepts jwk encoding", () => {
    const parsed = publicKeyRecordSchema.parse({
      ...validRecord,
      encoding: "jwk",
      publicKey: JSON.stringify({ kty: "OKP", crv: "Ed25519" }),
    });
    expect(parsed.encoding).toBe("jwk");
  });

  it("rejects wrong version", () => {
    expect(() =>
      publicKeyRecordSchema.parse({ ...validRecord, version: 2 }),
    ).toThrow();
  });

  it("rejects empty identity value", () => {
    expect(() =>
      publicKeyRecordSchema.parse({
        ...validRecord,
        identity: { type: "email", value: "" },
      }),
    ).toThrow();
  });

  it("rejects invalid key state", () => {
    expect(() =>
      publicKeyRecordSchema.parse({ ...validRecord, state: "deleted" }),
    ).toThrow();
  });

  it("rejects invalid trust level", () => {
    expect(() =>
      publicKeyRecordSchema.parse({ ...validRecord, trust: "fully-trusted" }),
    ).toThrow();
  });

  it("rejects malformed datetime", () => {
    expect(() =>
      publicKeyRecordSchema.parse({ ...validRecord, createdAt: "not-a-date" }),
    ).toThrow();
  });
});

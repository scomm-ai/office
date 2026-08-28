import { describe, expect, it } from "vitest";
import { CryptoErrorCodes, MemoryPublicKeyCache, formatShortKeyId, detectProtectionKind } from "./index.js";

describe("@scomm-office/crypto", () => {
  it("formats short key ids", () => {
    expect(formatShortKeyId("aabbccddeeff00112233445566778899")).toBe("6677-8899");
  });

  it("caches public keys", async () => {
    const cache = new MemoryPublicKeyCache();
    await cache.put({
      identity: "alice@example.com",
      family: "openpgp" as import("./types.js").CryptoFamily,
      algorithm: "openpgp-cv25519",
      keyId: "6677-8899",
      fingerprint: "aabbccddeeff00112233445566778899",
      publicKey: new Uint8Array([1]),
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      status: "active",
      source: "test",
    });
    const hit = await cache.get("alice@example.com", "openpgp" as import("./types.js").CryptoFamily, "encrypt");
    expect(hit?.fingerprint).toContain("8899");
  });

  it("detects openpgp signed mime", () => {
    const mime = new TextEncoder().encode(
      'Content-Type: multipart/signed; protocol="application/pgp-signature"',
    );
    expect(detectProtectionKind(mime)).toBe("openpgp-signed");
  });

  it("exports error codes", () => {
    expect(CryptoErrorCodes.EncryptionDowngradeBlocked).toBe("EncryptionDowngradeBlocked");
  });
});

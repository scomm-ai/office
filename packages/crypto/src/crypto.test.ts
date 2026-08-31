import { describe, expect, it } from "vitest";
import {
  CryptoErrorCodes,
  CryptoFamily,
  MemoryPublicKeyCache,
  formatShortKeyId,
  detectProtectionKind,
} from "./index.js";
import { ScommMessageEncryptor, ScommMessageDecryptor } from "./scomm-encryptor.js";

describe("@scomm-office/crypto", () => {
  it("formats short key ids", () => {
    expect(formatShortKeyId("aabbccddeeff00112233445566778899")).toBe("6677-8899");
  });

  it("caches public keys", async () => {
    const cache = new MemoryPublicKeyCache();
    await cache.put({
      identity: "alice@example.com",
      family: CryptoFamily.OpenPGP,
      algorithm: "openpgp-cv25519",
      keyId: "6677-8899",
      fingerprint: "aabbccddeeff00112233445566778899",
      publicKey: new Uint8Array([1]),
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      status: "active",
      source: "test",
    });
    const hit = await cache.get("alice@example.com", CryptoFamily.OpenPGP, "encrypt");
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

describe("ScommMessageEncryptor + ScommMessageDecryptor", () => {
  async function generateTestKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const pubB64 = btoa(String.fromCharCode(...new Uint8Array(pubRaw)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return { keyPair, pubB64 };
  }

  it("encrypts and decrypts a message round-trip", async () => {
    const { keyPair, pubB64 } = await generateTestKeyPair();

    const encryptor = new ScommMessageEncryptor();
    const decryptor = new ScommMessageDecryptor(async (keyId) => {
      if (keyId === "test-key-1") {
        return keyPair.privateKey;
      }
      return null;
    });

    const original = {
      subject: "Test Subject",
      body: "Hello, this is a secret message!",
      headers: { "X-Custom": "value" },
    };

    const encrypted = await encryptor.encrypt(original, [
      {
        identity: "alice@example.com",
        keyId: "test-key-1",
        publicKey: pubB64,
        algorithm: "ECDH-P256",
      },
    ]);

    expect(encrypted.envelopeVersion).toBe(1);
    expect(encrypted.ciphertext).toBeTruthy();

    const decrypted = await decryptor.decrypt(encrypted);
    expect(decrypted.subject).toBe(original.subject);
    expect(decrypted.body).toBe(original.body);
    expect(decrypted.headers?.["X-Custom"]).toBe("value");
  });

  it("encrypts for multiple recipients", async () => {
    const alice = await generateTestKeyPair();
    const bob = await generateTestKeyPair();

    const encryptor = new ScommMessageEncryptor();

    const encrypted = await encryptor.encrypt(
      { body: "Multi-recipient secret" },
      [
        { identity: "alice@test.com", keyId: "alice-key", publicKey: alice.pubB64, algorithm: "ECDH-P256" },
        { identity: "bob@test.com", keyId: "bob-key", publicKey: bob.pubB64, algorithm: "ECDH-P256" },
      ],
    );

    // Alice can decrypt
    const aliceDecryptor = new ScommMessageDecryptor(async (keyId) =>
      keyId === "alice-key" ? alice.keyPair.privateKey : null,
    );
    const aliceResult = await aliceDecryptor.decrypt(encrypted);
    expect(aliceResult.body).toBe("Multi-recipient secret");

    // Bob can decrypt
    const bobDecryptor = new ScommMessageDecryptor(async (keyId) =>
      keyId === "bob-key" ? bob.keyPair.privateKey : null,
    );
    const bobResult = await bobDecryptor.decrypt(encrypted);
    expect(bobResult.body).toBe("Multi-recipient secret");
  });

  it("fails to decrypt without matching key", async () => {
    const { pubB64 } = await generateTestKeyPair();

    const encryptor = new ScommMessageEncryptor();
    const decryptor = new ScommMessageDecryptor(async () => null);

    const encrypted = await encryptor.encrypt(
      { body: "secret" },
      [{ identity: "a@b.com", keyId: "k1", publicKey: pubB64, algorithm: "ECDH-P256" }],
    );

    await expect(decryptor.decrypt(encrypted)).rejects.toThrow(
      "no matching private key",
    );
  });

  it("throws when no recipients provided", async () => {
    const encryptor = new ScommMessageEncryptor();
    await expect(
      encryptor.encrypt({ body: "secret" }, []),
    ).rejects.toThrow("At least one recipient");
  });
});

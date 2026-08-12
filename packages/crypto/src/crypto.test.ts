import { describe, expect, it } from "vitest";
import { UnsupportedFeatureError } from "@scomm-office/core";
import { ExperimentalMessageDecryptor, ExperimentalMessageEncryptor } from "./experimental.js";
import { ScommMessageEncryptor, ScommMessageDecryptor } from "./scomm-encryptor.js";

describe("ExperimentalMessageEncryptor", () => {
  it("throws UnsupportedFeatureError citing e2ee-protocol spec", async () => {
    const encryptor = new ExperimentalMessageEncryptor();
    await expect(
      encryptor.encrypt({ body: "secret" }, [{ identity: "a@b.com", keyId: "k1", publicKey: "pk", algorithm: "X25519" }]),
    ).rejects.toThrow(UnsupportedFeatureError);
    await expect(
      encryptor.encrypt({ body: "secret" }, [{ identity: "a@b.com", keyId: "k1", publicKey: "pk", algorithm: "X25519" }]),
    ).rejects.toThrow("openspec/security/e2ee-protocol.md");
  });
});

describe("ExperimentalMessageDecryptor", () => {
  it("throws UnsupportedFeatureError citing e2ee-protocol spec", async () => {
    const decryptor = new ExperimentalMessageDecryptor();
    await expect(
      decryptor.decrypt({ envelopeVersion: 0, ciphertext: "x", recipients: [] }),
    ).rejects.toThrow(UnsupportedFeatureError);
    await expect(
      decryptor.decrypt({ envelopeVersion: 0, ciphertext: "x", recipients: [] }),
    ).rejects.toThrow("openspec/security/e2ee-protocol.md");
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

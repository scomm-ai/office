import { describe, expect, it } from "vitest";
import { UnsupportedFeatureError } from "@scomm-office/core";
import {
  DevMemoryKeyStore,
  MemoryUserSettingsStore,
  UnsupportedKeyStore,
  generateDkek,
  unwrapSecretWithDkek,
  wrapSecretWithDkek,
} from "./index.js";

describe("MemoryUserSettingsStore", () => {
  it("stores and retrieves settings", async () => {
    const store = new MemoryUserSettingsStore<{ theme: string }>();
    expect(await store.get()).toBeNull();

    await store.set({ theme: "dark" });
    expect(await store.get()).toEqual({ theme: "dark" });
  });
});

describe("UnsupportedKeyStore", () => {
  it("throws UnsupportedFeatureError for private key access", async () => {
    const store = new UnsupportedKeyStore();
    await expect(store.getPrivate("any")).rejects.toBeInstanceOf(UnsupportedFeatureError);
  });
});

describe("device-secret DKEK wrapping", () => {
  it("round-trips the secret through a non-extractable AES-GCM key", async () => {
    const dkek = await generateDkek();
    expect(dkek.extractable).toBe(false);

    const secret = "device-unlock-secret-example";
    const { iv, ciphertext } = await wrapSecretWithDkek(dkek, secret);
    expect(new TextDecoder().decode(ciphertext)).not.toContain(secret);

    const unwrapped = await unwrapSecretWithDkek(dkek, iv, ciphertext);
    expect(unwrapped).toBe(secret);
  });

  it("fails to unwrap with a different key", async () => {
    const dkek = await generateDkek();
    const other = await generateDkek();
    const { iv, ciphertext } = await wrapSecretWithDkek(dkek, "top-secret");
    await expect(unwrapSecretWithDkek(other, iv, ciphertext)).rejects.toBeTruthy();
  });

  it("produces a fresh key and IV on every wrap", async () => {
    const dkek = await generateDkek();
    const a = await wrapSecretWithDkek(dkek, "same-secret");
    const b = await wrapSecretWithDkek(dkek, "same-secret");
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });
});

describe("DevMemoryKeyStore", () => {
  it("generates keys for dev/test use", async () => {
    const store = new DevMemoryKeyStore();
    const pair = await store.generate({ algorithm: "Ed25519", purpose: "signing" });
    expect(pair.keyId).toMatch(/^dev-key-/);

    const fetched = await store.getPublic(pair.keyId);
    expect(fetched?.publicKey).toBe(pair.publicKey);

    const privateKey = await store.getPrivate(pair.keyId);
    expect(privateKey.byteLength).toBeGreaterThan(0);
  });
});

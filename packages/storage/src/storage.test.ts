import { describe, expect, it } from "vitest";
import { UnsupportedFeatureError } from "@scomm-office/core";
import { DevMemoryKeyStore, MemoryUserSettingsStore, UnsupportedKeyStore } from "./index.js";

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

import { describe, expect, it } from "vitest";
import { createEmailIdentity } from "@scomm-office/identity";
import { ProductionPubkeyDirectory } from "./production-directory.js";

describe("ProductionPubkeyDirectory", () => {
  it("maps a capability-selected artifact through the JS SDK", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain("/v1/keys?");
      expect(url).toContain("capabilities=");
      return new Response(
        JSON.stringify({
          key_id: 2,
          family: "smime",
          algorithm: "smime-x25519",
          purpose: "key-agreement",
          public_material: "abc",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const dir = new ProductionPubkeyDirectory("https://pubkey.example.com", fetchImpl);
    const keys = await dir.getKeys(createEmailIdentity("Alice@Example.COM"));
    expect(keys).toHaveLength(1);
    expect(keys[0]?.purpose).toBe("encryption");
    expect(keys[0]?.algorithm).toBe("smime-x25519");
    expect(keys[0]?.identity.value).toBe("alice@example.com");
  });

  it("rejects setKey so Office uses PubkeyClient.setKeys", async () => {
    const dir = new ProductionPubkeyDirectory("https://pubkey.example.com");
    await expect(
      dir.setKey({
        version: 1,
        identity: { type: "email", value: "a@b.com" },
        keyId: "k1",
        algorithm: "Ed25519",
        publicKey: "x",
        encoding: "base64url",
        purpose: "signing",
      }),
    ).rejects.toThrow(/PubkeyClient.setKeys/i);
  });
});

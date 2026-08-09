import { describe, expect, it } from "vitest";
import { createEmailIdentity } from "@scomm-office/identity";
import { ProductionPubkeyDirectory } from "./production-directory.js";

describe("ProductionPubkeyDirectory", () => {
  it("maps preference encrypt+sign to records", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("usage=encrypt")) {
        return new Response(
          JSON.stringify({
            keyId: "k-enc",
            algorithm: "openpgp-cv25519",
            publicKey: "abc",
            label: "work",
          }),
          { status: 200 },
        );
      }
      if (url.includes("usage=sign")) {
        return new Response(
          JSON.stringify({
            keyId: "k-sig",
            algorithm: "openpgp-ed25519",
            publicKey: "def",
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    };

    const dir = new ProductionPubkeyDirectory("https://pubkey.example.com", fetchImpl);
    const keys = await dir.getKeys(createEmailIdentity("Alice@Example.COM"));
    expect(keys).toHaveLength(2);
    expect(keys[0]?.purpose).toBe("encryption");
    expect(keys[1]?.purpose).toBe("signing");
    expect(keys[0]?.identity.value).toBe("Alice@example.com");
  });

  it("rejects setKey until write API is implemented", async () => {
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
    ).rejects.toThrow(/not yet implemented/i);
  });
});

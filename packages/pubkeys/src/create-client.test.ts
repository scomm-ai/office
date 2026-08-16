import { describe, expect, it } from "vitest";
import { createPubkeyClient } from "./create-client.js";

describe("createPubkeyClient", () => {
  it("constructs a headless SDK without Office.js and wires OpenPGP", () => {
    const { client, crypto, pgpEngine } = createPubkeyClient({
      readBaseUrl: "https://pubkey.test",
      writeBaseUrl: "https://api.pubkey.test",
    });
    expect(client.readBaseUrl).toBe("https://pubkey.test");
    expect(crypto.id).toBe("webcrypto");
    expect(pgpEngine.available).toBe(true);
    expect(client.pgpEngine).toBe(pgpEngine);
    expect(client.smimeEngine).toBeUndefined();
    expect(String(createPubkeyClient).includes("Office")).toBe(false);
    expect(String(createPubkeyClient).includes("smimeEngine")).toBe(false);
  });
});

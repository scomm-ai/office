import { describe, expect, it, vi } from "vitest";
import { createPubkeyClient } from "@scomm-office/pubkeys";
import { publishPgpContentKey, type OfficePubkeySession } from "./pubkey-session";

// PGP add-on entitlement is billing-pgp.test.ts's concern; these tests exercise
// key publishing itself and assume an entitled license.
vi.mock("./billing-pgp", () => ({ assertPgpAddon: vi.fn().mockResolvedValue(undefined) }));

async function buildSession(email: string): Promise<OfficePubkeySession> {
  const bundle = createPubkeyClient({ readBaseUrl: "https://pubkey.example.test" });
  await bundle.vault.createVault(email);
  return {
    ...bundle,
    secrets: {
      load: async () => undefined,
      save: async () => undefined,
    } as never,
    pendingMsk: null,
    msk: { publicKey: new Uint8Array(32) } as never,
  };
}

describe("publishPgpContentKey", () => {
  it("publishes encryption and signing artifacts from a new key", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    let artifacts: Array<{ purpose?: string; algorithm?: string }> = [];
    session.client.setKeys = (async (input: { artifacts: typeof artifacts }) => {
      artifacts = input.artifacts;
      return { key_id: 11, keys: [{ purpose: "encryption", key_id: 11 }, { purpose: "signing", key_id: 12 }] };
    }) as typeof session.client.setKeys;

    const result = await publishPgpContentKey(session, email);
    expect(result.generated).toBe(true);
    expect(artifacts.map((row) => row.purpose).sort()).toEqual(["encryption", "signing"]);
    expect(artifacts.find((row) => row.purpose === "encryption")?.algorithm).toBe("openpgp-cv25519");
    expect(artifacts.find((row) => row.purpose === "signing")?.algorithm).toBe("openpgp-ed25519");
    expect(session.vault.getCurrentKey("encryption")?.private_material).toBeTruthy();
  });

  it("republishes existing vault keys instead of no-op", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    const generated = await session.pgpEngine.generateKey({ email });
    session.vault.addKey({
      kind: "content",
      key_id: 1,
      family: "pgp",
      purpose: "encryption",
      algorithm: "openpgp-cv25519",
      fingerprint: generated.fingerprint,
      locator: generated.fingerprint,
      status: "active",
      private_material: generated.privateKey,
    });

    let called = 0;
    session.client.setKeys = (async (input: { artifacts: Array<{ purpose?: string }> }) => {
      called += 1;
      expect(input.artifacts).toHaveLength(2);
      return { key_id: 1 };
    }) as typeof session.client.setKeys;

    const result = await publishPgpContentKey(session, email);
    expect(result.generated).toBe(false);
    expect(called).toBe(1);
    expect(session.vault.getCurrentKey("encryption")?.private_material).toBeTruthy();
  });
});

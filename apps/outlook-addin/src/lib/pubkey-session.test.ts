import { describe, expect, it, vi } from "vitest";
import { createPubkeyClient } from "@scomm-office/pubkeys";
import { publishPgpContentKey, pullHostedVault, type OfficePubkeySession } from "./pubkey-session";

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
  it("publishes signing and encryption artifacts from a new key", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    let signingArtifact: { purpose?: string; algorithm?: string } | null = null;
    let encryptionArtifact: { purpose?: string; algorithm?: string } | null = null;
    session.client.setSigningKeyWithProof = (async (input: { artifact: typeof signingArtifact }) => {
      signingArtifact = input.artifact;
      return { key_id: 12, keys: [{ purpose: "signing", key_id: 12 }] };
    }) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async (input: { artifact: typeof encryptionArtifact }) => {
      encryptionArtifact = input.artifact;
      return { key_id: 11, keys: [{ purpose: "encryption", key_id: 11 }] };
    }) as typeof session.client.publishEncryptionKey;

    const result = await publishPgpContentKey(session, email);
    expect(result.generated).toBe(true);
    expect(signingArtifact?.purpose).toBe("signing");
    expect(signingArtifact?.algorithm).toBe("openpgp-ed25519");
    expect(encryptionArtifact?.purpose).toBe("encryption");
    expect(encryptionArtifact?.algorithm).toBe("openpgp-cv25519");
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

    let sigCalled = 0;
    let encCalled = 0;
    session.client.setSigningKeyWithProof = (async () => {
      sigCalled += 1;
      return { key_id: 1 };
    }) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async (input: { artifact: { purpose?: string } }) => {
      encCalled += 1;
      expect(input.artifact.purpose).toBe("encryption");
      return { key_id: 1 };
    }) as typeof session.client.publishEncryptionKey;

    const result = await publishPgpContentKey(session, email);
    expect(result.generated).toBe(false);
    expect(sigCalled).toBe(1);
    expect(encCalled).toBe(1);
    expect(session.vault.getCurrentKey("encryption")?.private_material).toBeTruthy();
  });
});

describe("pullHostedVault", () => {
  it("merges a remote-only key into the local Vault without uploading", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);

    let uploadCalled = false;
    session.client.uploadVault = (async () => {
      uploadCalled = true;
      return { generation: 1, created_at: new Date().toISOString() };
    }) as typeof session.client.uploadVault;

    session.client.downloadCurrentVault = (async ({ vault }: { vault: OfficePubkeySession["vault"] }) => {
      // Simulate a generation another device published: a PGP encryption
      // key this local Vault has never seen.
      vault.addKey({
        kind: "content",
        key_id: 99,
        family: "pgp",
        purpose: "encryption",
        algorithm: "openpgp-cv25519",
        fingerprint: "remote-fingerprint",
        locator: "remote-fingerprint",
        status: "active",
        private_material: new Uint8Array([1, 2, 3]),
      });
      vault.generation = 2;
      return 2;
    }) as typeof session.client.downloadCurrentVault;

    expect(session.vault.listKeys()).toHaveLength(0);

    const result = await pullHostedVault(session, email);

    expect(result.hasPgp).toBe(true);
    expect(session.vault.listKeys()).toHaveLength(1);
    expect(session.vault.getCurrentKey("encryption")?.fingerprint).toBe("remote-fingerprint");
    expect(uploadCalled).toBe(false);
  });

  it("is a no-op when nothing changed on the server", async () => {
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

    let downloadCalls = 0;
    session.client.downloadCurrentVault = (async () => {
      downloadCalls += 1;
      return session.vault.generation;
    }) as typeof session.client.downloadCurrentVault;

    const result = await pullHostedVault(session, email);

    expect(downloadCalls).toBe(1);
    expect(result.hasPgp).toBe(true);
    expect(session.vault.listKeys()).toHaveLength(1);
  });
});

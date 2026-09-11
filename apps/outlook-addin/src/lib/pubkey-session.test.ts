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
    type KeyArtifact = { purpose?: string; algorithm?: string };
    const captured: { signing?: KeyArtifact; encryption?: KeyArtifact } = {};
    session.client.setSigningKeyWithProof = (async (input: { artifact: KeyArtifact }) => {
      captured.signing = input.artifact;
      return { key_id: 12, keys: [{ purpose: "signing", key_id: 12 }] };
    }) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async (input: { artifact: KeyArtifact }) => {
      captured.encryption = input.artifact;
      return { key_id: 11, keys: [{ purpose: "encryption", key_id: 11 }] };
    }) as typeof session.client.publishEncryptionKey;

    const result = await publishPgpContentKey(session, email);
    expect(result.generated).toBe(true);
    expect(captured.signing?.purpose).toBe("signing");
    expect(captured.signing?.algorithm).toBe("openpgp-ed25519");
    expect(captured.encryption?.purpose).toBe("encryption");
    expect(captured.encryption?.algorithm).toBe("openpgp-cv25519");
    expect(session.vault.getCurrentKey("encryption")?.private_material).toBeTruthy();
  });

  it("publishes a PQC composite key when requested", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    type KeyArtifact = { purpose?: string; algorithm?: string };
    const captured: { signing?: KeyArtifact; encryption?: KeyArtifact } = {};
    session.client.setSigningKeyWithProof = (async (input: { artifact: KeyArtifact }) => {
      captured.signing = input.artifact;
      return { key_id: 12, keys: [{ purpose: "signing", key_id: 12 }] };
    }) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async (input: { artifact: KeyArtifact }) => {
      captured.encryption = input.artifact;
      return { key_id: 11, keys: [{ purpose: "encryption", key_id: 11 }] };
    }) as typeof session.client.publishEncryptionKey;

    const result = await publishPgpContentKey(session, email, undefined, "openpgp-pqc");
    expect(result.generated).toBe(true);
    expect(captured.signing?.algorithm).toBe("openpgp-mldsa65-ed25519");
    expect(captured.encryption?.algorithm).toBe("openpgp-mlkem768-x25519");
    expect(session.vault.getCurrentKey("encryption")?.algorithm).toBe("openpgp-mlkem768-x25519");
  });

  it("adding a PQC key alongside an existing classical key creates a second entry instead of overwriting the first", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    session.client.setSigningKeyWithProof = (async () => ({
      key_id: 1,
      keys: [{ purpose: "signing", key_id: 1 }],
    })) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async () => ({
      key_id: 1,
      keys: [{ purpose: "encryption", key_id: 1 }],
    })) as typeof session.client.publishEncryptionKey;
    await publishPgpContentKey(session, email);
    const classicalEntry = session.vault.getCurrentKey("encryption");
    expect(classicalEntry?.algorithm).toBe("openpgp-cv25519");
    const classicalFingerprint = classicalEntry?.fingerprint;

    session.client.setSigningKeyWithProof = (async () => ({
      key_id: 2,
      keys: [{ purpose: "signing", key_id: 2 }],
    })) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async () => ({
      key_id: 2,
      keys: [{ purpose: "encryption", key_id: 2 }],
    })) as typeof session.client.publishEncryptionKey;
    await publishPgpContentKey(session, email, undefined, "openpgp-pqc");

    // The original classical entry must be untouched (not overwritten with
    // PQC metadata or the new key's private material), and both entries
    // coexist so decrypt still finds whichever key a sender actually used.
    const untouchedClassical = session.vault.getKeyByFingerprint(classicalFingerprint!);
    expect(untouchedClassical?.algorithm).toBe("openpgp-cv25519");
    expect(untouchedClassical?.fingerprint).toBe(classicalFingerprint);
    const pgpEntries = session.vault.listKeys().filter((entry) => entry.family === "pgp");
    expect(pgpEntries.length).toBe(2);
    expect(pgpEntries.some((entry) => entry.algorithm === "openpgp-mlkem768-x25519")).toBe(true);
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

  it("publishes only the signing purpose when requested", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    let sigCalled = 0;
    let encCalled = 0;
    session.client.setSigningKeyWithProof = (async (input: { artifact: { purpose?: string } }) => {
      sigCalled += 1;
      expect(input.artifact.purpose).toBe("signing");
      return { key_id: 21, keys: [{ purpose: "signing", key_id: 21 }] };
    }) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async () => {
      encCalled += 1;
      return { key_id: 0 };
    }) as typeof session.client.publishEncryptionKey;

    const result = await publishPgpContentKey(session, email, ["signing"]);

    expect(result.generated).toBe(true);
    expect(sigCalled).toBe(1);
    expect(encCalled).toBe(0);
    expect(session.vault.getCurrentKey("signing")?.private_material).toBeTruthy();
    expect(session.vault.getCurrentKey("encryption")).toBeNull();
  });

  it("publishes only the encryption purpose when requested", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    let sigCalled = 0;
    let encCalled = 0;
    session.client.setSigningKeyWithProof = (async () => {
      sigCalled += 1;
      return { key_id: 0 };
    }) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async (input: { artifact: { purpose?: string } }) => {
      encCalled += 1;
      expect(input.artifact.purpose).toBe("encryption");
      return { key_id: 33, keys: [{ purpose: "encryption", key_id: 33 }] };
    }) as typeof session.client.publishEncryptionKey;

    const result = await publishPgpContentKey(session, email, ["encryption"]);

    expect(result.generated).toBe(true);
    expect(sigCalled).toBe(0);
    expect(encCalled).toBe(1);
    expect(session.vault.getCurrentKey("encryption")?.private_material).toBeTruthy();
    expect(session.vault.getCurrentKey("signing")).toBeNull();
  });

  it("retags the existing local entry to 'encryption' when that purpose is added to a signing-only key", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    session.client.setSigningKeyWithProof = (async () => ({
      key_id: 21,
      keys: [{ purpose: "signing", key_id: 21 }],
    })) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async () => ({
      key_id: 33,
      keys: [{ purpose: "encryption", key_id: 33 }],
    })) as typeof session.client.publishEncryptionKey;

    await publishPgpContentKey(session, email, ["signing"]);
    expect(session.vault.listKeys()).toHaveLength(1);
    expect(session.vault.getCurrentKey()?.purpose).toBe("signing");

    await publishPgpContentKey(session, email, ["encryption"]);

    // Same underlying keypair reused (Vault dedupes by fingerprint) — still
    // exactly one local entry, now tagged "encryption" so hasPgp/decrypt
    // gating recognizes it. The "signing" tag is not preserved alongside it
    // — a known limitation of the single-purpose-per-entry vault schema.
    expect(session.vault.listKeys()).toHaveLength(1);
    expect(session.vault.getCurrentKey("encryption")?.private_material).toBeTruthy();
    expect(session.vault.getCurrentKey("signing")).toBeNull();
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

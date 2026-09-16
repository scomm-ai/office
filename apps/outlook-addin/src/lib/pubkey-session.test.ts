import { describe, expect, it, vi } from "vitest";
import { createPubkeyClient } from "@scomm-office/pubkeys";
import {
  checkRecoveryEnvelope,
  ensureDeviceKey,
  publishPgpContentKey,
  requestRecoveryCodeOtp,
  restoreFromRecoveryCode,
  saveRecoveryEnvelope,
  type OfficePubkeySession,
} from "./pubkey-session";

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
    deviceIdentity: {
      load: async () => null,
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

describe("publishPgpContentKey vault sync", () => {
  it("uploads the new key as a vault generation, not just to local storage", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    session.vault.ensureVrk();
    session.client.setSigningKeyWithProof = (async () => ({
      key_id: 21,
      keys: [{ purpose: "signing", key_id: 21 }],
    })) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async () => ({
      key_id: 33,
      keys: [{ purpose: "encryption", key_id: 33 }],
    })) as typeof session.client.publishEncryptionKey;

    let synced = 0;
    session.client.syncVault = (async () => {
      synced += 1;
      return { downloadedGeneration: null, uploaded: {}, generation: 1 };
    }) as typeof session.client.syncVault;

    const result = await publishPgpContentKey(session, email);

    // Publishing the public artifact puts nothing in `vault_generations` —
    // the private material only leaves this browser's IndexedDB when a vault
    // generation is uploaded. Leaving that to a later manual "Sync" click
    // means a profile reset loses the only copy of the key, and no other
    // device can read mail sent to it in the meantime.
    expect(synced).toBe(1);
    expect(result.vaultSynced).toBe(true);
  });

  it("reports, rather than throws, when the vault upload fails", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    session.vault.ensureVrk();
    session.client.setSigningKeyWithProof = (async () => ({
      key_id: 21,
      keys: [{ purpose: "signing", key_id: 21 }],
    })) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async () => ({
      key_id: 33,
      keys: [{ purpose: "encryption", key_id: 33 }],
    })) as typeof session.client.publishEncryptionKey;
    session.client.syncVault = (async () => {
      throw new Error("device_not_authorized");
    }) as typeof session.client.syncVault;

    // The artifact is already published and the key is already in local
    // storage — throwing here would report a key that genuinely exists as
    // not created. The caller is told it is local-only instead.
    const result = await publishPgpContentKey(session, email);

    expect(result.generated).toBe(true);
    expect(result.vaultSynced).toBe(false);
    expect(result.vaultSyncError).toContain("device_not_authorized");
    expect(session.vault.getCurrentKey("encryption")?.private_material).toBeTruthy();
  });

  it("does not mint a Vault Root Key for a device waiting to be paired", async () => {
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
    let synced = 0;
    session.client.syncVault = (async () => {
      synced += 1;
      return { downloadedGeneration: null, uploaded: {}, generation: 1 };
    }) as typeof session.client.syncVault;

    // The server already has generations this device cannot decrypt, so it is
    // waiting to be paired, not establishing the identity.
    session.vault.generation = 4;

    const result = await publishPgpContentKey(session, email);

    // Minting a VRK here would fork the vault: this device would try to
    // upload a generation nobody else can decrypt, and could not read the
    // existing ones.
    expect(synced).toBe(0);
    expect(session.vault.vrk).toBeNull();
    expect(result.vaultSynced).toBe(false);
  });

  it("establishes the first generation when this is the identity's only device", async () => {
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
    let synced = 0;
    session.client.syncVault = (async () => {
      synced += 1;
      return { downloadedGeneration: null, uploaded: {}, generation: 1 };
    }) as typeof session.client.syncVault;

    // Genesis: no VRK yet and nothing on the server. Refusing to sync here is
    // what left a device that later pairs with this one downloading an empty
    // vault — no keys.
    const result = await publishPgpContentKey(session, email);

    expect(synced).toBe(1);
    expect(result.vaultSynced).toBe(true);
  });
});

describe("recovery code", () => {
  it("checkRecoveryEnvelope delegates to client.hasRecoveryEnvelope", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    session.client.hasRecoveryEnvelope = (async (input: { email: string }) => {
      expect(input.email).toBe(email);
      return true;
    }) as typeof session.client.hasRecoveryEnvelope;

    expect(await checkRecoveryEnvelope(session, email)).toBe(true);
  });

  it("requestRecoveryCodeOtp delegates to client.requestRecoveryEnvelopeOtp", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    let called = false;
    session.client.requestRecoveryEnvelopeOtp = (async () => {
      called = true;
      return { message: "OTP sent", expiresIn: 600, sha256: "x" };
    }) as typeof session.client.requestRecoveryEnvelopeOtp;

    await requestRecoveryCodeOtp(session, email);
    expect(called).toBe(true);
  });

  it("restoreFromRecoveryCode unwraps via the client then applies the vault like a device transfer", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    const vrk = new Uint8Array(32).fill(7);
    session.client.recoverVaultWithCode = (async (input: { otp: string; recoveryCode: string }) => {
      expect(input.otp).toBe("12345678901");
      expect(input.recoveryCode).toBe("SOME-CODE");
      return { vrk };
    }) as typeof session.client.recoverVaultWithCode;
    session.client.downloadCurrentVault = (async ({ vault }: { vault: OfficePubkeySession["vault"] }) => {
      vault.addKey({
        kind: "content",
        key_id: 1,
        family: "pgp",
        purpose: "encryption",
        algorithm: "openpgp-cv25519",
        fingerprint: "fp",
        locator: "fp",
        status: "active",
        private_material: new Uint8Array([1, 2, 3]),
      });
      return 1;
    }) as typeof session.client.downloadCurrentVault;

    const result = await restoreFromRecoveryCode(session, email, "12345678901", "SOME-CODE");

    expect(result.hasPgp).toBe(true);
    expect(session.vault.vrk).toEqual(vrk);
  });

  it("saveRecoveryEnvelope uploads the current VRK/AEK and returns the plaintext code", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    let captured: { vrk?: Uint8Array; aek?: Uint8Array } = {};
    session.client.setRecoveryEnvelope = (async (input: { vrk: Uint8Array; aek?: Uint8Array }) => {
      captured = { vrk: input.vrk, aek: input.aek };
      return "GENERATEDCODE1234567890ABCDEFGH";
    }) as typeof session.client.setRecoveryEnvelope;

    const code = await saveRecoveryEnvelope(session, email);

    expect(code).toBe("GENERATEDCODE1234567890ABCDEFGH");
    expect(captured.vrk).toBeInstanceOf(Uint8Array);
  });
});

// Regression for a real production bug: verifyEnroll/verifyReplace generated
// a brand-new device keypair on every call. Retrying OTP verification (or
// recovering the same email a second time) then tried to authorize a new
// device_id under the same fixed device name ("Outlook") server-side,
// colliding with the (principal_id, device_name) unique constraint and
// surfacing as a 500 on /v1/msk/replace/verify. ensureDeviceKey must persist
// and reuse one device identity per browser profile.
describe("ensureDeviceKey", () => {
  it("persists a device key on first use and reuses the same one afterward", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    let stored: unknown = null;
    session.deviceIdentity = {
      load: async () => stored,
      save: async (identity: unknown) => {
        stored = identity;
      },
    } as never;

    const first = await ensureDeviceKey(session);
    expect(stored).not.toBeNull();

    const second = await ensureDeviceKey(session);

    expect(second.publicKey).toEqual(first.publicKey);
  });

  it("generates a fresh key only when nothing was ever persisted", async () => {
    const email = "bob@example.com";
    const sessionA = await buildSession(email);
    const sessionB = await buildSession(email);
    // Each has its own always-empty store (mirrors buildSession's default).

    const keyA = await ensureDeviceKey(sessionA);
    const keyB = await ensureDeviceKey(sessionB);

    expect(keyA.publicKey).not.toEqual(keyB.publicKey);
  });
});

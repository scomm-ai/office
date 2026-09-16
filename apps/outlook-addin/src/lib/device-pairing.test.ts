import { describe, expect, it, vi } from "vitest";
import { createPubkeyClient } from "@scomm-office/pubkeys";
import {
  approveDevicePairing,
  listVaultDevices,
  persistMsk,
  publishPgpContentKey,
  type OfficePubkeySession,
} from "./pubkey-session";

vi.mock("./billing-pgp", () => ({ assertPgpAddon: vi.fn().mockResolvedValue(undefined) }));

const EMAIL = "alice@example.com";

async function buildSession(): Promise<OfficePubkeySession> {
  const bundle = createPubkeyClient({ readBaseUrl: "https://pubkey.example.test" });
  await bundle.vault.createVault(EMAIL);
  return {
    ...bundle,
    secrets: { load: async () => undefined, save: async () => undefined } as never,
    deviceIdentity: { load: async () => null, save: async () => undefined } as never,
    pendingMsk: null,
    // A real handle: persistMsk exports it into the vault's MSK envelope.
    msk: await bundle.crypto.generateSigningKey("ed25519"),
  };
}

/** Records what the approving device pushes to shared state. */
function stubClient(session: OfficePubkeySession) {
  const calls = { responded: 0, uploads: [] as Array<Record<string, unknown>> };
  session.client.getPairingSession = (async () => ({
    b_ephemeral_public_key: new Uint8Array(32).fill(7),
    b_device_id: "dev-b",
    device_name: "secMail10 desktop",
    requested_tier: "full",
  })) as typeof session.client.getPairingSession;
  session.client.respondToPairingSession = (async () => {
    calls.responded += 1;
    return {};
  }) as typeof session.client.respondToPairingSession;
  session.client.uploadVault = (async (input: Record<string, unknown>) => {
    calls.uploads.push(input);
    return { generation: 1 };
  }) as unknown as typeof session.client.uploadVault;
  session.client.downloadCurrentVault = (async () =>
    null) as typeof session.client.downloadCurrentVault;
  // Mirrors the real syncVault: pull, push, then persist under the device
  // secret (that last step is what makes a freshly minted VRK durable).
  session.client.syncVault = (async ({ email, mskKey, vault, vrk, persistSecret }) => {
    const target = vault ?? session.vault;
    await session.client.downloadCurrentVault({ email, vault: target, vrk });
    await session.client.uploadVault({ email, mskKey, vault: target, vrk });
    if (persistSecret) await target.persist(persistSecret);
    return { downloadedGeneration: null, uploaded: {}, generation: 1 };
  }) as typeof session.client.syncVault;
  return calls;
}

describe("Outlook registers first, then approves a secMail10 pairing", () => {
  it("has uploaded a vault generation before any device pairs with it", async () => {
    const session = await buildSession();
    const calls = stubClient(session);
    session.client.setSigningKeyWithProof = (async () => ({
      key_id: 21,
      keys: [{ purpose: "signing", key_id: 21 }],
    })) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async () => ({
      key_id: 33,
      keys: [{ purpose: "encryption", key_id: 33 }],
    })) as typeof session.client.publishEncryptionKey;

    // Genesis alone must already establish a generation: the MSK envelope
    // lives inside the vault, so a device that pairs before any key exists
    // still needs something to download.
    await persistMsk(session, EMAIL);
    expect(calls.uploads.length).toBe(1);

    await publishPgpContentKey(session, EMAIL);

    // The whole point of pairing is that the new device *downloads* the
    // vault. If Outlook never uploaded a generation there is nothing to
    // download, and secMail10 finishes pairing with zero keys.
    expect(calls.uploads.length).toBe(2);
    expect(session.vault.getCurrentKey("encryption")?.private_material).toBeTruthy();
  });

  it("registers the approved device and keeps its Vault Root Key", async () => {
    const session = await buildSession();
    const calls = stubClient(session);
    await persistMsk(session, EMAIL);

    await approveDevicePairing(session, EMAIL, "PAIR-CODE");

    expect(calls.responded).toBe(1);
    // Pairing never populates the server's `authorized_devices` table (see
    // mutateService.ts's documented gap) — the vault's own roster is the
    // only place a paired device is ever recorded. Approving without
    // writing there means neither side can ever list the new device.
    expect(session.vault.devices.map((d) => (d as { device_id?: string }).device_id)).toContain(
      "dev-b",
    );
    // ...and that roster only reaches the other device as an upload.
    expect(calls.uploads.length).toBeGreaterThan(0);
  });

  it("lists a paired device, which exists only in the vault roster", async () => {
    const session = await buildSession();
    stubClient(session);
    session.client.listDevices = (async () => ({
      devices: [{ device_id: "dev-a", active: true, device_name: "Outlook" }],
    })) as typeof session.client.listDevices;
    await persistMsk(session, EMAIL);

    await approveDevicePairing(session, EMAIL, "PAIR-CODE");
    const devices = await listVaultDevices(session, EMAIL);

    expect(devices.map((d) => d.deviceId).sort()).toEqual(["dev-a", "dev-b"]);
  });

  it("wraps its own MSK under an Authority Encryption Key at genesis", async () => {
    const session = await buildSession();
    stubClient(session);

    await persistMsk(session, EMAIL);

    // Storing the MSK raw inside the vault plaintext makes the limited/full
    // tier split meaningless: anyone handed the VRK can read full signing
    // authority straight out of it.
    const envelope = (session.vault.getMsk() as { envelope?: Record<string, unknown> })?.envelope;
    expect(session.vault.aek).toBeTruthy();
    expect(envelope?.iv).toBeTypeOf("string");
    expect(envelope?.encrypted_msk).not.toBe(undefined);
  });

  it("grants authority when the peer asked for the full tier", async () => {
    const session = await buildSession();
    let granted: { aek?: Uint8Array } = {};
    stubClient(session);
    session.client.respondToPairingSession = (async (input: { aek?: Uint8Array }) => {
      granted = input;
      return {};
    }) as typeof session.client.respondToPairingSession;
    await persistMsk(session, EMAIL);

    await approveDevicePairing(session, EMAIL, "PAIR-CODE");

    // secMail10 asks for "full" and then calls requireMsk(), which needs the
    // AEK. Without it the peer pairs successfully and then dies on its first
    // vault mutation with device_not_authorized.
    expect(granted.aek).toBeTruthy();
  });

  it("withholds authority when the peer only asked for the limited tier", async () => {
    const session = await buildSession();
    let granted: { aek?: Uint8Array } = {};
    stubClient(session);
    session.client.getPairingSession = (async () => ({
      b_ephemeral_public_key: new Uint8Array(32).fill(7),
      b_device_id: "dev-b",
      device_name: "secMail10 desktop",
      requested_tier: "limited",
    })) as typeof session.client.getPairingSession;
    session.client.respondToPairingSession = (async (input: { aek?: Uint8Array }) => {
      granted = input;
      return {};
    }) as typeof session.client.respondToPairingSession;
    await persistMsk(session, EMAIL);

    await approveDevicePairing(session, EMAIL, "PAIR-CODE");

    expect(granted.aek).toBeUndefined();
  });

  it("upgrades a legacy unwrapped MSK so an existing install can still grant full authority", async () => {
    const session = await buildSession();
    let granted: { aek?: Uint8Array } = {};
    stubClient(session);
    session.client.respondToPairingSession = (async (input: { aek?: Uint8Array }) => {
      granted = input;
      return {};
    }) as typeof session.client.respondToPairingSession;
    await persistMsk(session, EMAIL);

    // An install that registered before the vault carried an AEK: MSK stored
    // raw, no AEK. Without an in-place upgrade it can never honour a "full"
    // request — not now, not ever.
    const portable = await session.crypto.exportPrivateKey(session.msk!);
    session.vault.aek = null;
    session.vault.setMskEnvelope({
      envelope_version: 1,
      algorithm: "ed25519",
      public_key: "pub",
      created_at: Date.now(),
      encrypted_msk: Buffer.from(portable.bytes).toString("base64url"),
      wraps: [],
    });

    await approveDevicePairing(session, EMAIL, "PAIR-CODE");

    expect(granted.aek).toBeTruthy();
    const envelope = (session.vault.getMsk() as { envelope?: Record<string, unknown> })?.envelope;
    expect(envelope?.iv).toBeTypeOf("string");
  });

  it("records a published encryption key as the advertised one", async () => {
    const session = await buildSession();
    stubClient(session);
    session.client.setSigningKeyWithProof = (async () => ({
      key_id: 21,
      keys: [{ purpose: "signing", key_id: 21 }],
    })) as typeof session.client.setSigningKeyWithProof;
    session.client.publishEncryptionKey = (async () => ({
      key_id: 33,
      keys: [{ purpose: "encryption", key_id: 33 }],
    })) as typeof session.client.publishEncryptionKey;
    await persistMsk(session, EMAIL);

    await publishPgpContentKey(session, EMAIL);

    // Otherwise secMail10 offers "Make active" for the key Outlook already
    // made active, and the pointer stays null for every other device.
    expect(session.vault.currentEncryptionKeyId).toBe("33");
    expect(session.vault.currentSigningKeyId).toBe("21");
  });

  it("does not hand out a Vault Root Key it will forget on reload", async () => {
    const session = await buildSession();
    let saved: unknown = null;
    session.vault.store.save = (async (record: unknown) => {
      saved = record;
    }) as typeof session.vault.store.save;
    stubClient(session);
    await persistMsk(session, EMAIL);
    saved = null;

    await approveDevicePairing(session, EMAIL, "PAIR-CODE");

    // approveDevicePairing mints a VRK on the spot when the device has none.
    // Unpersisted, the next reload mints a *different* one — and this device
    // can no longer read the vault it just gave away.
    expect(session.vault.vrk).toBeTruthy();
    expect(saved).not.toBeNull();
  });
});

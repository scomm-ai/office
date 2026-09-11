import {
  MSK_ALGORITHM,
  PURPOSES,
  createPubkeyClient,
  decodeBase64Url,
  emailSha256Hex,
  encodeBase64Url,
  formatOpenPgpLocator,
  normalizeEmail,
  principalFromEmail,
  unwrapMskWithAek,
  type KeyHandle,
} from "@scomm-office/pubkeys";
import { IndexedDbDeviceSecretStore, IndexedDbVaultStore } from "@scomm-office/storage";
import { assertPgpAddon } from "./billing-pgp";
import { classifyDirectoryKey } from "./directory-key";
import { DEFAULT_SETTINGS, resolvePubkeyWriteBaseUrl } from "./settings";

// Matches the directory's naming convention for RFC 9980 composite
// algorithms (see directory-key.ts's PQC_RE / classifyDirectoryKey), so
// recipients' clients and this add-in's own key-status UI both recognize
// these as PQC without a separate parallel convention.
const PQC_SIGNING_ALGORITHM = "openpgp-mldsa65-ed25519";
const PQC_ENCRYPTION_ALGORITHM = "openpgp-mlkem768-x25519";

type PubkeyBundle = ReturnType<typeof createPubkeyClient>;

export type OfficePubkeySession = PubkeyBundle & {
  secrets: IndexedDbDeviceSecretStore;
  pendingMsk: KeyHandle | null;
  msk: KeyHandle | null;
};

let cached: OfficePubkeySession | null = null;
let cacheKey = "";

export function getOfficePubkeySession(options: {
  readBaseUrl: string;
  writeBaseUrl?: string;
}): OfficePubkeySession {
  const writeBaseUrl = resolvePubkeyWriteBaseUrl({
    ...DEFAULT_SETTINGS,
    pubkeyWriteBaseUrl: options.writeBaseUrl,
  });
  const key = `${options.readBaseUrl}|${writeBaseUrl}`;
  if (!cached || cacheKey !== key) {
    const created = createPubkeyClient({
      readBaseUrl: options.readBaseUrl,
      writeBaseUrl,
      store: new IndexedDbVaultStore(),
    });
    cached = {
      ...created,
      secrets: new IndexedDbDeviceSecretStore(),
      pendingMsk: null,
      msk: null,
    };
    cacheKey = key;
  }
  return cached;
}

/**
 * Raw Ed25519 public key for the restored MSK (handle and/or vault envelope).
 */
export function mskPublicKeyBytes(session: OfficePubkeySession): Uint8Array | null {
  if (session.msk?.publicKey && session.msk.publicKey.length > 0) {
    return session.msk.publicKey;
  }
  const entry = session.vault.getMsk() as {
    envelope?: { public_key?: string };
  } | null;
  const encoded = entry?.envelope?.public_key;
  if (!encoded) return null;
  try {
    const bytes = decodeBase64Url(encoded);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

async function importMskFromVault(session: OfficePubkeySession): Promise<void> {
  const entry = session.vault.getMsk() as {
    private_material?: Uint8Array;
    envelope?: { iv?: string; encrypted_msk?: string; public_key?: string };
  } | null;
  const envelope = entry?.envelope;
  let bytes: Uint8Array | undefined;
  if (envelope?.iv && envelope?.encrypted_msk) {
    // CKVF-spec shape (e.g. a vault pulled from secMail10 via device
    // pairing): encrypted_msk is AEK-wrapped, not raw. Only a "full" tier
    // pairing grant leaves this device holding an AEK — a "limited" tier
    // device correctly cannot recover MSK signing capability here.
    if (!session.vault.aek) return;
    bytes = await unwrapMskWithAek(session.crypto, session.vault.aek, envelope);
  } else if (envelope?.encrypted_msk) {
    // office's own legacy local shape: already-raw MSK bytes, no AEK wrap.
    bytes = decodeBase64Url(String(envelope.encrypted_msk));
  } else {
    bytes = entry?.private_material;
  }
  if (!bytes) return;
  let publicKey: Uint8Array | undefined;
  if (entry?.envelope?.public_key) {
    try {
      publicKey = decodeBase64Url(entry.envelope.public_key);
    } catch {
      publicKey = undefined;
    }
  }
  session.msk = await session.crypto.importPrivateKey({
    algorithm: MSK_ALGORITHM,
    encoding: "raw-32",
    bytes,
    publicKey,
    purpose: PURPOSES.masterSigning,
  });
}

export async function ensureDeviceSecret(session: OfficePubkeySession): Promise<string> {
  const existing = await session.secrets.load();
  if (existing) return existing;
  const secret = encodeBase64Url(session.crypto.random(32));
  await session.secrets.save(secret);
  return secret;
}

export async function restoreOfficeVault(session: OfficePubkeySession): Promise<{
  restored: boolean;
  hasPgp: boolean;
}> {
  const secret = await session.secrets.load();
  if (!secret) return { restored: false, hasPgp: false };
  try {
    if (!session.vault.unlocked) {
      await session.vault.unlockVault(secret);
    }
  } catch {
    return { restored: false, hasPgp: false };
  }
  await importMskFromVault(session);
  const pgp = session.vault
    .listKeys()
    .some(
      (entry) =>
        entry.kind === "content" && entry.family === "pgp" && entry.purpose === "encryption",
    );
  return {
    restored: Boolean(session.msk),
    hasPgp: pgp,
  };
}

export async function persistMsk(session: OfficePubkeySession, email: string): Promise<void> {
  const msk = session.msk ?? session.pendingMsk;
  if (!msk) {
    throw new Error("No MSK to persist");
  }
  const secret = await ensureDeviceSecret(session);
  const principal = await principalFromEmail(normalizeEmail(email));
  if (!session.vault.unlocked) {
    const record = await session.vault.store.load();
    if (record) {
      await session.vault.unlockVault(secret);
    } else {
      await session.vault.createVault(principal);
    }
  }
  const portable = await session.crypto.exportPrivateKey(msk);
  session.vault.setMskEnvelope({
    envelope_version: 1,
    algorithm: MSK_ALGORITHM,
    public_key: encodeBase64Url(portable.publicKey ?? msk.publicKey ?? new Uint8Array()),
    created_at: Date.now(),
    encrypted_msk: encodeBase64Url(portable.bytes),
    wraps: [],
    revoked_device_ids: [],
  });
  await session.vault.persist(secret);
  session.msk = msk;
  session.pendingMsk = null;
}

export type PgpKeyPurpose = "encryption" | "signing";
export type PgpKeyAlgorithm = "openpgp-cv25519" | "openpgp-pqc";

const BOTH_PGP_PURPOSES: PgpKeyPurpose[] = ["encryption", "signing"];
const DEFAULT_PGP_ALGORITHM: PgpKeyAlgorithm = "openpgp-cv25519";

/**
 * Generates (or reuses) a local OpenPGP keypair and publishes the requested
 * purpose(s) — `signing` (proof-of-possession via the MSK chain) and/or
 * `encryption` (challenge-response PoP). Defaults to both for callers that
 * don't care (e.g. "repair directory keys"); the guided setup flow passes a
 * single purpose so only the key the user actually chose gets uploaded.
 */
export async function publishPgpContentKey(
  session: OfficePubkeySession,
  email: string,
  purposes: PgpKeyPurpose[] = BOTH_PGP_PURPOSES,
  algorithm: PgpKeyAlgorithm = DEFAULT_PGP_ALGORITHM,
): Promise<{ generated: boolean }> {
  await assertPgpAddon();
  const msk = session.msk;
  if (!msk) {
    throw new Error("MSK is not armed");
  }
  if (!session.pgpEngine.available) {
    throw new Error("OpenPGP engine is not available");
  }
  const canonical = normalizeEmail(email);
  // Any existing local PGP content key (either purpose) carries the same
  // underlying keypair — reuse it so publishing the "other" purpose later
  // doesn't generate a second, unrelated key. Only reuse it if it actually
  // matches the requested algorithm — otherwise "create another key" with a
  // different algorithm would silently republish the old one.
  const existing = session.vault.getCurrentKey();
  const existingIsPqc = existing
    ? classifyDirectoryKey({ family: existing.family, algorithm: existing.algorithm }).isPqc
    : false;
  const existingMatches = existing?.family === "pgp" && existingIsPqc === (algorithm === "openpgp-pqc");
  const existingPrivate = existingMatches ? existing?.private_material : undefined;

  let generated = false;
  let publicKey: Uint8Array;
  let privateKey: Uint8Array;
  let fingerprint: string;

  if (existingPrivate) {
    publicKey = await session.pgpEngine.exportPublicKey(existingPrivate);
    privateKey = existingPrivate;
    fingerprint = existing?.fingerprint || "local";
  } else {
    const created = await session.pgpEngine.generateKey({
      name: canonical,
      email: canonical,
      algorithm,
    });
    generated = true;
    publicKey = created.publicKey;
    privateKey = created.privateKey;
    fingerprint = created.fingerprint;
  }

  const material = encodeBase64Url(publicKey);
  const publishSigning = purposes.includes("signing");
  const publishEncryption = purposes.includes("encryption");
  const isPqc = algorithm === "openpgp-pqc";
  const signingAlgorithm = isPqc ? PQC_SIGNING_ALGORITHM : "openpgp-ed25519";
  const encryptionAlgorithm = isPqc ? PQC_ENCRYPTION_ALGORITHM : "openpgp-cv25519";
  let signingKeyId = 0;
  let encryptionKeyId = 0;

  if (publishSigning) {
    const signingArtifact = {
      family: "pgp" as const,
      purpose: "signing" as const,
      algorithm: signingAlgorithm,
      public_material: material,
    };
    // Extract raw Ed25519 seed, import as CryptoKey, then PoP
    const sigSeed = await session.pgpEngine.extractEd25519SigningKey(privateKey);
    const contentSigningKey = await session.crypto.importPrivateKey({
      algorithm: "ed25519",
      encoding: "raw-32",
      bytes: sigSeed.seed,
      publicKey: sigSeed.publicKey,
      purpose: "signing",
    });
    const sigResult = (await session.client.setSigningKeyWithProof({
      email: canonical,
      artifact: signingArtifact,
      mskKey: msk,
      contentSigningKey,
    })) as { key_id?: number; keys?: Array<{ key_id?: number; purpose?: string }> };
    signingKeyId =
      sigResult.keys?.find((row) => row.purpose === "signing")?.key_id ?? sigResult.key_id ?? 0;
  }

  if (publishEncryption) {
    const encryptionArtifact = {
      family: "pgp" as const,
      purpose: "encryption" as const,
      algorithm: encryptionAlgorithm,
      public_material: material,
    };
    // Challenge-response PoP flow
    const encResult = (await session.client.publishEncryptionKey({
      email: canonical,
      artifact: encryptionArtifact,
      privateKey: privateKey,
      mskKey: msk,
    })) as { key_id?: number; keys?: Array<{ key_id?: number; purpose?: string }> };
    encryptionKeyId =
      encResult.keys?.find((row) => row.purpose === "encryption")?.key_id ?? encResult.key_id ?? 0;
  }

  // One local vault entry per fingerprint (the Vault dedupes by fingerprint —
  // this single OpenPGP keypair covers both purposes). Prefer tagging it
  // "encryption" once that purpose is published, since that's the tag
  // `restoreOfficeVault`/`hasPgp` and the compose/read screens key off.
  // Looked up by fingerprint, not getCurrentKey() — a second keypair with a
  // different algorithm (e.g. adding a PQC key alongside an existing
  // classical one) must land in its own entry, not overwrite the mismatched
  // one that getCurrentKey() would return.
  const currentEntry = session.vault.getKeyByFingerprint(fingerprint);
  if (!currentEntry) {
    session.vault.addKey({
      kind: "content",
      key_id: publishEncryption ? encryptionKeyId : signingKeyId,
      family: "pgp",
      purpose: publishEncryption ? "encryption" : "signing",
      algorithm: publishEncryption ? encryptionAlgorithm : signingAlgorithm,
      fingerprint,
      locator: formatOpenPgpLocator(fingerprint),
      status: "active",
      private_material: privateKey,
    });
  } else if (publishEncryption && currentEntry.purpose !== "encryption") {
    currentEntry.purpose = "encryption";
    currentEntry.algorithm = encryptionAlgorithm;
    currentEntry.key_id = encryptionKeyId;
  }

  const secret = await ensureDeviceSecret(session);
  await session.vault.persist(secret);
  return { generated };
}

export function vaultPgpPrivateKeys(session: OfficePubkeySession): Uint8Array[] {
  if (!session.vault.unlocked) return [];
  return session.vault
    .listKeys()
    .filter((entry) => entry.kind === "content" && entry.family === "pgp")
    .map((entry) => session.vault.getKey(entry.key_id))
    .map((entry) => entry?.private_material)
    .filter((bytes): bytes is Uint8Array => Boolean(bytes));
}

/** Passphrase-wrapped Vault JSON for backup. IndexedDB is not a backup. */
export async function exportVaultBackup(
  session: OfficePubkeySession,
  passphrase: string,
): Promise<string> {
  if (!session.vault.unlocked) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored) {
      throw new Error("Unlock the Vault before exporting");
    }
  }
  const exported = await session.vault.exportVault(passphrase);
  return JSON.stringify(exported, null, 2);
}

export async function importVaultBackup(
  session: OfficePubkeySession,
  serialized: string,
  passphrase: string,
): Promise<void> {
  const record = JSON.parse(serialized) as unknown;
  await session.vault.importVault(record, passphrase);
  const secret = await ensureDeviceSecret(session);
  await session.vault.persist(secret);
  await importMskFromVault(session);
}

export function listVaultTiles(session: OfficePubkeySession) {
  if (!session.vault.unlocked) return [];
  return session.vault.listKeys().filter((entry) => entry.kind === "content");
}

export async function exportKeyPackageBackup(
  session: OfficePubkeySession,
  fingerprint: string,
  passphrase: string,
): Promise<string> {
  if (!session.vault.unlocked) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored) throw new Error("Unlock the Vault before exporting");
  }
  const pkg = await session.vault.exportKeyPackage(fingerprint, passphrase);
  return JSON.stringify(pkg, null, 2);
}

export async function importKeyPackageBackup(
  session: OfficePubkeySession,
  serialized: string,
  passphrase: string,
): Promise<void> {
  if (!session.vault.unlocked) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored) await session.vault.createVault("office");
  }
  const record = JSON.parse(serialized) as Record<string, unknown>;
  await session.vault.importKeyPackage(record, passphrase);
  const secret = await ensureDeviceSecret(session);
  await session.vault.persist(secret);
}

export async function fetchVaultInventory(session: OfficePubkeySession, email: string) {
  if (!session.msk) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored || !session.msk) {
      throw new Error("MSK is not armed");
    }
  }
  return session.client.getMe({ email, mskKey: session.msk });
}

/**
 * Applies the VRK (and, for a "full" tier grant, AEK) received from
 * `PubkeyClient.completePairingAsNewDevice` (see VaultPanel.tsx's
 * "Add device" flow): creates a local vault if this device has none yet,
 * stores the keys, pulls the real vault content from `/v1/vault/*` (pairing
 * itself only transfers key material, not the vault ciphertext), and
 * recovers MSK signing capability when an AEK was granted.
 */
export async function completeDeviceTransfer(
  session: OfficePubkeySession,
  email: string,
  { vrk, aek }: { vrk: Uint8Array; aek?: Uint8Array },
): Promise<{ hasPgp: boolean; hasMsk: boolean }> {
  const secret = await ensureDeviceSecret(session);
  if (!session.vault.unlocked) {
    const record = await session.vault.store.load();
    if (record) {
      await session.vault.unlockVault(secret);
    } else {
      const principal = await principalFromEmail(normalizeEmail(email));
      await session.vault.createVault(principal);
    }
  }
  session.vault.vrk = vrk;
  if (aek) session.vault.aek = aek;
  await session.client.downloadCurrentVault({ email, vault: session.vault, merge: false });
  await session.vault.persist(secret);
  await importMskFromVault(session);
  const hasPgp = session.vault
    .listKeys()
    .some(
      (entry) =>
        entry.kind === "content" && entry.family === "pgp" && entry.purpose === "encryption",
    );
  return { hasPgp, hasMsk: Boolean(session.msk) };
}

export async function syncHostedVault(session: OfficePubkeySession, email: string) {
  if (!session.msk) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored || !session.msk) {
      throw new Error("MSK is not armed");
    }
  }
  const secret = await ensureDeviceSecret(session);
  if (!session.vault.unlocked) {
    await session.vault.unlockVault(secret);
  }
  return session.client.syncVault({
    email,
    mskKey: session.msk,
    persistSecret: secret,
  });
}

/**
 * Pull-only vault refresh: downloads the current hosted generation (if it's
 * newer than what's already applied) and merges it into the local Vault,
 * without also re-uploading local state. Use this to pick up keys another
 * device published, without racing an upload against it.
 */
export async function pullHostedVault(
  session: OfficePubkeySession,
  email: string,
): Promise<{ hasPgp: boolean }> {
  if (!session.msk) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored || !session.msk) {
      throw new Error("MSK is not armed");
    }
  }
  const secret = await ensureDeviceSecret(session);
  if (!session.vault.unlocked) {
    await session.vault.unlockVault(secret);
  }
  await session.client.downloadCurrentVault({ email, vault: session.vault, merge: true });
  await session.vault.persist(secret);
  await importMskFromVault(session);
  const hasPgp = session.vault
    .listKeys()
    .some(
      (entry) =>
        entry.kind === "content" && entry.family === "pgp" && entry.purpose === "encryption",
    );
  return { hasPgp };
}

export interface VaultDevice {
  deviceId: string;
  name: string;
  active: boolean;
}

/** Devices authorized to hold this identity's keys. See Settings → Devices. */
export async function listVaultDevices(
  session: OfficePubkeySession,
  email: string,
): Promise<VaultDevice[]> {
  if (!session.msk) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored || !session.msk) {
      throw new Error("MSK is not armed");
    }
  }
  const listed = (await session.client.listDevices({
    email: normalizeEmail(email),
    mskKey: session.msk,
  })) as { devices?: Array<{ device_id: string; active: boolean; device_name?: string }> };
  return (listed.devices ?? []).map((device) => ({
    deviceId: device.device_id,
    name: device.device_name || device.device_id,
    active: device.active,
  }));
}

/**
 * `client.revokeDevice` exists and works (see `client.js`) but isn't declared
 * in `index.d.ts` yet, so the call needs a local shape.
 */
type RevokeDeviceClient = {
  revokeDevice: (input: { email: string; deviceId: string; mskKey: KeyHandle }) => Promise<unknown>;
};

/** Revokes a device's authorization to open this identity's vault. */
export async function revokeVaultDevice(
  session: OfficePubkeySession,
  email: string,
  deviceId: string,
): Promise<void> {
  if (!session.msk) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored || !session.msk) {
      throw new Error("MSK is not armed");
    }
  }
  await (session.client as unknown as RevokeDeviceClient).revokeDevice({
    email: normalizeEmail(email),
    deviceId,
    mskKey: session.msk,
  });
}

export interface DevicePairingStart {
  pairingCode: string;
  sessionId: string;
  ephemeral: KeyHandle;
  deviceId: string;
}

/**
 * Device B (this, unauthorized) opens a pairing mailbox and returns a code to
 * type into an already-authorized device (see `approveDevicePairing`).
 */
export async function startDevicePairing(
  session: OfficePubkeySession,
  email: string,
): Promise<DevicePairingStart> {
  const started = await session.client.createPairingSession({
    email: normalizeEmail(email),
    deviceName: "Outlook",
    requestedTier: "full",
  });
  return {
    pairingCode: started.pairingCode,
    sessionId: started.sessionId,
    ephemeral: started.ephemeral,
    deviceId: started.deviceId,
  };
}

/**
 * Device B waits for an authorized device to approve `started`, then applies
 * the transferred vault locally. Resolves once approval lands (see
 * `approveDevicePairing` for the other side of this exchange).
 */
export async function awaitDevicePairing(
  session: OfficePubkeySession,
  email: string,
  started: DevicePairingStart,
): Promise<{ hasPgp: boolean; hasMsk: boolean }> {
  const { vrk, aek } = await session.client.completePairingAsNewDevice({
    email: normalizeEmail(email),
    sessionId: started.sessionId,
    ephemeral: started.ephemeral,
    deviceId: started.deviceId,
  });
  return completeDeviceTransfer(session, email, { vrk, aek });
}

/**
 * Device A (already authorized, vault unlocked) approves a device B pairing
 * code: fetches B's ephemeral key from the pairing mailbox and delivers a
 * wrapped copy of this vault's VRK (and AEK, for a "full" tier grant).
 */
export async function approveDevicePairing(
  session: OfficePubkeySession,
  email: string,
  sessionId: string,
): Promise<void> {
  if (!session.vault.unlocked) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored) {
      throw new Error("Unlock the Vault before approving a device");
    }
  }
  const canonical = normalizeEmail(email);
  const sha256 = await emailSha256Hex(canonical);
  const status = (await session.client.getPairingSession({
    sessionId,
    emailSha256: sha256,
  })) as { b_ephemeral_public_key?: Uint8Array | string };
  if (!status.b_ephemeral_public_key) {
    throw new Error("No pairing request found for that code. Ask for a fresh code.");
  }
  await session.client.respondToPairingSession({
    email: canonical,
    sessionId,
    peerEphemeralPublicKey: status.b_ephemeral_public_key,
    vrk: session.vault.ensureVrk(),
    aek: session.vault.aek ?? undefined,
  });
}

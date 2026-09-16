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
  wrapMskWithAek,
  type KeyHandle,
  type MskEnvelope,
} from "@scomm-office/pubkeys";
import {
  IndexedDbDeviceIdentityStore,
  IndexedDbDeviceSecretStore,
  IndexedDbVaultStore,
} from "@scomm-office/storage";
import { assertPgpAddon } from "./billing-pgp";
import { classifyDirectoryKey } from "./directory-key";
import { errorMessage } from "./error-message";
import { officeVaultOtpStore } from "./office-session-store";
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
  deviceIdentity: IndexedDbDeviceIdentityStore;
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
      deviceIdentity: new IndexedDbDeviceIdentityStore(),
      pendingMsk: null,
      msk: null,
    };
    cacheKey = key;
  }
  return cached;
}

/**
 * This browser profile's own device-authorization keypair — generated once
 * and persisted, then reused for every subsequent `verifyEnroll`/
 * `verifyReplace` call from this device. Without this, each OTP
 * verification (including a retry, or a later recovery for the same email)
 * would authorize a brand-new `device_id` under the same fixed device name
 * ("Outlook"), and the second one collides with the server's
 * `(principal_id, device_name)` uniqueness constraint — a 500 on
 * `/v1/msk/replace/verify` (or `/v1/msk/enroll/verify`), not a client error.
 */
export async function ensureDeviceKey(session: OfficePubkeySession): Promise<KeyHandle> {
  const stored = await session.deviceIdentity.load();
  if (stored) {
    return session.crypto.importPrivateKey(
      {
        algorithm: stored.algorithm,
        encoding: stored.encoding,
        bytes: decodeBase64Url(stored.bytesBase64Url),
        publicKey: stored.publicKeyBase64Url ? decodeBase64Url(stored.publicKeyBase64Url) : undefined,
        purpose: "authentication",
      },
      { extractable: true },
    );
  }
  const key = await session.crypto.generateDeviceKey({ extractable: true });
  const portable = await session.crypto.exportPrivateKey(key);
  await session.deviceIdentity.save({
    algorithm: portable.algorithm,
    encoding: portable.encoding,
    bytesBase64Url: encodeBase64Url(portable.bytes),
    publicKeyBase64Url: portable.publicKey ? encodeBase64Url(portable.publicKey) : undefined,
  });
  return key;
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

/** Whether the local Vault holds a published OpenPGP encryption key — what "hasPgp" means across this module. */
function vaultHasPgpEncryptionKey(session: OfficePubkeySession): boolean {
  return session.vault
    .listKeys()
    .some(
      (entry) =>
        entry.kind === "content" && entry.family === "pgp" && entry.purpose === "encryption",
    );
}

/** Arms `session.msk` from the local Vault if it isn't already, throwing if no armed MSK is available. */
async function ensureArmedMsk(session: OfficePubkeySession): Promise<KeyHandle> {
  if (session.msk) return session.msk;
  const restored = await restoreOfficeVault(session);
  if (!restored.restored || !session.msk) {
    throw new Error("MSK is not armed");
  }
  return session.msk;
}

/** True once this device has seen a generation it could actually decrypt. */
function hasRemoteGeneration(session: OfficePubkeySession): boolean {
  return session.vault.generation > 0 || session.vault.lastCiphertextHash != null;
}

/**
 * Saves a vault change and publishes it as a generation.
 *
 * `vault.persist` writes to this browser's IndexedDB and nothing else — a
 * change that stops there never reaches the identity, so the user's other
 * devices never see it and clearing the Office profile destroys it. Every
 * local vault write goes through here so that cannot be forgotten one call
 * site at a time.
 *
 * Local first, so a failed upload can never lose the change. Never throws:
 * by the time this runs the change is already made and saved, so whether an
 * unpublished change is fatal is the caller's call, not this helper's.
 */
async function persistAndPublishVault(
  session: OfficePubkeySession,
  email: string,
): Promise<{ synced: boolean; error?: string }> {
  const secret = await ensureDeviceSecret(session);
  await session.vault.persist(secret);
  // No Vault Root Key means one of two opposite things. This may be the
  // identity's *first* device, which has to mint one and establish
  // generation 1 — refusing there is what left a later-paired device
  // downloading an empty vault. Or the server already holds generations this
  // device cannot decrypt, in which case it is waiting to be paired and
  // minting a VRK would fork the vault. Only the second must not upload.
  if (!session.vault.vrk && hasRemoteGeneration(session)) {
    return { synced: false, error: "This device is not yet added to the Vault." };
  }
  try {
    const msk = await ensureArmedMsk(session);
    await session.client.syncVault({
      email: normalizeEmail(email),
      mskKey: msk,
      persistSecret: secret,
    });
    return { synced: true };
  } catch (err) {
    return { synced: false, error: errorMessage(err) };
  }
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
  return {
    restored: Boolean(session.msk),
    hasPgp: vaultHasPgpEncryptionKey(session),
  };
}

/**
 * Makes sure this device holds an Authority Encryption Key, wrapping the MSK
 * under it. Returns false when it cannot.
 *
 * The MSK must live in the vault wrapped, never raw. VRK alone is the
 * "limited" tier: a device granted only VRK reads content without gaining
 * signing authority. An unwrapped MSK in the vault plaintext collapses that —
 * any paired device can lift full authority out of it — and leaves this
 * device with no AEK to hand over, so a peer that asks for the "full" tier
 * pairs as limited and then dies on its first vault mutation with
 * device_not_authorized.
 *
 * Runs on every approval, not just at registration: an install that
 * registered before the vault carried an AEK still holds the legacy
 * unwrapped envelope, and would otherwise never be able to grant full
 * authority to anything, ever. The raw bytes are read from that envelope
 * rather than re-exported from the live handle, which is imported
 * non-extractable.
 */
async function ensureAuthorityKey(session: OfficePubkeySession): Promise<boolean> {
  if (session.vault.aek) return true;
  const envelope = (session.vault.getMsk() as { envelope?: MskEnvelope } | null)?.envelope;
  // A wrapped envelope with no AEK on hand means this device is itself
  // limited tier — it has nothing to grant and nothing to upgrade.
  if (!envelope?.encrypted_msk || envelope.iv) return false;
  const aek = session.crypto.random(32);
  const wrapped = await wrapMskWithAek(
    session.crypto,
    aek,
    decodeBase64Url(String(envelope.encrypted_msk)),
  );
  session.vault.aek = aek;
  session.vault.setMskEnvelope({ ...envelope, ...wrapped });
  return true;
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
  await ensureAuthorityKey(session);
  session.msk = msk;
  session.pendingMsk = null;
  // Genesis. Until this lands, the identity has no vault generation at all —
  // a device that pairs with this one downloads nothing and ends up with no
  // keys and no MSK envelope to recover signing authority from.
  await persistAndPublishVault(session, email);
}

const PENDING_OTP_KEY = "vault-pending-otp";
// New Outlook tears the taskpane down and recreates it when the user
// switches messages (e.g. to go read the OTP email); classic Outlook keeps
// it alive. A short TTL bounds how long a stale/abandoned challenge can be
// resumed after such a teardown, without requiring the user to notice and
// cancel it themselves.
const PENDING_OTP_TTL_MS = 10 * 60 * 1000;

export type PendingOtpFlow = "enroll" | "recover";

interface PersistedPendingOtp {
  flow: PendingOtpFlow;
  email: string;
  statusMessage: string | null;
  createdAt: number;
  msk: {
    algorithm: string;
    encoding: string;
    bytesBase64Url: string;
    publicKeyBase64Url?: string;
  };
}

/** Called right after `requestOtp`/`beginRecovery`/`registerOnDirectory` move status to otp-sent/recover-otp. */
export async function savePendingOtpChallenge(
  session: OfficePubkeySession,
  flow: PendingOtpFlow,
  email: string,
  statusMessage: string | null,
): Promise<void> {
  const msk = session.pendingMsk ?? session.msk;
  if (!msk) return;
  const portable = await session.crypto.exportPrivateKey(msk);
  const record: PersistedPendingOtp = {
    flow,
    email,
    statusMessage,
    createdAt: Date.now(),
    msk: {
      algorithm: portable.algorithm,
      encoding: portable.encoding,
      bytesBase64Url: encodeBase64Url(portable.bytes),
      publicKeyBase64Url: portable.publicKey ? encodeBase64Url(portable.publicKey) : undefined,
    },
  };
  await officeVaultOtpStore().set(PENDING_OTP_KEY, JSON.stringify(record));
}

/**
 * Restores a not-yet-expired OTP challenge on mount, including the pending
 * MSK keypair, so `useVaultIdentity`'s init effect can resume directly on
 * the OTP screen instead of re-probing identity existence from scratch.
 */
export async function loadPendingOtpChallenge(
  session: OfficePubkeySession,
): Promise<{ flow: PendingOtpFlow; email: string; statusMessage: string | null } | null> {
  const raw = await officeVaultOtpStore().get(PENDING_OTP_KEY);
  if (!raw) return null;
  let record: PersistedPendingOtp;
  try {
    record = JSON.parse(raw) as PersistedPendingOtp;
  } catch {
    await clearPendingOtpChallenge();
    return null;
  }
  if (Date.now() - record.createdAt > PENDING_OTP_TTL_MS) {
    await clearPendingOtpChallenge();
    return null;
  }
  try {
    const msk = await session.crypto.importPrivateKey(
      {
        algorithm: record.msk.algorithm,
        encoding: record.msk.encoding,
        bytes: decodeBase64Url(record.msk.bytesBase64Url),
        publicKey: record.msk.publicKeyBase64Url
          ? decodeBase64Url(record.msk.publicKeyBase64Url)
          : undefined,
        purpose: PURPOSES.masterSigning,
      },
      { extractable: true },
    );
    session.pendingMsk = msk;
    session.msk = msk;
  } catch {
    await clearPendingOtpChallenge();
    return null;
  }
  return { flow: record.flow, email: record.email, statusMessage: record.statusMessage };
}

export async function clearPendingOtpChallenge(): Promise<void> {
  await officeVaultOtpStore().delete(PENDING_OTP_KEY);
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
 *
 * Publishing an artifact registers only the *public* half, in
 * `public_key_artifacts`. The private material reaches the identity — and
 * therefore the user's other devices — only as a vault generation, so this
 * uploads one as part of the same action (secMail10 does the same: one user
 * action, one generation). Left to a later manual "Sync with Scomm.AI"
 * click, the only copy of a freshly created key lives in this browser's
 * IndexedDB, where clearing the Office profile destroys it and no other
 * device can read mail sent to it meanwhile.
 *
 * `vaultSynced` reports whether that upload happened. It is not fatal when
 * it doesn't: by then the artifact is published and the key is in local
 * storage, so throwing would report a key that genuinely exists as not
 * created. The caller shows the key as local-only instead.
 */
export async function publishPgpContentKey(
  session: OfficePubkeySession,
  email: string,
  purposes: PgpKeyPurpose[] = BOTH_PGP_PURPOSES,
  algorithm: PgpKeyAlgorithm = DEFAULT_PGP_ALGORITHM,
): Promise<{ generated: boolean; vaultSynced: boolean; vaultSyncError?: string }> {
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
  // Publishing an encryption artifact *is* promotion here: the server's
  // set_encryption_key zeroes any older active encryption artifact, so from
  // this moment new senders get this key. Recording that in the vault's own
  // pointer is what stops secMail10 offering "Make active" for a key that is
  // already the advertised one. Office has no separate publish-without-
  // advertising step, so there is nothing else this could mean.
  if (publishEncryption && encryptionKeyId) {
    session.vault.currentEncryptionKeyId = String(encryptionKeyId);
  }
  if (publishSigning && signingKeyId) {
    session.vault.currentSigningKeyId = String(signingKeyId);
  }

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

  const published = await persistAndPublishVault(session, email);
  return { generated, vaultSynced: published.synced, vaultSyncError: published.error };
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
  email: string,
  serialized: string,
  passphrase: string,
): Promise<void> {
  const record = JSON.parse(serialized) as unknown;
  await session.vault.importVault(record, passphrase);
  await importMskFromVault(session);
  await persistAndPublishVault(session, email);
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
  email: string,
  serialized: string,
  passphrase: string,
): Promise<void> {
  if (!session.vault.unlocked) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored) await session.vault.createVault("office");
  }
  const record = JSON.parse(serialized) as Record<string, unknown>;
  await session.vault.importKeyPackage(record, passphrase);
  // Same as creating a key: an imported key that never leaves IndexedDB is
  // invisible to every other device and dies with the Office profile.
  await persistAndPublishVault(session, email);
}

export async function fetchVaultInventory(session: OfficePubkeySession, email: string) {
  const msk = await ensureArmedMsk(session);
  return session.client.getMe({ email, mskKey: msk });
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
  return { hasPgp: vaultHasPgpEncryptionKey(session), hasMsk: Boolean(session.msk) };
}

export async function syncHostedVault(session: OfficePubkeySession, email: string) {
  const msk = await ensureArmedMsk(session);
  const secret = await ensureDeviceSecret(session);
  if (!session.vault.unlocked) {
    await session.vault.unlockVault(secret);
  }
  return session.client.syncVault({
    email,
    mskKey: msk,
    persistSecret: secret,
  });
}

export interface VaultDevice {
  deviceId: string;
  name: string;
  active: boolean;
}

/**
 * Devices authorized to hold this identity's keys. See Settings → Devices.
 *
 * Two registries, deliberately: `listDevices` reads the server's
 * `authorized_devices` table, which only the MSK-proof-of-possession
 * enrollment flow writes — pairing never touches it (a documented gap in the
 * pubkey repo's mutateService.ts). A device that joined by pairing exists
 * only in the vault's own encrypted `metadata.devices`, which the server
 * structurally cannot read. Listing just the server table therefore hid every
 * paired device, including one this very add-in had approved.
 */
export async function listVaultDevices(
  session: OfficePubkeySession,
  email: string,
): Promise<VaultDevice[]> {
  const msk = await ensureArmedMsk(session);
  const listed = (await session.client.listDevices({
    email: normalizeEmail(email),
    mskKey: msk,
  })) as { devices?: Array<{ device_id: string; active: boolean; device_name?: string }> };
  const devices = (listed.devices ?? []).map((device) => ({
    deviceId: device.device_id,
    name: device.device_name || device.device_id,
    active: device.active,
  }));
  const seen = new Set(devices.map((device) => device.deviceId));
  for (const raw of session.vault.unlocked ? session.vault.devices : []) {
    const entry = raw as { device_id?: string; name?: string };
    if (!entry.device_id || seen.has(entry.device_id)) continue;
    devices.push({
      deviceId: entry.device_id,
      name: entry.name || entry.device_id,
      active: true,
    });
  }
  return devices;
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
  const msk = await ensureArmedMsk(session);
  await (session.client as unknown as RevokeDeviceClient).revokeDevice({
    email: normalizeEmail(email),
    deviceId,
    mskKey: msk,
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
  })) as {
    b_ephemeral_public_key?: Uint8Array | string;
    b_device_id?: string;
    device_name?: string;
    requested_tier?: string;
  };
  if (!status.b_ephemeral_public_key) {
    throw new Error("No pairing request found for that code. Ask for a fresh code.");
  }
  // Honour the tier the peer asked for. Authority is the AEK: without it a
  // "full" request pairs as read-only and the peer fails on its first vault
  // mutation; with it handed out unasked, a "limited" request silently gets
  // signing authority it never requested.
  const wantsFullAuthority = (status.requested_tier ?? "limited") === "full";
  if (wantsFullAuthority) await ensureAuthorityKey(session);
  await session.client.respondToPairingSession({
    email: canonical,
    sessionId,
    peerEphemeralPublicKey: status.b_ephemeral_public_key,
    vrk: session.vault.ensureVrk(),
    aek: wantsFullAuthority ? (session.vault.aek ?? undefined) : undefined,
  });

  // Handing over the VRK is only half of pairing. The new device pairs in
  // order to *download* the vault, so a generation has to exist — and the
  // roster it joins has to say it does.
  //
  // Pairing never populates the server's `authorized_devices` table (a
  // documented gap in the pubkey repo's mutateService.ts): the vault's own
  // `metadata.devices` is the only place a paired device is ever recorded.
  // Registering it here and uploading in the same step is also what makes
  // the just-minted VRK durable — left in memory, the next reload mints a
  // different one and this device can no longer read the vault it gave away.
  if (status.b_device_id) {
    session.vault.devices = [
      ...session.vault.devices.filter(
        (device) => (device as { device_id?: string }).device_id !== status.b_device_id,
      ),
      {
        device_id: status.b_device_id,
        name: status.device_name || "Paired device",
        tier: status.requested_tier || "limited",
        added_at: Date.now(),
      },
    ];
  }
  // Upload now rather than after waiting for the peer to confirm retrieval:
  // the peer downloads the vault the moment it unwraps the envelope, so a
  // generation published later than that is a generation it never sees.
  const published = await persistAndPublishVault(session, canonical);
  if (!published.synced) {
    // Unlike the other callers, an unpublished change here makes the whole
    // action pointless: the peer now holds a key to a vault that was never
    // put anywhere it can read.
    throw new Error(`Device approved, but the Vault could not be published: ${published.error}`);
  }
}

// CKVF spec §9b recovery-code recovery. Distinct from both device pairing
// above (needs an already-authorized peer device) and the email-OTP-only
// "recover identity" flow (mints a brand-new MSK, cannot restore old vault
// content) — this restores the *existing* vault from a server-held envelope
// only a client holding the recovery code can unwrap.

/** Unauthenticated existence check — call before deciding whether to offer recovery-code entry vs. device pairing. */
export async function checkRecoveryEnvelope(
  session: OfficePubkeySession,
  email: string,
): Promise<boolean> {
  return session.client.hasRecoveryEnvelope({ email: normalizeEmail(email) });
}

/** Requests the single-use OTP that gates fetching the recovery envelope. */
export async function requestRecoveryCodeOtp(
  session: OfficePubkeySession,
  email: string,
): Promise<void> {
  await session.client.requestRecoveryEnvelopeOtp({ email: normalizeEmail(email) });
}

/**
 * Fetches and unwraps the recovery envelope with `otp` + `recoveryCode`,
 * then applies the recovered VRK/AEK exactly like `completeDeviceTransfer`
 * (creates a local vault if needed, pulls the real vault content, recovers
 * MSK signing capability when an AEK was included).
 */
export async function restoreFromRecoveryCode(
  session: OfficePubkeySession,
  email: string,
  otp: string,
  recoveryCode: string,
): Promise<{ hasPgp: boolean; hasMsk: boolean }> {
  const { vrk, aek } = await session.client.recoverVaultWithCode({
    email: normalizeEmail(email),
    otp,
    recoveryCode,
  });
  return completeDeviceTransfer(session, email, { vrk, aek });
}

/**
 * Generates a fresh recovery code, wraps this vault's VRK (and AEK, if this
 * device holds one) under it, and uploads the envelope — replacing any
 * previously-set one for this identity. Returns the plaintext code: show it
 * to the user exactly once, this app never persists or logs it.
 */
export async function saveRecoveryEnvelope(
  session: OfficePubkeySession,
  email: string,
): Promise<string> {
  const msk = await ensureArmedMsk(session);
  if (!session.vault.unlocked) {
    throw new Error("Unlock the Vault before setting up a recovery code");
  }
  return session.client.setRecoveryEnvelope({
    email: normalizeEmail(email),
    mskKey: msk,
    vrk: session.vault.ensureVrk(),
    aek: session.vault.aek ?? undefined,
  });
}

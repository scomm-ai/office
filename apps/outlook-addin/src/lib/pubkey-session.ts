import {
  MSK_ALGORITHM,
  PURPOSES,
  createPubkeyClient,
  decodeBase64Url,
  encodeBase64Url,
  formatOpenPgpLocator,
  normalizeEmail,
  principalFromEmail,
  unwrapMskWithAek,
  type KeyHandle,
} from "@scomm-office/pubkeys";
import { IndexedDbDeviceSecretStore, IndexedDbVaultStore } from "@scomm-office/storage";

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
  const key = `${options.readBaseUrl}|${options.writeBaseUrl ?? ""}`;
  if (!cached || cacheKey !== key) {
    const created = createPubkeyClient({
      readBaseUrl: options.readBaseUrl,
      writeBaseUrl: options.writeBaseUrl,
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

async function importMskFromVault(session: OfficePubkeySession): Promise<void> {
  const entry = session.vault.getMsk() as {
    private_material?: Uint8Array;
    envelope?: { iv?: string; encrypted_msk?: string };
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
  session.msk = await session.crypto.importPrivateKey({
    algorithm: MSK_ALGORITHM,
    encoding: "raw-32",
    bytes,
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
        entry.kind === "content" &&
        entry.family === "pgp" &&
        entry.purpose === "encryption",
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

export async function publishPgpContentKey(
  session: OfficePubkeySession,
  email: string,
): Promise<void> {
  const msk = session.msk;
  if (!msk) {
    throw new Error("MSK is not armed");
  }
  if (!session.pgpEngine.available) {
    throw new Error("OpenPGP engine is not available");
  }
  const existing = session.vault.getCurrentKey("encryption");
  if (existing?.private_material && existing.family === "pgp") {
    return;
  }
  const canonical = normalizeEmail(email);
  const generated = await session.pgpEngine.generateKey({
    name: canonical,
    email: canonical,
  });
  const result = (await session.client.setKeys({
    email: canonical,
    artifacts: [
      {
        family: "pgp",
        purpose: "encryption",
        algorithm: "openpgp-cv25519",
        public_material: encodeBase64Url(generated.publicKey),
      },
    ],
    mskKey: msk,
  })) as { key_id?: number };
  session.vault.addKey({
    kind: "content",
    key_id: result.key_id ?? 0,
    family: "pgp",
    purpose: "encryption",
    algorithm: "openpgp-cv25519",
    fingerprint: generated.fingerprint,
    locator: formatOpenPgpLocator(generated.fingerprint),
    status: "active",
    private_material: generated.privateKey,
  });
  const secret = await ensureDeviceSecret(session);
  await session.vault.persist(secret);
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

export async function fetchVaultInventory(
  session: OfficePubkeySession,
  email: string,
) {
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
 * `PubkeyClient.completePairingAsNewDevice` (see SecurityPanel.tsx's
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

export async function syncHostedVault(
  session: OfficePubkeySession,
  email: string,
) {
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

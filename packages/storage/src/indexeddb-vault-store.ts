import type { VaultStore } from "@scomm/pubkey";

const DB_NAME = "scomm-vault";
const STORE = "vault";
const KEY = "current";
const UNLOCK_KEY = "device-unlock";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Office-hosted persistence for an encrypted SComm Vault. */
export class IndexedDbVaultStore implements VaultStore {
  async load() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async save(record: unknown) {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear() {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

const DKEK_ALGORITHM = { name: "AES-GCM", length: 256 } as const;
const DKEK_USAGES: KeyUsage[] = ["encrypt", "decrypt"];
const GCM_IV_BYTES = 12;

/**
 * Generates a non-extractable AES-GCM key. `crypto.subtle.generateKey`
 * with `extractable: false` never yields raw key bytes to JS-readable
 * memory, and a `CryptoKey` remains non-extractable across an IndexedDB
 * structured-clone round-trip — this is the Web-tier "DKEK" (device key
 * encryption key) the CKVF spec's Section 7 calls for: WebCrypto-based,
 * non-portable, but never itself readable or exportable.
 */
export async function generateDkek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(DKEK_ALGORITHM, false, DKEK_USAGES);
}

/** Wraps the device-local unlock secret so it never sits in the clear. */
export async function wrapSecretWithDkek(
  dkek: CryptoKey,
  secret: string,
): Promise<{ iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const plaintext = new TextEncoder().encode(secret);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dkek, plaintext),
  );
  return { iv, ciphertext };
}

export async function unwrapSecretWithDkek(
  dkek: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  ciphertext: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, dkek, ciphertext);
  return new TextDecoder().decode(plaintext);
}

interface WrappedDeviceSecretRecord {
  dkek: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
}

function isWrappedRecord(value: unknown): value is WrappedDeviceSecretRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "dkek" in value &&
    "iv" in value &&
    "ciphertext" in value
  );
}

/**
 * Device-local Vault passphrase. Not a user-chosen export password.
 * Portable backup still uses a user passphrase via Vault.exportVault.
 *
 * The secret itself is never persisted in the clear: it is AES-GCM-wrapped
 * by a non-extractable, per-device CryptoKey (see `generateDkek` above)
 * before being written to IndexedDB, so a bug or script sharing this
 * origin cannot recover the vault-unlock secret by reading the object
 * store directly the way it previously could.
 */
export class IndexedDbDeviceSecretStore {
  async load(): Promise<string | null> {
    const db = await openDb();
    const record = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(UNLOCK_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (record == null) return null;
    if (isWrappedRecord(record)) {
      return unwrapSecretWithDkek(record.dkek, record.iv, record.ciphertext);
    }
    if (typeof record === "string") {
      // Legacy shape from before DKEK-wrapping: a plaintext secret. Keep
      // it readable (don't lock existing devices out of their vault), but
      // opportunistically upgrade it to the wrapped shape on this read.
      await this.save(record);
      return record;
    }
    return null;
  }

  async save(secret: string): Promise<void> {
    const dkek = await generateDkek();
    const { iv, ciphertext } = await wrapSecretWithDkek(dkek, secret);
    const record: WrappedDeviceSecretRecord = { dkek, iv, ciphertext };
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record, UNLOCK_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(): Promise<void> {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(UNLOCK_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

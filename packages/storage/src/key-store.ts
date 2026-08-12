import { UnsupportedFeatureError } from "@scomm-office/core";

/**
 * Key storage abstraction.
 *
 * See openspec/security/private-key-storage.md
 */

export type KeyAlgorithm = "Ed25519" | "X25519" | "ECDH-P256";

export interface GeneratedKeyPair {
  keyId: string;
  algorithm: KeyAlgorithm;
  publicKey: string;
  encoding: "base64url" | "jwk";
  purpose: "signing" | "encryption" | "authentication";
}

export interface KeyStore {
  generate(options: {
    algorithm: GeneratedKeyPair["algorithm"];
    purpose: GeneratedKeyPair["purpose"];
  }): Promise<GeneratedKeyPair>;

  getPublic(keyId: string): Promise<GeneratedKeyPair | null>;

  /** Production implementations must use non-exportable secure storage. */
  getPrivate(keyId: string): Promise<CryptoKey | ArrayBuffer>;
}

/**
 * Production KeyStore stub — private key access is intentionally unsupported.
 * See openspec/security/private-key-storage.md
 */
export class UnsupportedKeyStore implements KeyStore {
  async generate(_options: {
    algorithm: GeneratedKeyPair["algorithm"];
    purpose: GeneratedKeyPair["purpose"];
  }): Promise<GeneratedKeyPair> {
    throw new UnsupportedFeatureError(
      "Production private key storage has not been implemented. See openspec/security/private-key-storage.md",
    );
  }

  async getPublic(_keyId: string): Promise<GeneratedKeyPair | null> {
    throw new UnsupportedFeatureError(
      "Production private key storage has not been implemented. See openspec/security/private-key-storage.md",
    );
  }

  async getPrivate(_keyId: string): Promise<CryptoKey | ArrayBuffer> {
    throw new UnsupportedFeatureError(
      "Production private key retrieval is not supported. See openspec/security/private-key-storage.md",
    );
  }
}

interface StoredDevKey {
  pair: GeneratedKeyPair;
  privateKeyMaterial: Uint8Array;
}

/**
 * @experimental Dev/test-only in-memory key store. Never use in production.
 * See openspec/security/private-key-storage.md
 */
export class DevMemoryKeyStore implements KeyStore {
  private readonly keys = new Map<string, StoredDevKey>();
  private counter = 0;

  async generate(options: {
    algorithm: GeneratedKeyPair["algorithm"];
    purpose: GeneratedKeyPair["purpose"];
  }): Promise<GeneratedKeyPair> {
    this.counter += 1;
    const keyId = `dev-key-${this.counter}`;
    const material = crypto.getRandomValues(new Uint8Array(32));
    const publicKey = btoa(String.fromCharCode(...material)).replace(/\+/g, "-").replace(/\//g, "_");

    const pair: GeneratedKeyPair = {
      keyId,
      algorithm: options.algorithm,
      publicKey,
      encoding: "base64url",
      purpose: options.purpose,
    };

    this.keys.set(keyId, { pair, privateKeyMaterial: material });
    return pair;
  }

  async getPublic(keyId: string): Promise<GeneratedKeyPair | null> {
    return this.keys.get(keyId)?.pair ?? null;
  }

  async getPrivate(keyId: string): Promise<ArrayBuffer> {
    const stored = this.keys.get(keyId);
    if (!stored) {
      throw new UnsupportedFeatureError(`Dev key not found: ${keyId}`);
    }
    const copy = stored.privateKeyMaterial.slice();
    return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer;
  }
}

const IDB_DB_NAME = "scomm-keystore";
const IDB_STORE_NAME = "keys";
const IDB_VERSION = 1;

interface StoredWebCryptoKey {
  keyId: string;
  algorithm: KeyAlgorithm;
  publicKey: string;
  encoding: "base64url";
  purpose: GeneratedKeyPair["purpose"];
  privateKey: CryptoKey;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: "keyId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db: IDBDatabase, keyId: string): Promise<StoredWebCryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, "readonly");
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.get(keyId);
    req.onsuccess = () => resolve(req.result as StoredWebCryptoKey | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, record: StoredWebCryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, "readwrite");
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(db: IDBDatabase): Promise<StoredWebCryptoKey[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, "readonly");
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as StoredWebCryptoKey[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * WebCrypto + IndexedDB key store for ECDH P-256 encryption keys.
 *
 * Private keys are stored as non-exportable CryptoKey handles in IndexedDB.
 * Only the public key is extractable (for publishing to pubkey server).
 *
 * Persistence depends on the Outlook host — see openspec/security/private-key-storage.md.
 */
export class WebCryptoKeyStore implements KeyStore {
  private counter = 0;

  async generate(options: {
    algorithm: GeneratedKeyPair["algorithm"];
    purpose: GeneratedKeyPair["purpose"];
  }): Promise<GeneratedKeyPair> {
    if (options.algorithm !== "ECDH-P256") {
      throw new Error(
        `WebCryptoKeyStore only supports ECDH-P256. Got: ${options.algorithm}`,
      );
    }

    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false, // non-exportable private key
      ["deriveBits"],
    );

    // Export the public key as raw bytes (65 bytes uncompressed)
    const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const publicKeyB64 = toBase64Url(pubRaw);

    this.counter += 1;
    const keyId = `scomm-${Date.now()}-${this.counter}`;

    const pair: GeneratedKeyPair = {
      keyId,
      algorithm: "ECDH-P256",
      publicKey: publicKeyB64,
      encoding: "base64url",
      purpose: options.purpose,
    };

    // Store in IndexedDB with the non-exportable private key handle
    const db = await openKeyDb();
    try {
      await idbPut(db, {
        keyId,
        algorithm: "ECDH-P256",
        publicKey: publicKeyB64,
        encoding: "base64url",
        purpose: options.purpose,
        privateKey: keyPair.privateKey,
      });
    } finally {
      db.close();
    }

    return pair;
  }

  async getPublic(keyId: string): Promise<GeneratedKeyPair | null> {
    const db = await openKeyDb();
    try {
      const stored = await idbGet(db, keyId);
      if (!stored) return null;
      return {
        keyId: stored.keyId,
        algorithm: stored.algorithm,
        publicKey: stored.publicKey,
        encoding: stored.encoding,
        purpose: stored.purpose,
      };
    } finally {
      db.close();
    }
  }

  async getPrivate(keyId: string): Promise<CryptoKey> {
    const db = await openKeyDb();
    try {
      const stored = await idbGet(db, keyId);
      if (!stored) {
        throw new Error(`Key not found: ${keyId}`);
      }
      return stored.privateKey;
    } finally {
      db.close();
    }
  }

  async listKeyIds(): Promise<string[]> {
    const db = await openKeyDb();
    try {
      const all = await idbGetAll(db);
      return all.map((k) => k.keyId);
    } finally {
      db.close();
    }
  }
}

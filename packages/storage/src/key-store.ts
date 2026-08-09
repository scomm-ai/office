import { UnsupportedFeatureError } from "@scomm-office/core";

/**
 * Experimental key storage abstraction.
 *
 * Production durable private-key storage is deferred pending security review.
 * See openspec/security/private-key-storage.md
 */

export interface GeneratedKeyPair {
  keyId: string;
  algorithm: "Ed25519" | "X25519";
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

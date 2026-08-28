import type { DecryptionKeyHandle, PublicKeyMetadata, SigningKeyHandle } from "./types.js";
import { CryptoFamily } from "./types.js";

/** In-memory key handle wrapping raw private key bytes — for tests only. Production uses vault bridge. */
export class RawSigningKeyHandle implements SigningKeyHandle {
  constructor(
    private readonly metadata: PublicKeyMetadata,
    private readonly signFn: (digest: Uint8Array) => Promise<Uint8Array>,
  ) {}

  async getPublicMetadata(): Promise<PublicKeyMetadata> {
    return this.metadata;
  }

  async signDigest(digest: Uint8Array): Promise<Uint8Array> {
    return this.signFn(digest);
  }
}

export class RawDecryptionKeyHandle implements DecryptionKeyHandle {
  constructor(
    private readonly metadata: PublicKeyMetadata,
    private readonly decryptFn: (ciphertext: Uint8Array) => Promise<Uint8Array>,
  ) {}

  async getPublicMetadata(): Promise<PublicKeyMetadata> {
    return this.metadata;
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    return this.decryptFn(ciphertext);
  }
}

export interface VaultKeyMaterial {
  fingerprint: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  canSign: boolean;
  canEncrypt: boolean;
  algorithm: string;
  identity: string;
}

/** Adapter from vault key material to handles without exposing raw bytes to callers. */
export function createHandlesFromVaultMaterial(
  material: VaultKeyMaterial,
  crypto: {
    sign: (privateKey: Uint8Array, data: Uint8Array) => Promise<Uint8Array>;
    decrypt: (privateKey: Uint8Array, ciphertext: Uint8Array) => Promise<Uint8Array>;
  },
): { signing?: SigningKeyHandle; decryption?: DecryptionKeyHandle } {
  const meta: PublicKeyMetadata = {
    family: CryptoFamily.OpenPGP,
    identity: material.identity,
    fingerprint: material.fingerprint,
    shortKeyId: material.fingerprint.slice(-8),
    algorithm: material.algorithm,
    canSign: material.canSign,
    canEncrypt: material.canEncrypt,
  };

  const result: { signing?: SigningKeyHandle; decryption?: DecryptionKeyHandle } = {};

  if (material.canSign) {
    result.signing = new RawSigningKeyHandle(meta, (digest) =>
      crypto.sign(material.privateKey, digest),
    );
  }
  if (material.canEncrypt) {
    result.decryption = new RawDecryptionKeyHandle(meta, (ct) =>
      crypto.decrypt(material.privateKey, ct),
    );
  }
  return result;
}

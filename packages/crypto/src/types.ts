import type { LogicalMessage } from "@scomm-office/message-core";

/** Top-level crypto protocol families. */
export enum CryptoFamily {
  OpenPGP = "openpgp",
  SMIME = "smime",
}

export type ProtectionMode = "none" | "sign" | "encrypt" | "signAndEncrypt";

export interface PublicKeyMetadata {
  family: CryptoFamily;
  identity: string;
  fingerprint: string;
  shortKeyId: string;
  algorithm: string;
  canSign: boolean;
  canEncrypt: boolean;
  revoked?: boolean;
  validFrom?: string;
  validTo?: string;
}

export interface SigningKeyHandle {
  getPublicMetadata(): Promise<PublicKeyMetadata>;
  signDigest(digest: Uint8Array, algorithm?: string): Promise<Uint8Array>;
}

export interface DecryptionKeyHandle {
  getPublicMetadata(): Promise<PublicKeyMetadata>;
  decrypt(ciphertext: Uint8Array): Promise<Uint8Array>;
}

export interface PublicKeyMaterial {
  family: CryptoFamily;
  identity: string;
  material: Uint8Array | string;
  fingerprint: string;
  shortKeyId: string;
  algorithm: string;
  canSign: boolean;
  canEncrypt: boolean;
}

export interface ProtectedMessage {
  family: CryptoFamily;
  mode: ProtectionMode;
  mime: Uint8Array;
  eml?: Uint8Array;
}

export interface CryptoOperationContext {
  message: LogicalMessage;
  recipientKeys: PublicKeyMaterial[];
  senderSigningKey?: SigningKeyHandle;
  senderEncryptionKey?: PublicKeyMaterial;
  includeSenderForEncryption?: boolean;
}

export interface VerificationState {
  state:
    | "not-signed"
    | "signed-unverified"
    | "verified"
    | "invalid"
    | "key-unavailable"
    | "identity-mismatch"
    | "untrusted"
    | "revoked";
  family?: CryptoFamily;
  signer?: string;
  keyId?: string;
  signatureValid?: boolean;
  identityBindingValid?: boolean;
  trustValid?: boolean;
  reason?: string;
}

export interface EncryptionState {
  state: "not-encrypted" | "encrypted" | "decrypted" | "decrypt-failed";
  family?: CryptoFamily;
  recipientKeyId?: string;
}

export interface SemanticVerificationSummary {
  state: "not-present" | "verified" | "invalid" | "manifest-mismatch";
  authoredText?: "verified" | "modified" | "unknown";
  attachments?: "verified" | "modified" | "missing" | "unexpected";
  htmlCorrespondence?: "match" | "differs" | "unknown";
  unsignedContentAdded?: boolean;
}

export interface MessageInspectionResult {
  protectionKind: string;
  encryption: EncryptionState;
  standardsSignature: VerificationState;
  semanticSignature?: SemanticVerificationSummary;
}

export interface CryptoProvider {
  readonly family: CryptoFamily;
  sign(context: CryptoOperationContext): Promise<ProtectedMessage>;
  encrypt(context: CryptoOperationContext): Promise<ProtectedMessage>;
  signAndEncrypt(context: CryptoOperationContext): Promise<ProtectedMessage>;
  verify(mime: Uint8Array, publicKeys: PublicKeyMaterial[]): Promise<VerificationState>;
  decrypt(
    mime: Uint8Array,
    decryptionKey: DecryptionKeyHandle,
  ): Promise<{ plaintext: Uint8Array; verification?: VerificationState }>;
  decryptAndVerify(
    mime: Uint8Array,
    decryptionKey: DecryptionKeyHandle,
    publicKeys: PublicKeyMaterial[],
  ): Promise<{ message: LogicalMessage; verification: VerificationState }>;
}

export interface MessageSubmissionAdapter {
  submit(protectedMessage: ProtectedMessage, headers?: Record<string, string>): Promise<void>;
}

export interface PublicKeyCacheEntry {
  identity: string;
  family: CryptoFamily;
  algorithm: string;
  keyId: string;
  fingerprint: string;
  publicKey: Uint8Array | string;
  firstSeen: string;
  lastSeen: string;
  lastValidated?: string;
  status: "active" | "expired" | "revoked" | "unknown";
  source: string;
}

export interface PublicKeyCache {
  get(identity: string, family: CryptoFamily, purpose: "sign" | "encrypt"): Promise<PublicKeyCacheEntry | null>;
  put(entry: PublicKeyCacheEntry): Promise<void>;
  isFresh(entry: PublicKeyCacheEntry, maxAgeMs: number): boolean;
}

export interface KeyVault {
  getSigningKey(fingerprint: string): Promise<SigningKeyHandle | null>;
  getDecryptionKey(fingerprint: string): Promise<DecryptionKeyHandle | null>;
  listKeys(): Promise<PublicKeyMetadata[]>;
}

export interface KeyResolver {
  resolveSigningKey(identity: string, family: CryptoFamily): Promise<PublicKeyMaterial | null>;
  resolveEncryptionKey(identity: string, family: CryptoFamily): Promise<PublicKeyMaterial | null>;
}

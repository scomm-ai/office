import * as openpgp from "openpgp";
import {
  CryptoFamily,
  CryptoErrorCodes,
  ScommCryptoError,
  formatShortKeyId,
  type CryptoOperationContext,
  type CryptoProvider,
  type DecryptionKeyHandle,
  type ProtectedMessage,
  type PublicKeyMaterial,
  type SigningKeyHandle,
  type VerificationState,
} from "@scomm-office/crypto";
import { toLogicalMessage, type LogicalMessage } from "@scomm-office/message-core";
import {
  CRLF,
  buildMultipartEncrypted,
  buildMultipartSigned,
  detectMimeStructure,
  extractEncryptedPayloadFromMime,
  extractSignedEntityFromMultipartSigned,
  logicalMessageToMime,
  mimeToEml,
} from "@scomm-office/mime";

const BEGIN_PGP = "-----BEGIN PGP";

function coerceBytes(value: Uint8Array | string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  return new TextEncoder().encode(value);
}

async function readPublicKey(material: Uint8Array | string): Promise<openpgp.Key> {
  const bytes = coerceBytes(material);
  const text = new TextDecoder().decode(bytes);
  if (text.includes(BEGIN_PGP)) {
    return openpgp.readKey({ armoredKey: text });
  }
  return openpgp.readKey({ binaryKey: bytes });
}

async function readPrivateKeyFromHandle(
  handle: DecryptionKeyHandle & { privateKeyBytes?: Uint8Array },
): Promise<openpgp.PrivateKey> {
  const raw = (handle as { privateKeyBytes?: Uint8Array }).privateKeyBytes;
  if (!raw) {
    throw new ScommCryptoError(
      CryptoErrorCodes.PrivateKeyLocked,
      "Decryption key handle does not expose private material",
    );
  }
  const text = new TextDecoder().decode(raw);
  if (text.includes(BEGIN_PGP)) {
    return openpgp.readPrivateKey({ armoredKey: text });
  }
  return openpgp.readPrivateKey({ binaryKey: raw });
}

/** Handle that wraps raw private key bytes for OpenPGP operations. */
export class OpenPgpPrivateKeyHandle implements SigningKeyHandle, DecryptionKeyHandle {
  constructor(
    private readonly metadata: import("@scomm-office/crypto").PublicKeyMetadata,
    readonly privateKeyBytes: Uint8Array,
    private readonly publicKeyBytes: Uint8Array,
  ) {}

  async getPublicMetadata() {
    return this.metadata;
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    const key = await readPrivateKeyFromHandle(this);
    let message: openpgp.Message<string>;
    try {
      message = await openpgp.readMessage({ binaryMessage: ciphertext });
    } catch {
      const text = new TextDecoder().decode(ciphertext);
      message = await openpgp.readMessage({ armoredMessage: text });
    }
    const result = await openpgp.decrypt({ message, decryptionKeys: key, format: "binary" });
    return coerceBytes(result.data as Uint8Array);
  }

  async signDigest(data: Uint8Array): Promise<Uint8Array> {
    const armored = await this.sign(data);
    return new TextEncoder().encode(armored);
  }

  async sign(data: Uint8Array): Promise<string> {
    const key = await readPrivateKeyFromHandle(this);
    const msg = await openpgp.createMessage({ binary: data });
    return openpgp.sign({ message: msg, signingKeys: key, detached: true, format: "armored" });
  }
}

async function readOpenPgpMessage(data: Uint8Array): Promise<openpgp.Message<string>> {
  const text = new TextDecoder().decode(data);
  if (text.includes("BEGIN PGP MESSAGE")) {
    return openpgp.readMessage({ armoredMessage: text });
  }
  return openpgp.readMessage({ binaryMessage: data });
}

function innerMimeBytes(message: LogicalMessage): Uint8Array {
  const mime = logicalMessageToMime(message);
  return mimeToEml(mime);
}

function ensureCrlf(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder("latin1").decode(bytes);
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, CRLF);
  return new TextEncoder().encode(normalized);
}

export class OpenPgpCryptoProvider implements CryptoProvider {
  readonly family = CryptoFamily.OpenPGP;

  async sign(context: CryptoOperationContext): Promise<ProtectedMessage> {
    const handle = context.senderSigningKey as OpenPgpPrivateKeyHandle | undefined;
    if (!handle) {
      throw new ScommCryptoError(CryptoErrorCodes.SigningKeyUnavailable, "Signing key required");
    }
    const entity = ensureCrlf(innerMimeBytes(context.message));
    const signature = await handle.sign(entity);
    const signed = buildMultipartSigned(entity, signature);
    const eml = mimeToEml(signed);
    return { family: CryptoFamily.OpenPGP, mode: "sign", mime: eml, eml };
  }

  async encrypt(context: CryptoOperationContext): Promise<ProtectedMessage> {
    const keys = await this.encryptionKeys(context);
    const payload = ensureCrlf(innerMimeBytes(context.message));
    const encrypted = await this.encryptBytes(payload, keys);
    const wrapped = buildMultipartEncrypted(encrypted);
    const eml = mimeToEml(wrapped);
    return { family: CryptoFamily.OpenPGP, mode: "encrypt", mime: eml, eml };
  }

  async signAndEncrypt(context: CryptoOperationContext): Promise<ProtectedMessage> {
    const signed = await this.sign(context);
    const keys = await this.encryptionKeys(context);
    const encrypted = await this.encryptBytes(signed.mime, keys);
    const wrapped = buildMultipartEncrypted(encrypted);
    const eml = mimeToEml(wrapped);
    return { family: CryptoFamily.OpenPGP, mode: "signAndEncrypt", mime: eml, eml };
  }

  async verify(mime: Uint8Array, publicKeys: PublicKeyMaterial[]): Promise<VerificationState> {
    const text = new TextDecoder("latin1").decode(mime);
    const structure = detectMimeStructure(text);
    if (structure.kind !== "openpgp-signed") {
      return { state: "not-signed" };
    }

    const extracted = extractSignedEntityFromMultipartSigned(mime);
    if (!extracted) {
      return { state: "invalid", reason: "Malformed multipart/signed" };
    }

    try {
      const message = await openpgp.createMessage({ binary: extracted.signedEntity });
      const signature = await openpgp.readSignature({ armoredSignature: extracted.signature });
      const verificationKeys = await Promise.all(publicKeys.map((k) => readPublicKey(k.material)));

      const result = await openpgp.verify({
        message,
        signature,
        verificationKeys,
      });

      const sigResult = result.signatures[0];
      if (!sigResult) {
        return { state: "invalid", signatureValid: false, reason: "No signature result" };
      }
      await sigResult.verified;

      const key = verificationKeys[0];
      const fp = key?.getFingerprint().toLowerCase() ?? "";
      return {
        state: "verified",
        family: CryptoFamily.OpenPGP,
        signer: publicKeys[0]?.identity,
        keyId: formatShortKeyId(fp),
        signatureValid: true,
        identityBindingValid: true,
        trustValid: true,
      };
    } catch (err) {
      return {
        state: "invalid",
        family: CryptoFamily.OpenPGP,
        signatureValid: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async decrypt(
    mime: Uint8Array,
    decryptionKey: DecryptionKeyHandle,
  ): Promise<{ plaintext: Uint8Array; verification?: VerificationState }> {
    const payload = extractEncryptedPayload(mime);
    const handle = decryptionKey as OpenPgpPrivateKeyHandle;
    const plaintext = await handle.decrypt(payload);
    return { plaintext };
  }

  async decryptAndVerify(
    mime: Uint8Array,
    decryptionKey: DecryptionKeyHandle,
    publicKeys: PublicKeyMaterial[],
  ): Promise<{ message: LogicalMessage; verification: VerificationState }> {
    const { plaintext } = await this.decrypt(mime, decryptionKey);
    const innerText = new TextDecoder("latin1").decode(plaintext);
    const verification = await this.verify(plaintext, publicKeys);
    const message = parseInnerLogicalMessage(innerText);
    return { message, verification };
  }

  private async encryptionKeys(context: CryptoOperationContext): Promise<openpgp.Key[]> {
    const materials = [...context.recipientKeys];
    if (context.includeSenderForEncryption && context.senderEncryptionKey) {
      materials.push(context.senderEncryptionKey);
    }
    if (materials.length === 0) {
      throw new ScommCryptoError(
        CryptoErrorCodes.MissingRecipientKey,
        "At least one recipient encryption key required",
      );
    }
    return Promise.all(materials.map((k) => readPublicKey(k.material)));
  }

  private async encryptBytes(data: Uint8Array, keys: openpgp.Key[]): Promise<Uint8Array> {
    const message = await openpgp.createMessage({ binary: data });
    return openpgp.encrypt({ message, encryptionKeys: keys, format: "binary" });
  }
}

function extractEncryptedPayload(mime: Uint8Array): Uint8Array {
  return extractEncryptedPayloadFromMime(mime);
}

function parseInnerLogicalMessage(mimeText: string): LogicalMessage {
  const plainMatch = /Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|$)/i.exec(
    mimeText,
  );
  const htmlMatch = /Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|$)/i.exec(
    mimeText,
  );
  return toLogicalMessage({
    bodyText: plainMatch?.[1]?.trim() ?? "",
    bodyHtml: htmlMatch?.[1],
  });
}

export async function generateOpenPgpKeyPair(email: string): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  fingerprint: string;
  handle: OpenPgpPrivateKeyHandle;
}> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ email }],
    format: "binary",
  });
  const parsed = await openpgp.readKey({ binaryKey: publicKey });
  const fingerprint = parsed.getFingerprint().toLowerCase();
  const metadata = {
    family: CryptoFamily.OpenPGP,
    identity: email,
    fingerprint,
    shortKeyId: formatShortKeyId(fingerprint),
    algorithm: "openpgp-cv25519",
    canSign: true,
    canEncrypt: true,
  };
  const handle = new OpenPgpPrivateKeyHandle(metadata, privateKey, publicKey);
  return { publicKey, privateKey, fingerprint, handle };
}

export function publicKeyMaterialFromBytes(
  email: string,
  material: Uint8Array,
  fingerprint: string,
  purpose: { canSign: boolean; canEncrypt: boolean },
): PublicKeyMaterial {
  return {
    family: CryptoFamily.OpenPGP,
    identity: email,
    material,
    fingerprint,
    shortKeyId: formatShortKeyId(fingerprint),
    algorithm: "openpgp-cv25519",
    canSign: purpose.canSign,
    canEncrypt: purpose.canEncrypt,
  };
}

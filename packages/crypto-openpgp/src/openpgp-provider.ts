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
  type PublicKeyMetadata,
  type SigningKeyHandle,
  type VerificationState,
} from "@scomm-office/crypto";
import { toLogicalMessage, type LogicalMessage } from "@scomm-office/message-core";
import { CRLF, mimeToEml } from "@scomm-office/mime";

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
    private readonly metadata: PublicKeyMetadata,
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

function ensureCrlf(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder("latin1").decode(bytes);
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, CRLF);
  return new TextEncoder().encode(normalized);
}

/**
 * Inline (GpgOL-style) OpenPGP body: a single `text/plain` MIME part whose
 * content is the ASCII-armored block itself — no RFC 3156 `multipart/signed`
 * or `multipart/encrypted` wrapper. Exchange Online's mailbox pipeline (MAPI)
 * has no concept of those multipart structures and flattens each part into a
 * separate file attachment on the way out, so a real OpenPGP client behind a
 * standard Outlook/Graph send path never sees them as multipart in the first
 * place — it sees plain text it can recognize by the `-----BEGIN PGP...`
 * markers, matching secMail10's Outlook composer.
 */
function inlineTextMessage(armored: string) {
  const body = ensureCrlf(new TextEncoder().encode(armored.trim()));
  return mimeToEml({
    headers: {
      "Content-Type": 'text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding": "7bit",
    },
    body,
  });
}

function plainTextOf(message: LogicalMessage): string {
  const text = message.authoredText;
  if (!text || !text.trim()) {
    throw new ScommCryptoError(
      CryptoErrorCodes.UnsupportedMimeStructure,
      "Message has no plain-text body to protect",
    );
  }
  return text;
}

/** Extracts the substring from `beginMarker` through the end of `endMarker`, or null. */
function extractArmoredBlock(text: string, beginMarker: string, endMarker: string): string | null {
  const start = text.indexOf(beginMarker);
  if (start === -1) return null;
  const end = text.indexOf(endMarker, start);
  if (end === -1) return null;
  return text.slice(start, end + endMarker.length);
}

export class OpenPgpCryptoProvider implements CryptoProvider {
  readonly family = CryptoFamily.OpenPGP;

  async sign(context: CryptoOperationContext): Promise<ProtectedMessage> {
    const handle = context.senderSigningKey as OpenPgpPrivateKeyHandle | undefined;
    if (!handle) {
      throw new ScommCryptoError(CryptoErrorCodes.SigningKeyUnavailable, "Signing key required");
    }
    const signingKey = await readPrivateKeyFromHandle(handle);
    const cleartext = await openpgp.createCleartextMessage({ text: plainTextOf(context.message) });
    const armored = await openpgp.sign({ message: cleartext, signingKeys: signingKey, format: "armored" });
    const eml = inlineTextMessage(armored);
    return { family: CryptoFamily.OpenPGP, mode: "sign", mime: eml, eml };
  }

  async encrypt(context: CryptoOperationContext): Promise<ProtectedMessage> {
    const keys = await this.encryptionKeys(context);
    const message = await openpgp.createMessage({ text: plainTextOf(context.message) });
    const armored = await openpgp.encrypt({ message, encryptionKeys: keys, format: "armored" });
    const eml = inlineTextMessage(armored);
    return { family: CryptoFamily.OpenPGP, mode: "encrypt", mime: eml, eml };
  }

  async signAndEncrypt(context: CryptoOperationContext): Promise<ProtectedMessage> {
    const handle = context.senderSigningKey as OpenPgpPrivateKeyHandle | undefined;
    if (!handle) {
      throw new ScommCryptoError(CryptoErrorCodes.SigningKeyUnavailable, "Signing key required");
    }
    const signingKey = await readPrivateKeyFromHandle(handle);
    const keys = await this.encryptionKeys(context);
    const message = await openpgp.createMessage({ text: plainTextOf(context.message) });
    const armored = await openpgp.encrypt({
      message,
      encryptionKeys: keys,
      signingKeys: [signingKey],
      format: "armored",
    });
    const eml = inlineTextMessage(armored);
    return { family: CryptoFamily.OpenPGP, mode: "signAndEncrypt", mime: eml, eml };
  }

  async verify(mime: Uint8Array, publicKeys: PublicKeyMaterial[]): Promise<VerificationState> {
    const text = new TextDecoder("latin1").decode(mime);
    const block = extractArmoredBlock(
      text,
      "-----BEGIN PGP SIGNED MESSAGE-----",
      "-----END PGP SIGNATURE-----",
    );
    if (!block) {
      return { state: "not-signed" };
    }

    try {
      const message = await openpgp.readCleartextMessage({ cleartextMessage: block });
      const verificationKeys = await Promise.all(publicKeys.map((k) => readPublicKey(k.material)));
      const result = await openpgp.verify({ message, verificationKeys });

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
    const armored = extractArmoredBlock(
      new TextDecoder("latin1").decode(mime),
      "-----BEGIN PGP MESSAGE-----",
      "-----END PGP MESSAGE-----",
    );
    if (!armored) {
      throw new ScommCryptoError(CryptoErrorCodes.UnsupportedMimeStructure, "No inline OpenPGP message found");
    }
    const handle = decryptionKey as OpenPgpPrivateKeyHandle;
    const plaintext = await handle.decrypt(new TextEncoder().encode(armored));
    return { plaintext };
  }

  async decryptAndVerify(
    mime: Uint8Array,
    decryptionKey: DecryptionKeyHandle,
    publicKeys: PublicKeyMaterial[],
  ): Promise<{ message: LogicalMessage; verification: VerificationState }> {
    const armored = extractArmoredBlock(
      new TextDecoder("latin1").decode(mime),
      "-----BEGIN PGP MESSAGE-----",
      "-----END PGP MESSAGE-----",
    );
    if (!armored) {
      throw new ScommCryptoError(CryptoErrorCodes.UnsupportedMimeStructure, "No inline OpenPGP message found");
    }
    const handle = decryptionKey as OpenPgpPrivateKeyHandle;
    const privateKey = await readPrivateKeyFromHandle(handle);
    const verificationKeys = await Promise.all(publicKeys.map((k) => readPublicKey(k.material)));
    const message = await openpgp.readMessage({ armoredMessage: armored });
    const result = await openpgp.decrypt({
      message,
      decryptionKeys: privateKey,
      verificationKeys: verificationKeys.length ? verificationKeys : undefined,
      format: "utf8",
    });

    const logicalMessage = toLogicalMessage({ bodyText: result.data as string });
    const sigResult = result.signatures?.[0];
    let verification: VerificationState = { state: "not-signed" };
    if (sigResult) {
      try {
        await sigResult.verified;
        const key = verificationKeys[0];
        const fp = key?.getFingerprint().toLowerCase() ?? "";
        verification = {
          state: "verified",
          family: CryptoFamily.OpenPGP,
          signer: publicKeys[0]?.identity,
          keyId: formatShortKeyId(fp),
          signatureValid: true,
          identityBindingValid: true,
          trustValid: true,
        };
      } catch (err) {
        verification = {
          state: "invalid",
          family: CryptoFamily.OpenPGP,
          signatureValid: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return { message: logicalMessage, verification };
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

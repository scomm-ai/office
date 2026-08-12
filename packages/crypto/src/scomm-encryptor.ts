import type {
  DecryptedMessage,
  EncryptableMessage,
  EncryptedMessage,
  MessageDecryptor,
  MessageEncryptor,
  RecipientKeySet,
} from "./message-crypto.js";

const ENVELOPE_VERSION = 1;
const ALGORITHM_SUITE = "scomm-v1-ecdh-p256-aes256gcm";
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12;

/** Base64url encode without padding. */
function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64url decode (accepts with or without padding). */
function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Ensure a Uint8Array is backed by a standalone ArrayBuffer (satisfies strict TS BufferSource). */
function asBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

interface WrappedRecipient {
  keyId: string;
  identity: string;
  ephemeralPublicKey: string;
  wrappedKey: string;
}

interface ScommEnvelope {
  version: number;
  algorithmSuite: string;
  iv: string;
  ciphertext: string;
  recipients: WrappedRecipient[];
}

/**
 * Import a recipient's public key from base64url-encoded SPKI or raw format.
 * Tries SPKI first, then raw, then JWK.
 */
async function importRecipientPublicKey(
  publicKeyStr: string,
  algorithm: string,
): Promise<CryptoKey> {
  const keyData = fromBase64Url(publicKeyStr);

  // If algorithm hints at EC / P-256 / ECDH, import as ECDH P-256
  const ecAlgorithm = { name: "ECDH", namedCurve: "P-256" };

  // Try SPKI format first (typical for exported public keys)
  try {
    return await crypto.subtle.importKey("spki", asBuffer(keyData), ecAlgorithm, false, []);
  } catch {
    // ignore
  }

  // Try raw format (65 bytes uncompressed P-256 point)
  try {
    return await crypto.subtle.importKey("raw", asBuffer(keyData), ecAlgorithm, false, []);
  } catch {
    // ignore
  }

  // Try JWK if it looks like JSON
  try {
    const jsonStr = textDecoder.decode(keyData);
    const jwk = JSON.parse(jsonStr) as JsonWebKey;
    return await crypto.subtle.importKey("jwk", jwk, ecAlgorithm, false, []);
  } catch {
    // ignore
  }

  throw new Error(
    `Cannot import public key for ${algorithm}. Expected base64url-encoded SPKI, raw EC point, or JWK.`,
  );
}

/**
 * SComm Message Encryptor
 *
 * Encryption flow:
 * 1. Generate a random AES-256-GCM content encryption key (CEK)
 * 2. Encrypt the message payload with the CEK
 * 3. For each recipient: generate an ephemeral ECDH P-256 key pair,
 *    derive a wrapping key via ECDH + HKDF, wrap the CEK
 * 4. Package everything into a SComm envelope
 */
export class ScommMessageEncryptor implements MessageEncryptor {
  async encrypt(
    message: EncryptableMessage,
    recipients: RecipientKeySet[],
  ): Promise<EncryptedMessage> {
    if (recipients.length === 0) {
      throw new Error("At least one recipient is required for encryption.");
    }

    // 1. Serialize the plaintext payload
    const payload = JSON.stringify({
      subject: message.subject,
      body: message.body,
      headers: message.headers,
    });
    const plaintextBytes = textEncoder.encode(payload);

    // 2. Generate a random AES-256-GCM content encryption key
    const cek = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: AES_KEY_LENGTH },
      true, // extractable so we can wrap it for each recipient
      ["encrypt", "decrypt"],
    );

    // 3. Encrypt the payload with the CEK
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBuffer(iv), tagLength: 128 },
      cek,
      asBuffer(plaintextBytes),
    );

    // 4. Export the CEK raw bytes for wrapping
    const cekRaw = await crypto.subtle.exportKey("raw", cek);

    // 5. For each recipient, wrap the CEK using ECDH key agreement
    const wrappedRecipients: WrappedRecipient[] = [];
    for (const recipient of recipients) {
      const wrapped = await this.wrapCekForRecipient(cekRaw, recipient);
      wrappedRecipients.push(wrapped);
    }

    // 6. Build the envelope
    const envelope: ScommEnvelope = {
      version: ENVELOPE_VERSION,
      algorithmSuite: ALGORITHM_SUITE,
      iv: toBase64Url(asBuffer(iv)),
      ciphertext: toBase64Url(ciphertextBuffer),
      recipients: wrappedRecipients,
    };

    return {
      envelopeVersion: ENVELOPE_VERSION,
      ciphertext: JSON.stringify(envelope),
      recipients,
      metadata: { algorithmSuite: ALGORITHM_SUITE },
    };
  }

  private async wrapCekForRecipient(
    cekRaw: ArrayBuffer,
    recipient: RecipientKeySet,
  ): Promise<WrappedRecipient> {
    // Generate ephemeral ECDH key pair
    const ephemeralKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true, // exportable so we can include the public part in the envelope
      ["deriveBits"],
    );

    // Import the recipient's public key
    const recipientPublicKey = await importRecipientPublicKey(
      recipient.publicKey,
      recipient.algorithm,
    );

    // Derive shared secret via ECDH
    const sharedBits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: recipientPublicKey },
      ephemeralKeyPair.privateKey,
      256,
    );

    // Derive wrapping key from shared secret via HKDF
    const sharedSecret = await crypto.subtle.importKey(
      "raw",
      sharedBits,
      "HKDF",
      false,
      ["deriveKey"],
    );

    const info = textEncoder.encode(`scomm-cek-wrap:${recipient.keyId}`);
    const wrappingKey = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(32), info: asBuffer(info) },
      sharedSecret,
      { name: "AES-GCM", length: AES_KEY_LENGTH },
      false,
      ["encrypt"],
    );

    // Wrap (encrypt) the CEK with the derived wrapping key
    const wrapIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const wrappedCek = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBuffer(wrapIv), tagLength: 128 },
      wrappingKey,
      cekRaw,
    );

    // Export the ephemeral public key
    const ephemeralPubRaw = await crypto.subtle.exportKey("raw", ephemeralKeyPair.publicKey);

    // Combine wrapIv + wrappedCek for transport
    const combined = new Uint8Array(wrapIv.length + wrappedCek.byteLength);
    combined.set(wrapIv, 0);
    combined.set(new Uint8Array(wrappedCek), wrapIv.length);

    return {
      keyId: recipient.keyId,
      identity: recipient.identity,
      ephemeralPublicKey: toBase64Url(ephemeralPubRaw),
      wrappedKey: toBase64Url(asBuffer(combined)),
    };
  }
}

/**
 * SComm Message Decryptor
 *
 * Requires a private key lookup function that returns the CryptoKey
 * for a given keyId.
 */
export class ScommMessageDecryptor implements MessageDecryptor {
  constructor(
    private readonly getPrivateKey: (keyId: string) => Promise<CryptoKey | null>,
  ) {}

  async decrypt(message: EncryptedMessage): Promise<DecryptedMessage> {
    // Parse the envelope
    const envelope = JSON.parse(message.ciphertext) as ScommEnvelope;

    if (envelope.version !== ENVELOPE_VERSION) {
      throw new Error(`Unsupported envelope version: ${envelope.version}`);
    }
    if (envelope.algorithmSuite !== ALGORITHM_SUITE) {
      throw new Error(`Unsupported algorithm suite: ${envelope.algorithmSuite}`);
    }

    // Try each recipient entry until we find one we can decrypt
    let cekRaw: ArrayBuffer | null = null;
    for (const recipient of envelope.recipients) {
      const privateKey = await this.getPrivateKey(recipient.keyId);
      if (!privateKey) {
        continue;
      }
      try {
        cekRaw = await this.unwrapCek(recipient, privateKey);
        break;
      } catch {
        // This recipient entry didn't work, try next
        continue;
      }
    }

    if (!cekRaw) {
      throw new Error(
        "Cannot decrypt: no matching private key found for any recipient entry.",
      );
    }

    // Import the CEK
    const cek = await crypto.subtle.importKey(
      "raw",
      cekRaw,
      { name: "AES-GCM", length: AES_KEY_LENGTH },
      false,
      ["decrypt"],
    );

    // Decrypt the ciphertext
    const iv = fromBase64Url(envelope.iv);
    const ciphertext = fromBase64Url(envelope.ciphertext);
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBuffer(iv), tagLength: 128 },
      cek,
      asBuffer(ciphertext),
    );

    const payload = JSON.parse(textDecoder.decode(plaintextBuffer)) as {
      subject?: string;
      body: string;
      headers?: Record<string, string>;
    };

    return {
      subject: payload.subject,
      body: payload.body,
      headers: payload.headers,
    };
  }

  private async unwrapCek(
    recipient: WrappedRecipient,
    privateKey: CryptoKey,
  ): Promise<ArrayBuffer> {
    // Import the ephemeral public key from the envelope
    const ephemeralPubRaw = fromBase64Url(recipient.ephemeralPublicKey);
    const ephemeralPublicKey = await crypto.subtle.importKey(
      "raw",
      asBuffer(ephemeralPubRaw),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );

    // Derive shared secret via ECDH
    const sharedBits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: ephemeralPublicKey },
      privateKey,
      256,
    );

    // Derive wrapping key from shared secret via HKDF
    const sharedSecret = await crypto.subtle.importKey(
      "raw",
      sharedBits,
      "HKDF",
      false,
      ["deriveKey"],
    );

    const info = textEncoder.encode(`scomm-cek-wrap:${recipient.keyId}`);
    const wrappingKey = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(32), info: asBuffer(info) },
      sharedSecret,
      { name: "AES-GCM", length: AES_KEY_LENGTH },
      false,
      ["decrypt"],
    );

    // Split combined blob into wrapIv + wrappedCek
    const combined = fromBase64Url(recipient.wrappedKey);
    const wrapIv = combined.slice(0, IV_LENGTH);
    const wrappedCek = combined.slice(IV_LENGTH);

    // Unwrap (decrypt) the CEK
    return await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBuffer(wrapIv), tagLength: 128 },
      wrappingKey,
      asBuffer(wrappedCek),
    );
  }
}

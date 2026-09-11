import { ERROR_CODES, decodeBase64Url } from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";

/**
 * SubjectPublicKeyInfo prefix Node/WebCrypto uses for a raw X25519 key
 * (OID 1.3.101.110). Matches the pubkey server's SPKI_X25519 constant.
 */
export const SPKI_X25519_PREFIX = Uint8Array.from([
	0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00,
]);

const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;

function concatBytes(...parts) {
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/**
 * Recovers a raw 32-byte X25519 public point from SPKI, OpenPGP MPI, or raw bytes.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function stripX25519Public(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
		throw new PubkeyError(
			ERROR_CODES.invalid_proof_of_possession,
			"Malformed ephemeral public key from server",
		);
	}
	if (bytes.length === 32) {
		return bytes;
	}
	if (
		bytes.length === SPKI_X25519_PREFIX.length + 32 &&
		bytes[0] === SPKI_X25519_PREFIX[0] &&
		bytes[6] === SPKI_X25519_PREFIX[6]
	) {
		return bytes.subarray(SPKI_X25519_PREFIX.length);
	}
	if (bytes.length === 33 && bytes[0] === 0x40) {
		return bytes.subarray(1);
	}
	throw new PubkeyError(
		ERROR_CODES.invalid_proof_of_possession,
		"Malformed ephemeral public key from server",
	);
}

/**
 * Frames AES-GCM output the way the pubkey server does: `iv || tag || ciphertext`.
 *
 * @param {{ iv: Uint8Array, ciphertext: Uint8Array }} box ciphertext includes the 16-byte tag
 * @returns {Uint8Array}
 */
export function frameDecryptChallengeCiphertext(box) {
	const tag = box.ciphertext.subarray(box.ciphertext.length - AES_GCM_TAG_BYTES);
	const encrypted = box.ciphertext.subarray(0, box.ciphertext.length - AES_GCM_TAG_BYTES);
	return concatBytes(box.iv, tag, encrypted);
}

/**
 * Challenge fields may be top-level or nested under `data` (envelope APIs).
 *
 * @param {Record<string, unknown> | null | undefined} body
 * @returns {Record<string, unknown> | null | undefined}
 */
export function unwrapDecryptChallenge(body) {
	if (!body || typeof body !== "object") return body;
	const nested = body.data;
	if (
		nested &&
		typeof nested === "object" &&
		(nested.challenge_id || nested.ciphertext || nested.ephemeral_public)
	) {
		return { ...body, ...nested };
	}
	return body;
}

function decodeMaybeBase64Url(value) {
	return typeof value === "string" ? decodeBase64Url(value) : value;
}

/**
 * Splits the server's `iv(12) || tag(16) || ciphertext` wrap framing and
 * decrypts it with an already-derived AES-256-GCM key.
 *
 * @param {import("./provider.js").CryptoProvider} crypto
 * @param {Uint8Array} aesKey
 * @param {Uint8Array} wrapped
 * @returns {Promise<Uint8Array>}
 */
async function decryptChallengeWrap(crypto, aesKey, wrapped) {
	if (wrapped.length < AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES) {
		throw new PubkeyError(
			ERROR_CODES.invalid_proof_of_possession,
			"Malformed decrypt challenge from server",
		);
	}
	const iv = wrapped.subarray(0, AES_GCM_IV_BYTES);
	const tag = wrapped.subarray(AES_GCM_IV_BYTES, AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES);
	const encrypted = wrapped.subarray(AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES);
	return crypto.decryptAead(aesKey, iv, concatBytes(encrypted, tag));
}

/**
 * Recovers the wrapped nonce from a directory decrypt challenge.
 *
 * Server wrap: ECDH(serverEphemeral, ours) → SHA-256 → AES-256-GCM, framed as
 * `iv(12) || tag(16) || ciphertext`.
 *
 * @param {import("./provider.js").CryptoProvider} crypto
 * @param {import("./provider.js").KeyHandle} contentKey X25519 private handle
 * @param {{ challenge_id?: string, ciphertext?: string, ephemeral_public?: string, data?: object }} challenge
 * @returns {Promise<Uint8Array>}
 */
export async function solveDecryptChallenge(crypto, contentKey, challenge) {
	const unwrapped = unwrapDecryptChallenge(challenge);
	const challengeId = unwrapped?.challenge_id;
	const wrappedRaw = unwrapped?.ciphertext;
	const ephemeralRaw = unwrapped?.ephemeral_public;
	if (!challengeId || !wrappedRaw || !ephemeralRaw) {
		throw new PubkeyError(
			ERROR_CODES.invalid_proof_of_possession,
			"Malformed decrypt challenge from server",
		);
	}
	const wrapped = decodeMaybeBase64Url(wrappedRaw);
	const ephemeralBytes = decodeMaybeBase64Url(ephemeralRaw);
	const ephemeralPublic = stripX25519Public(ephemeralBytes);
	const sharedSecret = await crypto.deriveSecret(contentKey, ephemeralPublic);
	const aesKey = await crypto.hash("sha-256", sharedSecret);
	return decryptChallengeWrap(crypto, aesKey, wrapped);
}

/**
 * Recovers the wrapped nonce from a hybrid PQC (ML-KEM-768+X25519) decrypt
 * challenge — the directory issues this instead of {@link solveDecryptChallenge}
 * when the published encryption artifact is an RFC 9980 composite key.
 *
 * Combiner matches the pubkey server / secMail10's Rust engine exactly (no
 * JS-side spec of its own to derive from): shared key is
 * `SHA-256(mlkemSharedSecret(32) || x25519SharedSecret(32))` — ML-KEM secret
 * first, plain concatenation, no domain-separation label. Same AES-GCM wrap
 * framing as the classical challenge.
 *
 * @param {import("./provider.js").CryptoProvider} crypto
 * @param {import("../engines/pq.js").PqEngine} pqEngine
 * @param {import("./provider.js").KeyHandle} contentKey X25519 private handle (classical half)
 * @param {Uint8Array} mlkemSeed 64-byte ML-KEM-768 seed (d||z, PQC half)
 * @param {{ challenge_id?: string, ciphertext?: string, ephemeral_public?: string, kem_ciphertext?: string, data?: object }} challenge
 * @returns {Promise<Uint8Array>}
 */
export async function solveHybridDecryptChallenge(crypto, pqEngine, contentKey, mlkemSeed, challenge) {
	const unwrapped = unwrapDecryptChallenge(challenge);
	const challengeId = unwrapped?.challenge_id;
	const wrappedRaw = unwrapped?.ciphertext;
	const ephemeralRaw = unwrapped?.ephemeral_public;
	const kemCiphertextRaw = unwrapped?.kem_ciphertext;
	if (!challengeId || !wrappedRaw || !ephemeralRaw || !kemCiphertextRaw) {
		throw new PubkeyError(
			ERROR_CODES.invalid_proof_of_possession,
			"Malformed hybrid decrypt challenge from server",
		);
	}
	const wrapped = decodeMaybeBase64Url(wrappedRaw);
	const ephemeralBytes = decodeMaybeBase64Url(ephemeralRaw);
	const ephemeralPublic = stripX25519Public(ephemeralBytes);
	const kemCiphertext = decodeMaybeBase64Url(kemCiphertextRaw);

	const [mlkemShared, x25519Shared] = await Promise.all([
		pqEngine.decapsulate({ seed: mlkemSeed, ciphertext: kemCiphertext }),
		crypto.deriveSecret(contentKey, ephemeralPublic),
	]);
	const aesKey = await crypto.hash("sha-256", concatBytes(mlkemShared, x25519Shared));
	return decryptChallengeWrap(crypto, aesKey, wrapped);
}

/**
 * Encodes a raw X25519 public point as SubjectPublicKeyInfo (server wire shape).
 *
 * @param {Uint8Array} rawPublic
 * @returns {Uint8Array}
 */
export function encodeX25519Spki(rawPublic) {
	if (!(rawPublic instanceof Uint8Array) || rawPublic.length !== 32) {
		throw new TypeError("X25519 public key must be 32 bytes");
	}
	return concatBytes(SPKI_X25519_PREFIX, rawPublic);
}

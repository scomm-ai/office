import * as openpgp from "openpgp";
import { ERROR_CODES } from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";

// Wire capability names the directory's algorithm registry actually
// recognizes (see secMail10's shared registry.dart, algorithm_id 116/117) —
// NOT the "openpgp-pqc" request-time selector generateKey() accepts below.
// Advertising an unregistered name here breaks discoveryCapabilities(),
// which is sent to the server on every getBestKey() directory lookup.
const ADVERTISED = Object.freeze([
	"openpgp-cv25519",
	"openpgp-ed25519",
	"openpgp-mldsa65-ed25519",
	"openpgp-mlkem768-x25519",
]);
const BEGIN_PGP = "-----BEGIN PGP";

const V4_CV25519 = Object.freeze({
	type: "ecc",
	curve: "curve25519Legacy",
	config: { v6Keys: false },
});

// RFC 9580 v6 key carrying the composite PQC algorithms from
// draft-ietf-openpgp-pqc: ML-DSA-65 + Ed25519 (signing, primary key) and
// ML-KEM-768 + X25519 (encryption subkey). Requires openpgp.js built from a
// commit after the `pqc` feature landed (see package.json) — no released
// version ships this yet.
const V6_PQC = Object.freeze({
	type: "pqc",
	config: { v6Keys: true },
});

function reverseBytes(bytes) {
	const out = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i += 1) {
		out[i] = bytes[bytes.length - 1 - i];
	}
	return out;
}

function coerceBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	if (typeof value === "string") {
		return new TextEncoder().encode(value);
	}
	if (Array.isArray(value)) return new Uint8Array(value);
	throw new PubkeyError(
		ERROR_CODES.key_import_failure,
		"OpenPGP key material must be bytes or an armored string",
	);
}

function looksLikeArmor(bytes) {
	const prefix = new TextDecoder().decode(bytes.subarray(0, 80));
	return prefix.includes(BEGIN_PGP);
}

async function readPublicKey(material) {
	const bytes = coerceBytes(material);
	if (looksLikeArmor(bytes)) {
		return openpgp.readKey({ armoredKey: new TextDecoder().decode(bytes) });
	}
	try {
		return await openpgp.readKey({ binaryKey: bytes });
	} catch (cause) {
		const asText = new TextDecoder().decode(bytes);
		if (asText.includes(BEGIN_PGP)) {
			return openpgp.readKey({ armoredKey: asText });
		}
		throw new PubkeyError(
			ERROR_CODES.invalid_public_key,
			"Could not parse OpenPGP public key (binary packets or armor)",
			{ cause },
		);
	}
}

async function readPrivateKey(material) {
	const bytes = coerceBytes(material);
	if (looksLikeArmor(bytes)) {
		return openpgp.readPrivateKey({
			armoredKey: new TextDecoder().decode(bytes),
		});
	}
	try {
		return await openpgp.readPrivateKey({ binaryKey: bytes });
	} catch (cause) {
		const asText = new TextDecoder().decode(bytes);
		if (asText.includes(BEGIN_PGP)) {
			return openpgp.readPrivateKey({ armoredKey: asText });
		}
		throw new PubkeyError(
			ERROR_CODES.key_import_failure,
			"Could not parse OpenPGP private key (binary packets or armor)",
			{ cause },
		);
	}
}

async function readMessage(ciphertext) {
	const bytes =
		typeof ciphertext === "string"
			? new TextEncoder().encode(ciphertext)
			: coerceBytes(ciphertext);
	if (looksLikeArmor(bytes) || new TextDecoder().decode(bytes).includes("BEGIN PGP MESSAGE")) {
		return openpgp.readMessage({ armoredMessage: new TextDecoder().decode(bytes) });
	}
	try {
		return await openpgp.readMessage({ binaryMessage: bytes });
	} catch (cause) {
		const asText = new TextDecoder().decode(bytes);
		if (asText.includes("BEGIN PGP MESSAGE")) {
			return openpgp.readMessage({ armoredMessage: asText });
		}
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"Could not parse OpenPGP ciphertext",
			{ cause },
		);
	}
}

function toUint8(data) {
	if (data instanceof Uint8Array) return data;
	if (typeof data === "string") return new TextEncoder().encode(data);
	return coerceBytes(data);
}

/**
 * OpenPGP packet engine (RFC 4880 / 9580) above CryptoProvider.
 *
 * Packet I/O, algorithm negotiation, and ASCII armor live here. openpgp.js
 * uses the host WebCrypto API for Ed25519 / X25519 / AES-GCM when present;
 * injecting CryptoProvider into its packet layer would break interoperability
 * with gopenpgp / Flutter `openpgp`. Vault wrapping and MSK signing stay on
 * CryptoProvider. WASM is not used.
 *
 * Keys are v4 Curve25519 (Ed25519 primary + cv25519 encryption subkey) so
 * secMail0 / gopenpgp can encrypt to and decrypt from this engine.
 */
export class PgpEngine {
	constructor(provider) {
		this.provider = provider;
		this.available = typeof openpgp?.generateKey === "function";
		this.advertisedAlgorithms = this.available ? [...ADVERTISED] : [];
	}

	/**
	 * @param {{ name?: string, email: string, algorithm?: string }} request
	 * @returns {Promise<{
	 *   publicKey: Uint8Array,
	 *   privateKey: Uint8Array,
	 *   fingerprint: string,
	 *   algorithm: string
	 * }>}
	 */
	async generateKey(request = {}) {
		this._requireAvailable();
		const email = request.email;
		if (!email) {
			throw new PubkeyError(
				ERROR_CODES.invalid_email,
				"OpenPGP generateKey requires an email user ID",
			);
		}
		const algorithm = request.algorithm ?? "openpgp-cv25519";
		if (algorithm !== "openpgp-cv25519" && algorithm !== "openpgp-ed25519" && algorithm !== "openpgp-pqc") {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				`PgpEngine cannot generate ${algorithm}`,
			);
		}
		const keyOptions = algorithm === "openpgp-pqc" ? V6_PQC : V4_CV25519;
		try {
			const { privateKey, publicKey } = await openpgp.generateKey({
				...keyOptions,
				userIDs: [{ name: request.name || email, email }],
				format: "binary",
			});
			const parsed = await openpgp.readKey({ binaryKey: publicKey });
			return {
				publicKey,
				privateKey,
				fingerprint: parsed.getFingerprint().toLowerCase(),
				algorithm: algorithm === "openpgp-pqc" ? "openpgp-pqc" : "openpgp-cv25519",
			};
		} catch (cause) {
			if (cause instanceof PubkeyError) throw cause;
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"OpenPGP key generation failed",
				{ cause },
			);
		}
	}

	/**
	 * @param {Uint8Array | string} privateKey
	 * @returns {Promise<Uint8Array>} binary public key packets
	 */
	async exportPublicKey(privateKey) {
		this._requireAvailable();
		try {
			const key = await readPrivateKey(privateKey);
			return toUint8(key.toPublic().write());
		} catch (cause) {
			if (cause instanceof PubkeyError) throw cause;
			throw new PubkeyError(
				ERROR_CODES.key_import_failure,
				"Could not export OpenPGP public key",
				{ cause },
			);
		}
	}

	/**
	 * @param {{ plaintext: string, privateKey: Uint8Array | string }} request
	 * @returns {Promise<Uint8Array>} clearsigned armor (UTF-8)
	 */
	async sign(request = {}) {
		this._requireAvailable();
		if (request.plaintext == null || request.privateKey == null) {
			throw new PubkeyError(
				ERROR_CODES.key_not_found,
				"OpenPGP sign requires plaintext and a private key",
			);
		}
		try {
			const signingKeys = await readPrivateKey(request.privateKey);
			if (!signingKeys.isDecrypted()) {
				throw new PubkeyError(
					ERROR_CODES.key_import_failure,
					"OpenPGP private key is passphrase-protected; Vault keys must be stored unencrypted",
				);
			}
			if (request.detached) {
				const binary = await openpgp.createMessage({
					text: String(request.plaintext),
				});
				const armored = await openpgp.sign({
					message: binary,
					signingKeys,
					detached: true,
					format: "armored",
				});
				return toUint8(armored);
			}
			const message = await openpgp.createCleartextMessage({
				text: String(request.plaintext),
			});
			const armored = await openpgp.sign({
				message,
				signingKeys,
				format: "armored",
			});
			return toUint8(armored);
		} catch (cause) {
			if (cause instanceof PubkeyError) throw cause;
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"OpenPGP sign failed",
				{ cause },
			);
		}
	}

	/**
	 * @param {{
	 *   signed?: string | Uint8Array,
	 *   publicKeys?: Array<Uint8Array | string>,
	 * }} request
	 * @returns {Promise<{ valid: boolean, keyId?: string, plaintext?: string, reason?: string }>}
	 */
	async verify(request = {}) {
		this._requireAvailable();
		if (request.signed == null) {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"OpenPGP verify requires signed text",
			);
		}
		const keys = request.publicKeys ?? [];
		if (keys.length === 0) {
			throw new PubkeyError(
				ERROR_CODES.invalid_public_key,
				"OpenPGP verify requires at least one public key",
			);
		}
		try {
			const verificationKeys = await Promise.all(keys.map((key) => readPublicKey(key)));
			const text =
				typeof request.signed === "string"
					? request.signed
					: new TextDecoder().decode(coerceBytes(request.signed));
			if (!text.includes("BEGIN PGP SIGNED MESSAGE")) {
				return {
					valid: false,
					reason: "No OpenPGP signed message",
				};
			}
			const message = await openpgp.readCleartextMessage({
				cleartextMessage: text,
			});
			const result = await openpgp.verify({ message, verificationKeys });
			const sig = result.signatures[0];
			if (!sig) {
				return { valid: false, reason: "No signature result", plaintext: result.data };
			}
			try {
				await sig.verified;
				return {
					valid: true,
					keyId: sig.keyID?.toHex?.() ?? undefined,
					plaintext: result.data,
				};
			} catch (cause) {
				return {
					valid: false,
					keyId: sig.keyID?.toHex?.() ?? undefined,
					plaintext: result.data,
					reason: cause instanceof Error ? cause.message : "Signature mismatch",
				};
			}
		} catch (cause) {
			if (cause instanceof PubkeyError) throw cause;
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"OpenPGP verify failed",
				{ cause },
			);
		}
	}

	/**
	 * @param {{
	 *   plaintext: string | Uint8Array,
	 *   recipientPublicKey?: Uint8Array | string,
	 *   recipientPublicKeys?: Array<Uint8Array | string>,
	 *   signingPrivateKey?: Uint8Array | string,
	 *   algorithm?: string
	 * }} request
	 * @returns {Promise<Uint8Array>} armored PGP MESSAGE bytes (UTF-8)
	 */
	async encrypt(request = {}) {
		this._requireAvailable();
		const keys = [
			...(request.recipientPublicKeys ?? []),
			...(request.recipientPublicKey != null
				? [request.recipientPublicKey]
				: []),
		];
		if (keys.length === 0) {
			throw new PubkeyError(
				ERROR_CODES.invalid_public_key,
				"OpenPGP encrypt requires at least one recipient public key",
			);
		}
		if (request.plaintext == null) {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"OpenPGP encrypt requires plaintext",
			);
		}
		try {
			const encryptionKeys = await Promise.all(keys.map((key) => readPublicKey(key)));
			const message =
				typeof request.plaintext === "string"
					? await openpgp.createMessage({ text: request.plaintext })
					: await openpgp.createMessage({
							binary: coerceBytes(request.plaintext),
						});
			const signingKeys = request.signingPrivateKey
				? [await readPrivateKey(request.signingPrivateKey)]
				: undefined;
			const armored = await openpgp.encrypt({
				message,
				encryptionKeys,
				...(signingKeys ? { signingKeys } : {}),
				format: "armored",
			});
			return toUint8(armored);
		} catch (cause) {
			if (cause instanceof PubkeyError) throw cause;
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"OpenPGP encrypt failed",
				{ cause },
			);
		}
	}

	/**
	 * Extracts the cv25519 encryption-subkey scalar and Montgomery public point
	 * from an OpenPGP secret key. Used to solve directory decrypt challenges.
	 *
	 * openpgp.js exposes the Curve25519 MPI as a big-endian integer; WebCrypto
	 * X25519 wants RFC 7748 native little-endian, so the scalar is reversed.
	 *
	 * @param {Uint8Array | string} privateMaterial
	 * @returns {Promise<{ scalar: Uint8Array, publicKey: Uint8Array }>}
	 */
	/**
	 * Extracts the raw Ed25519 signing seed from the OpenPGP primary key.
	 *
	 * Works for both the legacy v4 eddsaLegacy packet (`privateParams.seed` /
	 * `publicParams.A`) and the native v6 fields used by PQC composite keys
	 * (`privateParams.eccSecretKey` / `publicParams.eccPublicKey` — the
	 * Ed25519 half of ML-DSA-65+Ed25519). The classical component extracted
	 * here is what proves possession to the directory; it's the same either
	 * way, PQC composite keys just carry an additional ML-DSA signature.
	 *
	 * @param {Uint8Array | string} privateMaterial
	 * @returns {Promise<{ seed: Uint8Array, publicKey: Uint8Array | undefined }>}
	 */
	async extractEd25519SigningKey(privateMaterial) {
		this._requireAvailable();
		try {
			const key = await readPrivateKey(privateMaterial);
			if (!key.isDecrypted()) {
				throw new PubkeyError(
					ERROR_CODES.key_import_failure,
					"OpenPGP private key is passphrase-protected; Vault keys must be stored unencrypted",
				);
			}
			const packet = key.keyPacket;
			const seed = packet?.privateParams?.eccSecretKey ?? packet?.privateParams?.seed;
			if (!seed || seed.length < 32) {
				throw new PubkeyError(
					ERROR_CODES.key_import_failure,
					"OpenPGP primary key has no Ed25519 seed",
				);
			}
			const A = packet.publicParams?.eccPublicKey ?? packet.publicParams?.A;
			const publicKey =
				A instanceof Uint8Array && A.length >= 32
					? new Uint8Array(A.subarray(0, 32))
					: undefined;
			return { seed: new Uint8Array(seed.subarray(0, 32)), publicKey };
		} catch (cause) {
			if (cause instanceof PubkeyError) throw cause;
			throw new PubkeyError(
				ERROR_CODES.key_import_failure,
				"Could not extract OpenPGP Ed25519 signing key",
				{ cause },
			);
		}
	}

	async extractX25519EncryptionSubkey(privateMaterial) {
		this._requireAvailable();
		try {
			const key = await readPrivateKey(privateMaterial);
			if (!key.isDecrypted()) {
				throw new PubkeyError(
					ERROR_CODES.key_import_failure,
					"OpenPGP private key is passphrase-protected; Vault keys must be stored unencrypted",
				);
			}
			const enc = await key.getEncryptionKey();
			const packet = enc?.keyPacket;
			// PQC composite subkeys (ML-KEM-768+X25519) store the X25519 half
			// natively as `eccSecretKey`/`eccPublicKey` — already raw 32-byte
			// little-endian, unlike the legacy `d`/`Q` MPI fields below which are
			// big-endian and need byte-reversal plus stripping the 0x40 EC point tag.
			const native = packet?.privateParams?.eccSecretKey;
			const d = native ?? packet?.privateParams?.d;
			if (!d || d.length < 32) {
				throw new PubkeyError(
					ERROR_CODES.key_import_failure,
					"OpenPGP encryption subkey has no X25519 scalar",
				);
			}
			const scalar = native
				? new Uint8Array(d.subarray(0, 32))
				: reverseBytes(d.subarray(0, 32));
			const Q = native ? packet.publicParams?.eccPublicKey : packet.publicParams?.Q;
			let publicKey;
			if (Q instanceof Uint8Array && Q.length >= 32) {
				publicKey = native
					? new Uint8Array(Q.subarray(0, 32))
					: Q[0] === 0x40
						? new Uint8Array(Q.subarray(1, 33))
						: new Uint8Array(Q.subarray(0, 32));
			}
			return { scalar, publicKey };
		} catch (cause) {
			if (cause instanceof PubkeyError) throw cause;
			throw new PubkeyError(
				ERROR_CODES.key_import_failure,
				"Could not extract OpenPGP X25519 encryption subkey",
				{ cause },
			);
		}
	}

	/**
	 * Extracts the 64-byte ML-KEM-768 seed (d||z) from a PQC composite
	 * encryption subkey (ML-KEM-768+X25519), for PqEngine.decapsulate.
	 *
	 * @param {Uint8Array | string} privateMaterial
	 * @returns {Promise<Uint8Array | undefined>} undefined for non-PQC keys
	 */
	async extractMlkemSeed(privateMaterial) {
		this._requireAvailable();
		try {
			const key = await readPrivateKey(privateMaterial);
			if (!key.isDecrypted()) {
				throw new PubkeyError(
					ERROR_CODES.key_import_failure,
					"OpenPGP private key is passphrase-protected; Vault keys must be stored unencrypted",
				);
			}
			const enc = await key.getEncryptionKey();
			const seed = enc?.keyPacket?.privateParams?.mlkemSeed;
			return seed instanceof Uint8Array ? new Uint8Array(seed) : undefined;
		} catch (cause) {
			if (cause instanceof PubkeyError) throw cause;
			throw new PubkeyError(
				ERROR_CODES.key_import_failure,
				"Could not extract OpenPGP ML-KEM-768 seed",
				{ cause },
			);
		}
	}

	/**
	 * @param {{
	 *   ciphertext: string | Uint8Array,
	 *   privateKey: Uint8Array | string,
	 *   algorithm?: string
	 * }} request
	 * @returns {Promise<Uint8Array>}
	 */
	async decrypt(request = {}) {
		this._requireAvailable();
		if (request.ciphertext == null || request.privateKey == null) {
			throw new PubkeyError(
				ERROR_CODES.key_not_found,
				"OpenPGP decrypt requires ciphertext and a private key",
			);
		}
		try {
			const decryptionKeys = await readPrivateKey(request.privateKey);
			if (!decryptionKeys.isDecrypted()) {
				throw new PubkeyError(
					ERROR_CODES.key_import_failure,
					"OpenPGP private key is passphrase-protected; Vault keys must be stored unencrypted",
				);
			}
			const message = await readMessage(request.ciphertext);
			const result = await openpgp.decrypt({
				message,
				decryptionKeys,
				format: "utf8",
			});
			return toUint8(result.data);
		} catch (cause) {
			if (cause instanceof PubkeyError) throw cause;
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"OpenPGP decrypt failed",
				{ cause },
			);
		}
	}

	_requireAvailable() {
		if (!this.available) {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"OpenPGP engine is not available in this host",
			);
		}
	}
}

/** @param {import("../crypto/provider.js").CryptoProvider} [provider] */
export function createPgpEngine(provider) {
	return new PgpEngine(provider);
}

/**
 * Selects which of several candidate OpenPGP private keys actually match the
 * ciphertext's recipient key ID(s), instead of blind trial-and-error.
 *
 * Reads the message's PKESK key IDs and each candidate's full key set
 * (primary + subkeys, as openpgp.js already correctly distinguishes them)
 * via `PrivateKey.getKeys()`, and returns only the candidates whose primary
 * key or an encryption subkey ID appears in the ciphertext. Never inspects
 * or mutates raw packet bytes — comparison is done entirely through
 * openpgp.js's parsed key/message objects.
 *
 * @param {Uint8Array | string} ciphertext
 * @param {Array<Uint8Array | string>} candidatePrivateKeys
 * @returns {Promise<Array<Uint8Array | string>>} the subset of
 *   candidatePrivateKeys (same references) whose key ID matches the message
 */
export async function matchDecryptionKeys(ciphertext, candidatePrivateKeys) {
	const message = await readMessage(ciphertext);
	const wantedIds = new Set(message.getEncryptionKeyIDs().map((id) => id.toHex()));
	if (wantedIds.size === 0) return [];
	const matches = [];
	for (const candidate of candidatePrivateKeys) {
		try {
			const key = await readPrivateKey(candidate);
			if (key.getKeys().some((k) => wantedIds.has(k.getKeyID().toHex()))) {
				matches.push(candidate);
			}
		} catch {
			// Unreadable candidate — not a match, keep checking the rest.
		}
	}
	return matches;
}

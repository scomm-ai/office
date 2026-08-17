import {
	CRYPTO_OPERATIONS,
	ERROR_CODES,
	KEY_PROTECTION,
	MSK_ALGORITHM,
	PURPOSES,
} from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";

/**
 * @typedef {object} CryptoCapabilities
 * @property {string} id
 * @property {"platform" | "fallback"} kind
 * @property {string[]} sign
 * @property {string[]} verify
 * @property {string[]} keyAgreement
 * @property {string[]} aead
 * @property {string[]} hash
 * @property {string[]} kem
 * @property {string[]} protections
 * @property {boolean[]} extractable
 * @property {boolean} random
 */

/**
 * Provider-managed key handle. Private-key bytes stay inside the provider
 * unless the key is extractable and export is requested.
 *
 * @typedef {object} KeyHandle
 * @property {string} id
 * @property {string} provider
 * @property {string} algorithm
 * @property {string} [purpose]
 * @property {boolean} extractable
 * @property {string} protection
 * @property {Uint8Array} [publicKey]
 */

/** @typedef {KeyHandle} KeyRef */

/**
 * @typedef {object} PortablePrivateKey
 * @property {string} algorithm
 * @property {string} encoding
 * @property {Uint8Array} bytes
 * @property {string} [purpose]
 * @property {Uint8Array} [publicKey]
 * @property {boolean} [extractable]
 */

/**
 * @typedef {object} KeyGenerateRequest
 * @property {string} algorithm
 * @property {string} [purpose]
 * @property {boolean} [extractable]
 * @property {string} [protection]
 */

/**
 * Cryptographic abstraction. Implementations must not know HTTP, OTP, or Office.js.
 * Algorithm names are protocol identifiers; `id` is an implementation choice.
 */
export class CryptoProvider {
	get id() {
		return "abstract";
	}

	/** @returns {"platform" | "fallback"} */
	get kind() {
		return "fallback";
	}

	/** @returns {Promise<CryptoCapabilities>} */
	async capabilities() {
		throw new Error("not implemented");
	}

	/**
	 * @param {string} _operation
	 * @param {string} _algorithm
	 * @param {{ extractable?: boolean, protection?: string, purpose?: string }} [_properties]
	 */
	async supports(_operation, _algorithm, _properties = {}) {
		return false;
	}

	/** @param {number} _length */
	random(_length) {
		throw new Error("not implemented");
	}

	/**
	 * @param {string} _algorithm
	 * @param {Uint8Array} _data
	 */
	async hash(_algorithm, _data) {
		throw new Error("not implemented");
	}

	/**
	 * @param {KeyGenerateRequest} _request
	 * @returns {Promise<KeyHandle>}
	 */
	async generateKey(_request) {
		throw new Error("not implemented");
	}

	/** @returns {Promise<KeyHandle>} */
	async generateSigningKey(algorithm = MSK_ALGORITHM, options = {}) {
		return this.generateKey({
			algorithm,
			purpose: options.purpose ?? PURPOSES.masterSigning,
			extractable: options.extractable ?? true,
			protection: options.protection ?? KEY_PROTECTION.software,
		});
	}

	/** @returns {Promise<KeyHandle>} */
	async generateEncryptionKey(algorithm, options = {}) {
		return this.generateKey({
			algorithm,
			purpose: options.purpose ?? PURPOSES.encryption,
			extractable: options.extractable ?? true,
			protection: options.protection ?? KEY_PROTECTION.software,
		});
	}

	/**
	 * @param {KeyHandle} _key
	 * @param {Uint8Array} _payload
	 */
	async sign(_key, _payload) {
		throw new Error("not implemented");
	}

	/**
	 * @param {Uint8Array} _publicKey
	 * @param {Uint8Array} _payload
	 * @param {Uint8Array} _signature
	 * @param {string} [_algorithm]
	 */
	async verify(_publicKey, _payload, _signature, _algorithm) {
		throw new Error("not implemented");
	}

	async encrypt() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"encrypt is not available on this provider",
		);
	}

	async decrypt() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"decrypt is not available on this provider",
		);
	}

	/**
	 * @param {KeyHandle} _privateKey
	 * @param {Uint8Array} _peerPublicKey
	 */
	async deriveSecret(_privateKey, _peerPublicKey) {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"deriveSecret is not available on this provider",
		);
	}

	/** @returns {Promise<KeyHandle>} */
	async importKey(portable, options = {}) {
		return this.importPrivateKey(portable, options);
	}

	/** @returns {Promise<KeyHandle>} */
	async importPrivateKey(_portable, _options) {
		throw new Error("not implemented");
	}

	/** @returns {Promise<PortablePrivateKey>} */
	async exportKey(key) {
		return this.exportPrivateKey(key);
	}

	/** @returns {Promise<PortablePrivateKey>} */
	async exportPrivateKey(_key) {
		throw new Error("not implemented");
	}

	async wrapKey() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"wrapKey is not available on this provider",
		);
	}

	async unwrapKey() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"unwrapKey is not available on this provider",
		);
	}

	async deriveBits(_algorithm, _params) {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"deriveBits is not available on this provider",
		);
	}

	async generateDeviceKey(options = {}) {
		const extractable = options.extractable ?? false;
		const requested = options.protection;
		let protection = requested ?? KEY_PROTECTION.osProtected;
		if (
			requested == null &&
			!(await this.supports(CRYPTO_OPERATIONS.generateKey, "ed25519", {
				extractable,
				protection,
				purpose: PURPOSES.authentication,
			}))
		) {
			protection = KEY_PROTECTION.software;
		}
		return this.generateSigningKey("ed25519", {
			purpose: PURPOSES.authentication,
			extractable,
			protection,
		});
	}

	async generateMSK(options = {}) {
		return this.generateSigningKey(MSK_ALGORITHM, {
			purpose: PURPOSES.masterSigning,
			extractable: options.extractable ?? true,
			protection: options.protection ?? KEY_PROTECTION.software,
		});
	}

	async signWithMSK(key, payload) {
		return this.sign(key, payload);
	}

	async verifyMSKSignature(publicKey, payload, signature) {
		return this.verify(publicKey, payload, signature, MSK_ALGORITHM);
	}

	async hkdfSha256(_ikm, _info, _length = 32, _salt) {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"hkdfSha256 is not available on this provider",
		);
	}

	async encryptAead(_keyBytes, _plaintext) {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"encryptAead is not available on this provider",
		);
	}

	async decryptAead(_keyBytes, _iv, _ciphertext) {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"decryptAead is not available on this provider",
		);
	}
}

export { CRYPTO_OPERATIONS, KEY_PROTECTION };

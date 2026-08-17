import { ERROR_CODES } from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";

/**
 * S/MIME is CMS + X.509 above CryptoProvider. Parsing may use a dedicated
 * library; primitive ECDH / AES-GCM / Ed25519 should use the provider.
 * OpenSSL's API is not the SComm S/MIME API.
 *
 * JS hosts (Outlook add-in) must not wire this engine. It stays fail-closed
 * and will not be implemented for Outlook. Flutter uses secmail_crypto_sdk.
 */
export class SmimeEngine {
	constructor(provider) {
		this.provider = provider;
		this.available = false;
		this.advertisedAlgorithms = [];
	}

	async sign() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"S/MIME CMS engine is not implemented; X.509/CMS I/O is deferred",
		);
	}

	async verify() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"S/MIME CMS engine is not implemented; X.509/CMS I/O is deferred",
		);
	}

	async encrypt() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"S/MIME CMS engine is not implemented; X.509/CMS I/O is deferred",
		);
	}

	async decrypt() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"S/MIME CMS engine is not implemented; X.509/CMS I/O is deferred",
		);
	}
}

import { ERROR_CODES } from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";

/**
 * PQ support is capability-driven. Prefer a native/WebCrypto provider when
 * it reports ML-KEM / ML-DSA; otherwise an explicit fallback. Never assume
 * Rust is the permanent PQ implementation.
 */
export class PqEngine {
	constructor(provider) {
		this.provider = provider;
	}

	async encapsulate() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"PQ KEM is not available from this provider",
		);
	}

	async decapsulate() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"PQ KEM is not available from this provider",
		);
	}

	async sign() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"PQ signatures are not available from this provider",
		);
	}

	async verify() {
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			"PQ signatures are not available from this provider",
		);
	}
}

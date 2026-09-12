import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { ERROR_CODES } from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";

const MLKEM768_SEED_BYTES = 64;
const MLKEM768_CIPHERTEXT_BYTES = 1088;

/**
 * PQ support is capability-driven. Prefer a native/WebCrypto provider when
 * it reports ML-KEM / ML-DSA; otherwise an explicit fallback. Never assume
 * Rust is the permanent PQ implementation.
 *
 * ML-KEM-768 decapsulate() is implemented directly with @noble/post-quantum
 * (FIPS 203) rather than deferring to `provider`, since no WebCrypto
 * implementation is reliably available across the hosts this add-in runs in
 * yet. `seed` is the 64-byte (d||z) ML-KEM seed OpenPGP PQC composite keys
 * carry (openpgp.js's `mlkemSeed` packet field) — the same format Sequoia's
 * `DecapsulationKey::from_seed` derives the secret key from server-side, so
 * this interoperates with the pubkey directory's existing hybrid PoP
 * challenge (see PgpEngine and encryption-pop.js's solveHybridDecryptChallenge).
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

	/**
	 * @param {{ seed: Uint8Array, ciphertext: Uint8Array }} request
	 * @returns {Promise<Uint8Array>} 32-byte ML-KEM-768 shared secret
	 */
	async decapsulate(request = {}) {
		const { seed, ciphertext } = request;
		if (!(seed instanceof Uint8Array) || seed.length !== MLKEM768_SEED_BYTES) {
			throw new PubkeyError(
				ERROR_CODES.key_import_failure,
				`ML-KEM-768 decapsulate requires a ${MLKEM768_SEED_BYTES}-byte seed`,
			);
		}
		if (!(ciphertext instanceof Uint8Array) || ciphertext.length !== MLKEM768_CIPHERTEXT_BYTES) {
			throw new PubkeyError(
				ERROR_CODES.invalid_proof_of_possession,
				`ML-KEM-768 ciphertext must be ${MLKEM768_CIPHERTEXT_BYTES} bytes`,
			);
		}
		try {
			const { secretKey } = ml_kem768.keygen(seed);
			return ml_kem768.decapsulate(ciphertext, secretKey);
		} catch (cause) {
			throw new PubkeyError(
				ERROR_CODES.invalid_proof_of_possession,
				"ML-KEM-768 decapsulation failed",
				{ cause },
			);
		}
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

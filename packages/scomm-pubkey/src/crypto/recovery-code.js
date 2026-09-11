import { decodeBase64Url, encodeBase64Url } from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";

// CKVF spec §9b "recovery via recovery code". Wire-compatible with
// secMail10's `RecoveryCode` (packages/scomm_pubkey/lib/src/vault/recovery_code.dart)
// and `ExportEnvelope` (.../vault/vault_export.dart): the server never sees
// the recovery code or the unwrapped VEK/AEK ("VRK"/"AEK" in this codebase's
// naming — same concept) — it only stores/relays the wrapped envelope.
// The server persists exactly one `kdf`/`kdf_params`/`salt` per principal
// (see recoveryEnvelopeRepository), shared by both vek_envelope and
// aek_envelope, so callers derive one REK and wrap both secrets under it.

const RECOVERY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_CODE_LENGTH_BYTES = 20;
const RECOVERY_CODE_LENGTH = 32;

export const RECOVERY_SALT_BYTES = 16;

/** OWASP Argon2id minimums for a device-class (not server-class) KDF. */
export const RECOVERY_ARGON2ID_DEFAULTS = Object.freeze({
	memory: 19456,
	iterations: 3,
	parallelism: 1,
	length: 32,
});

function utf8(value) {
	return new TextEncoder().encode(value);
}

/**
 * 20 bytes of CSPRNG (160 bits) as a 32-character Crockford base32 string —
 * same alphabet as `generatePairingSessionCode`, just longer. No embedded
 * checksum: a wrong/mistyped code is caught by the AEAD auth tag failing on
 * unwrap, not by a format check.
 */
export function generateRecoveryCode(crypto) {
	const bytes = crypto.random(RECOVERY_CODE_LENGTH_BYTES);
	let bitBuffer = 0;
	let bitsInBuffer = 0;
	let byteIndex = 0;
	let out = "";
	while (out.length < RECOVERY_CODE_LENGTH) {
		if (bitsInBuffer < 5) {
			bitBuffer = (bitBuffer << 8) | bytes[byteIndex++];
			bitsInBuffer += 8;
		}
		const shift = bitsInBuffer - 5;
		const index = (bitBuffer >> shift) & 0x1f;
		out += RECOVERY_CODE_ALPHABET[index];
		bitsInBuffer -= 5;
	}
	return out;
}

/** Strips whitespace/dashes a user might type when copying the code back in, and uppercases. */
export function normalizeRecoveryCode(code) {
	return String(code ?? "")
		.replace(/[\s-]+/g, "")
		.toUpperCase();
}

/** `REK = Argon2id(recoveryCode, salt)`. Deliberately slow — call once and reuse across vek/aek. */
export async function deriveRecoveryKey(crypto, recoveryCode, salt, params = RECOVERY_ARGON2ID_DEFAULTS) {
	return crypto.deriveArgon2id(utf8(normalizeRecoveryCode(recoveryCode)), salt, params);
}

/** `{kdf, kdf_params, salt, iv, ciphertext}` — the exact wire shape the server stores/returns. */
export async function wrapWithRecoveryKey(crypto, rek, secret, { salt, params = RECOVERY_ARGON2ID_DEFAULTS }) {
	const wrapped = await crypto.encryptAead(rek, secret);
	return {
		kdf: "argon2id",
		kdf_params: {
			memory: params.memory,
			iterations: params.iterations,
			parallelism: params.parallelism,
		},
		salt: encodeBase64Url(salt),
		iv: encodeBase64Url(wrapped.iv),
		ciphertext: encodeBase64Url(wrapped.ciphertext),
	};
}

/** Inverse of `wrapWithRecoveryKey`. Throws on tampering or a wrong REK — no weaker fallback. */
export async function unwrapWithRecoveryKey(crypto, rek, envelope) {
	try {
		return await crypto.decryptAead(
			rek,
			decodeBase64Url(envelope.iv),
			decodeBase64Url(envelope.ciphertext),
		);
	} catch {
		throw new PubkeyError(
			"envelope_authentication_failure",
			"Failed to unwrap recovery envelope: wrong recovery code or tampering",
		);
	}
}

/** Argon2id params to re-derive REK from a fetched envelope, falling back to our own defaults for any field the server didn't echo back. */
export function recoveryParamsFromEnvelope(envelope) {
	const kdfParams = envelope?.kdf_params ?? {};
	return {
		memory: kdfParams.memory ?? RECOVERY_ARGON2ID_DEFAULTS.memory,
		iterations: kdfParams.iterations ?? RECOVERY_ARGON2ID_DEFAULTS.iterations,
		parallelism: kdfParams.parallelism ?? RECOVERY_ARGON2ID_DEFAULTS.parallelism,
		length: RECOVERY_ARGON2ID_DEFAULTS.length,
	};
}

/** Re-derives REK from a fetched envelope's own salt/kdf_params + the user-entered code. */
export async function deriveRecoveryKeyFromEnvelope(crypto, recoveryCode, envelope) {
	if (envelope?.kdf !== "argon2id") {
		throw new PubkeyError(
			"unsupported_algorithm",
			`Unsupported recovery envelope kdf: ${envelope?.kdf}`,
		);
	}
	const salt = decodeBase64Url(envelope.salt);
	return deriveRecoveryKey(crypto, recoveryCode, salt, recoveryParamsFromEnvelope(envelope));
}

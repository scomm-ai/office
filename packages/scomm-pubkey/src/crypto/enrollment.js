import {
	DEVICE_KEY_ALGORITHM,
	ENROLLMENT_HKDF_INFO,
	ENROLLMENT_KEM,
	ENROLLMENT_KEM_FALLBACK,
	MSK_WRAP_INFO,
	VRK_WRAP_INFO,
	PAIRING_TEK_HKDF_INFO,
	PAIRING_SESSION_CODE_LENGTH,
	canonicalizeEnrollmentQr,
	canonicalizeJson,
	decodeBase64Url,
	defaultEnrollmentExpiry,
	deviceAuthorizationPayload,
	encodeBase64Url,
	enrollmentQrPayload,
	sha256Bytes,
	sha256ToUuidV8,
} from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";

function utf8(value) {
	return new TextEncoder().encode(value);
}

export async function generateDeviceKey(crypto, options) {
	return crypto.generateDeviceKey(options);
}

export async function generateMSK(crypto, options) {
	return crypto.generateMSK(options);
}

export async function generateEnrollmentEphemeral(crypto) {
	try {
		return await crypto.generateKey({
			algorithm: ENROLLMENT_KEM,
			purpose: "key-agreement",
			extractable: false,
		});
	} catch {
		return crypto.generateKey({
			algorithm: ENROLLMENT_KEM_FALLBACK,
			purpose: "key-agreement",
			extractable: false,
		});
	}
}

export async function enrollmentCommitment(crypto, qrFields) {
	const canonical = canonicalizeEnrollmentQr(qrFields);
	const digest = await crypto.hash("sha-256", utf8(canonical));
	return encodeBase64Url(digest);
}

export async function buildEnrollmentQr(crypto, {
	sessionId,
	deviceId,
	devicePublicKey,
	ephemeral,
	rendezvous,
	expiry = defaultEnrollmentExpiry(),
}) {
	const draft = enrollmentQrPayload({
		sessionId,
		deviceId,
		devicePublicKey: encodeBase64Url(devicePublicKey),
		ephemeralPublicKey: encodeBase64Url(ephemeral.publicKey),
		kem: ephemeral.algorithm,
		expiry,
		commitment: "pending",
		rendezvous,
	});
	const commitment = await enrollmentCommitment(crypto, {
		...draft,
		commitment: "",
	});
	return { ...draft, commitment };
}

export async function deriveEnrollmentSessionKeys(crypto, {
	localEphemeral,
	peerEphemeralPublic,
	transcript,
}) {
	const shared = await crypto.deriveSecret(localEphemeral, peerEphemeralPublic);
	const transcriptHash = await crypto.hash("sha-256", utf8(transcript));
	const key = await crypto.hkdfSha256(
		shared,
		utf8(ENROLLMENT_HKDF_INFO),
		32,
		transcriptHash,
	);
	return key;
}

export async function encryptEnrollmentPayload(crypto, sessionKey, payload) {
	const { iv, ciphertext } = await crypto.encryptAead(
		sessionKey,
		utf8(JSON.stringify(payload)),
	);
	return {
		iv: encodeBase64Url(iv),
		ciphertext: encodeBase64Url(ciphertext),
	};
}

export async function decryptEnrollmentPayload(crypto, sessionKey, box) {
	const plaintext = await crypto.decryptAead(
		sessionKey,
		decodeBase64Url(box.iv),
		decodeBase64Url(box.ciphertext),
	);
	return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function wrapKeyForDevice(crypto, {
	cek,
	deviceWrapPublicKey,
	info,
}) {
	const eph = await generateEnrollmentEphemeral(crypto);
	const shared = await crypto.deriveSecret(eph, deviceWrapPublicKey);
	const wrapKey = await crypto.hkdfSha256(shared, utf8(info), 32);
	const { iv, ciphertext } = await crypto.encryptAead(wrapKey, cek);
	return {
		algorithm: eph.algorithm,
		ephemeral_public_key: encodeBase64Url(eph.publicKey),
		iv: encodeBase64Url(iv),
		ciphertext: encodeBase64Url(ciphertext),
	};
}

export async function unwrapKeyForDevice(crypto, {
	wrap,
	deviceWrapPrivate,
	info,
}) {
	const shared = await crypto.deriveSecret(
		deviceWrapPrivate,
		decodeBase64Url(wrap.ephemeral_public_key),
	);
	const wrapKey = await crypto.hkdfSha256(shared, utf8(info), 32);
	return crypto.decryptAead(
		wrapKey,
		decodeBase64Url(wrap.iv),
		decodeBase64Url(wrap.ciphertext),
	);
}

export async function wrapMSKForDevice(crypto, cek, deviceWrapPublicKey) {
	return wrapKeyForDevice(crypto, {
		cek,
		deviceWrapPublicKey,
		info: MSK_WRAP_INFO,
	});
}

export async function unwrapMSKForDevice(crypto, wrap, deviceWrapPrivate) {
	return unwrapKeyForDevice(crypto, {
		wrap,
		deviceWrapPrivate,
		info: MSK_WRAP_INFO,
	});
}

export async function wrapVrkForDevice(crypto, vrk, deviceWrapPublicKey) {
	return wrapKeyForDevice(crypto, {
		cek: vrk,
		deviceWrapPublicKey,
		info: VRK_WRAP_INFO,
	});
}

export async function unwrapVrkForDevice(crypto, wrap, deviceWrapPrivate) {
	return unwrapKeyForDevice(crypto, {
		wrap,
		deviceWrapPrivate,
		info: VRK_WRAP_INFO,
	});
}

// CKVF device pairing (`/v1/pairing/*`). Wire-compatible with secMail10's
// `DevicePairing` (packages/scomm_pubkey/lib/src/vault/device_pairing.dart):
// a single ephemeral X25519 key pair per session (exchanged once via the
// pairing session's b_ephemeral_public_key / a_ephemeral_public_key fields,
// not per wrapped key), one HKDF-derived TEK, then AES-GCM wrapping VRK
// (and AEK, when the session grants "full" tier). Unlike wrapKeyForDevice
// above, the wrap itself carries no embedded ephemeral key or algorithm tag
// — the server's pairing endpoints only ever store/relay {iv, ciphertext}.

const PAIRING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Generates an 8-character Crockford base32 pairing code (~40 bits of CSPRNG), matching secMail10's `DevicePairing.generateSessionCode`. */
export function generatePairingSessionCode(crypto) {
	const bytes = crypto.random(5);
	let bitBuffer = 0;
	let bitsInBuffer = 0;
	let byteIndex = 0;
	let out = "";
	while (out.length < PAIRING_SESSION_CODE_LENGTH) {
		if (bitsInBuffer < 5) {
			bitBuffer = (bitBuffer << 8) | bytes[byteIndex++];
			bitsInBuffer += 8;
		}
		const shift = bitsInBuffer - 5;
		const index = (bitBuffer >> shift) & 0x1f;
		out += PAIRING_CODE_ALPHABET[index];
		bitsInBuffer -= 5;
	}
	return out;
}

export async function generatePairingEphemeral(crypto) {
	return generateEnrollmentEphemeral(crypto);
}

/** `shared_secret = ECDH(local_private, peer_public)`, `TEK = HKDF(shared_secret)`. */
export async function derivePairingTek(crypto, localEphemeral, peerEphemeralPublicKey) {
	const shared = await crypto.deriveSecret(localEphemeral, peerEphemeralPublicKey);
	return crypto.hkdfSha256(shared, utf8(PAIRING_TEK_HKDF_INFO), 32);
}

/** `vek_envelope = AEAD_Encrypt(TEK, vrk)`, and `aek_envelope` only when granting full tier. */
export async function wrapPairingTransfer(crypto, tek, vrk, aek) {
	const wrappedVrk = await crypto.encryptAead(tek, vrk);
	const vekEnvelope = {
		iv: encodeBase64Url(wrappedVrk.iv),
		ciphertext: encodeBase64Url(wrappedVrk.ciphertext),
	};
	let aekEnvelope;
	if (aek) {
		const wrappedAek = await crypto.encryptAead(tek, aek);
		aekEnvelope = {
			iv: encodeBase64Url(wrappedAek.iv),
			ciphertext: encodeBase64Url(wrappedAek.ciphertext),
		};
	}
	return { vekEnvelope, aekEnvelope };
}

/** Inverse of wrapPairingTransfer. Throws on tampering or a mismatched TEK — no weaker fallback. */
export async function unwrapPairingTransfer(crypto, tek, vekEnvelope, aekEnvelope) {
	let vrk;
	try {
		vrk = await crypto.decryptAead(
			tek,
			decodeBase64Url(vekEnvelope.iv),
			decodeBase64Url(vekEnvelope.ciphertext),
		);
	} catch {
		throw new PubkeyError(
			"envelope_authentication_failure",
			"Failed to unwrap pairing transfer envelope (VEK): wrong TEK or tampering",
		);
	}
	let aek;
	if (aekEnvelope) {
		try {
			aek = await crypto.decryptAead(
				tek,
				decodeBase64Url(aekEnvelope.iv),
				decodeBase64Url(aekEnvelope.ciphertext),
			);
		} catch {
			throw new PubkeyError(
				"envelope_authentication_failure",
				"Failed to unwrap pairing transfer envelope (AEK): wrong TEK or tampering",
			);
		}
	}
	return { vrk, aek };
}

export const VAULT_RECORD_IV_BYTES = 12;

export function packVaultRecordBox(box) {
	const iv = typeof box.iv === "string" ? decodeBase64Url(box.iv) : box.iv;
	const ciphertext =
		typeof box.ciphertext === "string"
			? decodeBase64Url(box.ciphertext)
			: box.ciphertext;
	const packed = new Uint8Array(iv.length + ciphertext.length);
	packed.set(iv, 0);
	packed.set(ciphertext, iv.length);
	return packed;
}

export function unpackVaultRecordBox(packed) {
	const bytes = packed instanceof Uint8Array ? packed : decodeBase64Url(packed);
	if (bytes.length <= VAULT_RECORD_IV_BYTES) {
		throw new PubkeyError("vault_corrupt", "Vault record ciphertext is too short");
	}
	return {
		iv: bytes.slice(0, VAULT_RECORD_IV_BYTES),
		ciphertext: bytes.slice(VAULT_RECORD_IV_BYTES),
	};
}

export async function encryptVaultRecord(crypto, vrk, record) {
	const { iv, ciphertext } = await crypto.encryptAead(
		vrk,
		utf8(JSON.stringify(record)),
	);
	return { iv: encodeBase64Url(iv), ciphertext: encodeBase64Url(ciphertext) };
}

export async function decryptVaultRecord(crypto, vrk, box) {
	const plaintext = await crypto.decryptAead(
		vrk,
		typeof box.iv === "string" ? decodeBase64Url(box.iv) : box.iv,
		typeof box.ciphertext === "string"
			? decodeBase64Url(box.ciphertext)
			: box.ciphertext,
	);
	return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function encodeVaultRecord(crypto, vrk, entry) {
	const fingerprint = entry.fingerprint || String(entry.key_id || "");
	const recordId = sha256ToUuidV8(await sha256Bytes(fingerprint));
	const payload = {
		...entry,
		private_material:
			entry.private_material instanceof Uint8Array
				? encodeBase64Url(entry.private_material)
				: entry.private_material,
	};
	const box = await encryptVaultRecord(crypto, vrk, payload);
	return {
		record_id: recordId,
		ciphertext: encodeBase64Url(packVaultRecordBox(box)),
	};
}

export async function decodeVaultRecord(crypto, vrk, record) {
	const box = unpackVaultRecordBox(record.ciphertext);
	const entry = await decryptVaultRecord(crypto, vrk, box);
	if (typeof entry.private_material === "string") {
		entry.private_material = decodeBase64Url(entry.private_material);
	}
	return entry;
}

export function authorizationBytes(authorization) {
	return utf8(canonicalizeJson(deviceAuthorizationPayload(authorization)));
}

export { DEVICE_KEY_ALGORITHM };

export function requireNoOtpEnrollment() {
	throw new PubkeyError(
		"otp_not_device_enrollment",
		"OTP cannot enroll a device",
	);
}

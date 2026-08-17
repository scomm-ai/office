import {
	ENROLLMENT_KEM,
	ENROLLMENT_QR_VERSION,
	ENROLLMENT_TTL_MS,
} from "./constants.js";
import { ERROR_CODES } from "./errors.js";
import { canonicalizeJson } from "./jcs.js";

/**
 * INVARIANT 2: Normal device enrollment never rotates the MSK.
 * INVARIANT 3: OTP is not a device-enrollment mechanism.
 */
export function enrollmentQrPayload({
	version = ENROLLMENT_QR_VERSION,
	sessionId,
	devicePublicKey,
	ephemeralPublicKey,
	kem = ENROLLMENT_KEM,
	expiry,
	commitment,
	rendezvous,
}) {
	if (version !== ENROLLMENT_QR_VERSION) {
		const err = new Error("Unsupported enrollment QR version");
		err.code = ERROR_CODES.unsupported_structure_version;
		throw err;
	}
	return {
		version,
		session_id: sessionId,
		device_public_key: devicePublicKey,
		ephemeral_public_key: ephemeralPublicKey,
		kem,
		expiry,
		commitment,
		rendezvous: rendezvous ?? {},
	};
}

export function canonicalizeEnrollmentQr(payload) {
	if (payload?.session_id && payload?.device_public_key) {
		return canonicalizeJson(enrollmentQrPayload({
			version: payload.version,
			sessionId: payload.session_id,
			devicePublicKey: payload.device_public_key,
			ephemeralPublicKey: payload.ephemeral_public_key,
			kem: payload.kem,
			expiry: payload.expiry,
			commitment: payload.commitment,
			rendezvous: payload.rendezvous,
		}));
	}
	return canonicalizeJson(enrollmentQrPayload(payload));
}

export function defaultEnrollmentExpiry(now = Date.now()) {
	return now + ENROLLMENT_TTL_MS;
}

export function assertEnrollmentNotExpired(expiry, now = Date.now()) {
	if (!Number.isFinite(expiry) || expiry <= now) {
		const err = new Error("Enrollment session expired");
		err.code = ERROR_CODES.enrollment_expired;
		throw err;
	}
}

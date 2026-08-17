import { MSK_ALGORITHM, MSK_ENVELOPE_VERSION } from "./constants.js";
import { ERROR_CODES } from "./errors.js";

/**
 * INVARIANT 7: The MSK is stored in a separately protected, versioned MSK Envelope.
 * INVARIANT 5: The server never receives plaintext MSK private key.
 */
export function createMskEnvelopeSkeleton({
	version = MSK_ENVELOPE_VERSION,
	algorithm = MSK_ALGORITHM,
	publicKey,
	createdAt,
	armedAt,
	encryptedMsk,
	wraps = [],
	revokedDeviceIds = [],
}) {
	if (version !== MSK_ENVELOPE_VERSION) {
		const err = new Error("Unsupported MSK envelope version");
		err.code = ERROR_CODES.unsupported_structure_version;
		throw err;
	}
	return {
		envelope_version: version,
		algorithm,
		public_key: publicKey,
		created_at: createdAt,
		armed_at: armedAt ?? null,
		encrypted_msk: encryptedMsk,
		wraps,
		revoked_device_ids: [...revokedDeviceIds],
	};
}

export function assertMskEnvelope(envelope) {
	if (!envelope || envelope.envelope_version !== MSK_ENVELOPE_VERSION) {
		const err = new Error("Unsupported or missing MSK envelope");
		err.code = envelope
			? ERROR_CODES.unsupported_structure_version
			: ERROR_CODES.msk_envelope_missing;
		throw err;
	}
	if (!envelope.encrypted_msk || !Array.isArray(envelope.wraps)) {
		const err = new Error("MSK envelope is incomplete");
		err.code = ERROR_CODES.msk_envelope_missing;
		throw err;
	}
	return envelope;
}

export function wrapForDevice(envelope, wrap) {
	const next = {
		...assertMskEnvelope(envelope),
		wraps: [
			...envelope.wraps.filter((item) => item.device_id !== wrap.device_id),
			wrap,
		],
	};
	return next;
}

export function revokeDeviceWraps(envelope, deviceId) {
	const current = assertMskEnvelope(envelope);
	return {
		...current,
		wraps: current.wraps.filter((item) => item.device_id !== deviceId),
		revoked_device_ids: [
			...new Set([...(current.revoked_device_ids ?? []), deviceId]),
		],
	};
}

import {
	DEVICE_AUTHORIZATION_VERSION,
	DEVICE_KEY_ALGORITHM,
} from "./constants.js";
import { ERROR_CODES } from "./errors.js";
import { canonicalizeJson } from "./jcs.js";

/**
 * INVARIANT 1: Normal device enrollment requires authorization from
 * an existing authorized device.
 * INVARIANT 6: Every device has its own Device Identity Key.
 * INVARIANT 9: Adding a device is not creating a new identity.
 */
export function deviceAuthorizationPayload({
	version = DEVICE_AUTHORIZATION_VERSION,
	principalId,
	deviceId,
	devicePublicKey,
	deviceKeyAlgorithm = DEVICE_KEY_ALGORITHM,
	createdAt,
	nonce,
	deviceName,
}) {
	if (version !== DEVICE_AUTHORIZATION_VERSION) {
		const err = new Error("Unsupported DeviceAuthorization version");
		err.code = ERROR_CODES.unsupported_structure_version;
		throw err;
	}
	const payload = {
		version,
		principal_id: principalId,
		device_id: deviceId,
		device_public_key: devicePublicKey,
		device_key_algorithm: deviceKeyAlgorithm,
		created_at: createdAt,
		nonce,
	};
	if (deviceName) payload.device_name = deviceName;
	return payload;
}

export function canonicalizeDeviceAuthorization(authorization) {
	return canonicalizeJson(deviceAuthorizationPayload(authorization));
}

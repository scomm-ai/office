import { VAULT_RECORD_VERSION } from "./constants.js";
import { ERROR_CODES } from "./errors.js";

/**
 * INVARIANT 10: Vault merge must not lose legitimate independently
 * created historical keys.
 */
export function vaultRecordEnvelope({
	version = VAULT_RECORD_VERSION,
	recordId,
	kind,
	fingerprint,
	ciphertext,
	contentSha256,
}) {
	if (version !== VAULT_RECORD_VERSION) {
		const err = new Error("Unsupported vault record version");
		err.code = ERROR_CODES.unsupported_structure_version;
		throw err;
	}
	return {
		record_version: version,
		record_id: recordId,
		kind,
		fingerprint,
		ciphertext,
		content_sha256: contentSha256,
	};
}

export function mergeRecordIndexes(localIds, remoteIds) {
	return [...new Set([...(localIds ?? []), ...(remoteIds ?? [])])].sort();
}

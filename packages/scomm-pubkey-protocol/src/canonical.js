import { PROTOCOL_NAME } from "./constants.js";
import { bytesToHex, sha256Bytes } from "./identity.js";
import { canonicalizeJson } from "./jcs.js";

/**
 * Canonical bytes that an MSK Ed25519 signature covers.
 *
 *   SComm/Pubkey/{protocol_version}/{operation}\n
 *   principal={uuid-v8}\n
 *   timestamp={unix_ms}\n
 *   nonce={base64url}\n
 *   payload_sha256={hex}\n
 */
export function domainSeparator(protocolVersion, operation) {
	return `${PROTOCOL_NAME}/${protocolVersion}/${operation}`;
}

export async function payloadSha256Hex(payload) {
	const jcs = canonicalizeJson(payload ?? {});
	const digest = await sha256Bytes(jcs);
	return bytesToHex(digest);
}

export async function canonicalSignedBytes({
	protocolVersion,
	operation,
	principal,
	timestamp,
	nonce,
	payload,
}) {
	const payloadHash = await payloadSha256Hex(payload);
	const text =
		`${domainSeparator(protocolVersion, operation)}\n` +
		`principal=${principal}\n` +
		`timestamp=${timestamp}\n` +
		`nonce=${nonce}\n` +
		`payload_sha256=${payloadHash}\n`;
	return new TextEncoder().encode(text);
}

export async function canonicalSignedUtf8(input) {
	return new TextDecoder().decode(await canonicalSignedBytes(input));
}

export const VAULT_RECORD_OPERATION = "vault_record";

/**
 * `msk_signature = Sign(MSK_private, canonical(identity_id, generation,
 * ciphertext_hash, previous_generation_hash, timestamp, nonce))`. Independent
 * of `canonicalSignedBytes` (the generic mutation envelope signature) — this
 * covers only the VaultRecord's own fields, so any future downloading device
 * can re-verify it from the stored record alone. Must match the server's
 * `canonicalVaultRecordUtf8` (pubkey/src/lib/protocol/canonical.ts) and
 * secMail10's `canonicalVaultRecordBytes` byte-for-byte.
 */
export function canonicalVaultRecordUtf8({
	protocolVersion,
	identityId,
	generation,
	ciphertextHash,
	previousGenerationHash,
	timestamp,
	nonce,
}) {
	return (
		`${domainSeparator(protocolVersion, VAULT_RECORD_OPERATION)}\n` +
		`identity=${identityId}\n` +
		`generation=${generation}\n` +
		`ciphertext_hash=${bytesToHex(ciphertextHash)}\n` +
		`previous_generation_hash=${
			previousGenerationHash ? bytesToHex(previousGenerationHash) : "none"
		}\n` +
		`timestamp=${timestamp}\n` +
		`nonce=${encodeBase64Url(nonce)}\n`
	);
}

export function canonicalVaultRecordBytes(input) {
	return new TextEncoder().encode(canonicalVaultRecordUtf8(input));
}

export function encodeBase64Url(bytes) {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeBase64Url(value) {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/");
	const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
	const binary = atob(padded + pad);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

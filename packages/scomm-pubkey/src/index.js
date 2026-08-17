export {
	normalizeEmail,
	isValidEmail,
	requireCanonicalEmail,
	principalFromEmail,
	textToUuidV8,
	emailSha256Hex,
	bytesToHex,
	canonicalSignedBytes,
	canonicalizeJson,
	encodeBase64Url,
	decodeBase64Url,
	selectBestArtifact,
	protocolFamiliesFromPrimitives,
	applyCapabilityPolicy,
	ALGORITHM_REGISTRY,
	ERROR_CODES,
	OPERATIONS,
	FAMILIES,
	PURPOSES,
	CRYPTO_OPERATIONS,
	KEY_PROTECTION,
	REQUIREMENT_LEVELS,
	PROTOCOL_VERSION,
	MSK_ALGORITHM,
	IDENTITY_UX_STATES,
	OTP_BITS,
	OTP_BASE62_LENGTH,
	OTP_BASE62_ALPHABET,
	PUBLIC_PRODUCT_NAME,
	OTP_FROM_DISPLAY_NAME,
	FULL_DEVICE_PERMISSIONS,
	deviceAuthorizationPayload,
	resolveIdentityUxState,
	mustNotGenerateMsk,
	formatOpenPgpLocator,
	formatLocator,
	KEY_PACKAGE_KIND,
} from "@scomm/pubkey-protocol";

export { PubkeyError } from "./errors.js";
export { PubkeyClient } from "./client.js";
export { CryptoProvider } from "./crypto/provider.js";
export { WebCryptoProvider } from "./crypto/webcrypto.js";
export { WasmCryptoProvider } from "./crypto/fallback.js";
export {
	CryptoProviderRegistry,
	createDefaultJsRegistry,
	protocolCapabilitiesFromProvider,
} from "./crypto/registry.js";
export { wipeBytes } from "./crypto/bytes.js";
export {
	generateDeviceKey,
	generateMSK,
	deriveEnrollmentSessionKeys,
	encryptEnrollmentPayload,
	decryptEnrollmentPayload,
	wrapMSKForDevice,
	unwrapMSKForDevice,
	encryptVaultRecord,
	decryptVaultRecord,
	encodeVaultRecord,
	decodeVaultRecord,
	packVaultRecordBox,
	unpackVaultRecordBox,
} from "./crypto/enrollment.js";
export { PgpEngine, createPgpEngine } from "./engines/pgp.js";
export { SmimeEngine } from "./engines/smime.js";
export { PqEngine } from "./engines/pq.js";
export { Vault } from "./vault/vault.js";
export {
	VaultStore,
	MemoryVaultStore,
	VaultTransport,
	HttpVaultTransport,
} from "./vault/store.js";

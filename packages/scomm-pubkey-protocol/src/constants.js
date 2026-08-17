export const PROTOCOL_VERSION = 1;
export const PROTOCOL_NAME = "SComm/Pubkey";
export const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
export const NONCE_REPLAY_TTL_MS = TIMESTAMP_WINDOW_MS + 60 * 1000;
export const MSK_ALGORITHM = "ed25519";
export const FIRST_KEY_ID = 1;

export const OPERATIONS = Object.freeze({
	enroll_msk: "enroll_msk",
	arm_msk: "arm_msk",
	replace_msk: "replace_msk",
	arm_replacement_msk: "arm_replacement_msk",
	set_keys: "set_keys",
	retire_key: "retire_key",
	update_preferences: "update_preferences",
	get_best_key: "get_best_key",
	get_me: "get_me",
	report_vault_coverage: "report_vault_coverage",
	authorize_device: "authorize_device",
	revoke_device: "revoke_device",
	list_devices: "list_devices",
	complete_device_enrollment: "complete_device_enrollment",
	vault_put_record: "vault_put_record",
	vault_list: "vault_list",
	vault_get_records: "vault_get_records",
});

export const FAMILIES = Object.freeze({
	pgp: "pgp",
	smime: "smime",
	pq: "pq",
});

export const PURPOSES = Object.freeze({
	masterSigning: "master-signing",
	signing: "signing",
	encryption: "encryption",
	keyAgreement: "key-agreement",
	kem: "kem",
	certificate: "certificate",
	authentication: "authentication",
	vaultWrapping: "vault-wrapping",
});

/** Primitive operations on a CryptoProvider. Not Pubkey wire families. */
export const CRYPTO_OPERATIONS = Object.freeze({
	random: "random",
	hash: "hash",
	generateKey: "generateKey",
	importKey: "importKey",
	exportKey: "exportKey",
	sign: "sign",
	verify: "verify",
	deriveSecret: "deriveSecret",
	encrypt: "encrypt",
	decrypt: "decrypt",
	wrapKey: "wrapKey",
	unwrapKey: "unwrapKey",
});

/** Storage/security properties. Orthogonal to MSK / content-key protocol roles. */
export const KEY_PROTECTION = Object.freeze({
	software: "software",
	osProtected: "os-protected",
	hardwareBacked: "hardware-backed",
	portableVault: "portable-vault",
});

export const REQUIREMENT_LEVELS = Object.freeze({
	required: "required",
	preferred: "preferred",
	supported: "supported",
	unavailable: "unavailable",
});

export const KEY_GENERATION_STATUS = Object.freeze({
	active: "active",
	retired: "retired",
	revoked: "revoked",
});

export const MSK_STATUS = Object.freeze({
	pending: "pending",
	armed: "armed",
	replaced: "replaced",
	revoked: "revoked",
});

export const VAULT_FORMAT_VERSION = 1;
export const VAULT_KDF = "pbkdf2-sha256";
export const VAULT_AEAD = "aes-256-gcm";
export const VAULT_PBKDF2_ITERATIONS = 210_000;
export const VAULT_SALT_BYTES = 16;
export const VAULT_IV_BYTES = 12;
export const VAULT_PEPPER_BYTES = 32;

export const DEVICE_AUTHORIZATION_VERSION = 1;
export const ENROLLMENT_QR_VERSION = 1;
export const ENROLLMENT_HANDSHAKE_VERSION = 1;
export const MSK_ENVELOPE_VERSION = 1;
export const VAULT_RECORD_VERSION = 1;
export const ENROLLMENT_TTL_MS = 5 * 60 * 1000;
export const DEVICE_KEY_ALGORITHM = "ed25519";
export const ENROLLMENT_KEM = "x25519";
export const ENROLLMENT_KEM_FALLBACK = "p-256";
export const ENROLLMENT_HKDF_INFO = "scomm-enrollment-v1";
export const MSK_WRAP_INFO = "scomm-msk-wrap-v1";
export const VRK_WRAP_INFO = "scomm-vrk-wrap-v1";
export const ENROLLMENT_STATE = Object.freeze({
	new: "NEW",
	qrCreated: "QR_CREATED",
	channelEstablished: "CHANNEL_ESTABLISHED",
	waitingForApproval: "WAITING_FOR_APPROVAL",
	mskAuthorized: "MSK_AUTHORIZED",
	bootstrapTransferred: "BOOTSTRAP_TRANSFERRED",
	serverRegistered: "SERVER_REGISTERED",
	active: "ACTIVE",
	cancelled: "CANCELLED",
	expired: "EXPIRED",
	rejected: "REJECTED",
});

export const RECOVERY_STATE = Object.freeze({
	requested: "RECOVERY_REQUESTED",
	otpSent: "OTP_SENT",
	otpVerified: "OTP_VERIFIED",
	newMskSubmitted: "NEW_MSK_SUBMITTED",
	newMskArmed: "NEW_MSK_ARMED",
	oldMskRetired: "OLD_MSK_RETIRED",
	recoveryDeviceAuthorized: "RECOVERY_DEVICE_AUTHORIZED",
	complete: "COMPLETE",
});

export const IDENTITY_UX_STATES = Object.freeze({
	noIdentity: "no_existing_identity",
	authorized: "existing_identity_authorized",
	unauthorized: "existing_identity_unauthorized",
	enrollmentPending: "enrollment_pending",
	waitingForApproval: "waiting_for_previous_device_approval",
	enrollmentExpired: "enrollment_expired",
	enrollmentRejected: "enrollment_rejected",
	vaultSyncing: "vault_synchronization_in_progress",
	vaultSynchronized: "vault_synchronized",
	deviceRevoked: "device_revoked",
	noPreviousDevice: "no_authorized_previous_device_available",
	recoveryStarted: "identity_recovery_started",
	otpRequired: "otp_required",
	otpInvalid: "otp_invalid_or_expired",
	newMskCreating: "new_msk_being_created",
	identityRecovered: "identity_successfully_recovered",
	historicalKeysUnavailable: "historical_vault_keys_unavailable",
});

/** Mailbox OTP: 64-bit random value as 11 Base62 characters. Not TOTP. */
export const OTP_BITS = 64;
export const OTP_BASE62_LENGTH = 11;
export const OTP_BASE62_ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const PUBLIC_PRODUCT_NAME = "Scomm.AI";
export const OTP_FROM_DISPLAY_NAME = "SComm.AI NoReply OTP";

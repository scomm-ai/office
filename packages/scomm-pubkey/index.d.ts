export function normalizeEmail(email: string): string;
export function isValidEmail(email: string): boolean;
export function requireCanonicalEmail(email: string): string;
export function principalFromEmail(email: string): Promise<string>;
export function textToUuidV8(text: string): Promise<string>;
export function emailSha256Hex(email: string): Promise<string>;
export function bytesToHex(bytes: Uint8Array): string;
export function encodeBase64Url(bytes: Uint8Array): string;
export function decodeBase64Url(value: string): Uint8Array;
export function formatOpenPgpLocator(value: string): string;
export function formatLocator(family: string, value: string): string;
export const KEY_PACKAGE_KIND: "scomm-key-package";
export function canonicalizeJson(value: unknown): string;
export function canonicalSignedBytes(input: unknown): Promise<Uint8Array>;
export function selectBestArtifact(...args: unknown[]): unknown;
export function protocolFamiliesFromPrimitives(primitives?: unknown): {
	families: Record<string, string[]>;
};
export function applyCapabilityPolicy(
	capabilities: { families: Record<string, string[]> },
	policy?: unknown,
): { families: Record<string, string[]> };

export const ALGORITHM_REGISTRY: Record<string, unknown>;
export const ERROR_CODES: Record<string, string>;
export const OPERATIONS: Record<string, string>;
export const FAMILIES: { pgp: "pgp"; smime: "smime"; pq: "pq" };
export const PURPOSES: {
	masterSigning: "master-signing";
	signing: "signing";
	encryption: "encryption";
	keyAgreement: "key-agreement";
};
export const CRYPTO_OPERATIONS: Record<string, string>;
export const KEY_PROTECTION: Record<string, string>;
export const REQUIREMENT_LEVELS: Record<string, string>;
export const PROTOCOL_VERSION: number;
export const MSK_ALGORITHM: "ed25519";
export const OTP_BITS: 64;
export const OTP_BASE62_LENGTH: 11;
export const OTP_BASE62_ALPHABET: string;
export const PUBLIC_PRODUCT_NAME: "Scomm.AI";
export const OTP_FROM_DISPLAY_NAME: "SComm.AI NoReply OTP";

export class PubkeyError extends Error {
	code: string;
	constructor(code: string, message: string, extras?: Record<string, unknown>);
	static fromResponse(status: number, body: unknown): PubkeyError;
}

export interface KeyHandle {
	id: string;
	provider: string;
	algorithm: string;
	purpose?: string;
	extractable: boolean;
	protection: string;
	publicKey?: Uint8Array;
}

export interface DeviceEnrollmentDevice {
	identityKey: KeyHandle;
	publicKey?: Uint8Array;
	name?: string;
}

export interface MskEnvelope {
	envelope_version: number;
	algorithm: string;
	public_key: string;
	created_at: number;
	encrypted_msk: string;
	wraps: unknown[];
	revoked_device_ids: string[];
}

export interface PortablePrivateKey {
	algorithm: string;
	encoding: string;
	bytes: Uint8Array;
	purpose?: string;
	publicKey?: Uint8Array;
	extractable?: boolean;
}

export class CryptoProvider {
	readonly id: string;
	readonly kind: "platform" | "fallback";
	random(length: number): Uint8Array;
	generateSigningKey(
		algorithm?: string,
		options?: { purpose?: string; extractable?: boolean; protection?: string },
	): Promise<KeyHandle>;
	generateEncryptionKey(
		algorithm: string,
		options?: { purpose?: string; extractable?: boolean; protection?: string },
	): Promise<KeyHandle>;
	importPrivateKey(
		portable: PortablePrivateKey,
		options?: { extractable?: boolean; protection?: string },
	): Promise<KeyHandle>;
	exportPrivateKey(key: KeyHandle): Promise<PortablePrivateKey>;
	generateDeviceKey(options?: {
		extractable?: boolean;
		protection?: string;
	}): Promise<KeyHandle>;
	generateMSK(options?: { extractable?: boolean; protection?: string }): Promise<KeyHandle>;
	sign(key: KeyHandle, payload: Uint8Array): Promise<Uint8Array>;
	wrapVault(
		plaintext: Uint8Array,
		passphrase: string,
		options?: { iterations?: number; salt?: Uint8Array; iv?: Uint8Array },
	): Promise<{ salt: Uint8Array; iv: Uint8Array; iterations: number; ciphertext: Uint8Array }>;
	unwrapVault(
		ciphertext: Uint8Array,
		passphrase: string,
		salt: Uint8Array,
		iv: Uint8Array,
		iterations: number,
	): Promise<Uint8Array>;
}

export class WebCryptoProvider extends CryptoProvider {}
export class WasmCryptoProvider extends CryptoProvider {
	constructor(module?: unknown);
}

export class CryptoProviderRegistry {
	constructor(providers?: CryptoProvider[]);
	register(provider: CryptoProvider): this;
	discover(): CryptoProvider[];
}

export function createDefaultJsRegistry(
	providers?: CryptoProvider[],
): CryptoProviderRegistry;

export class PgpEngine {
	constructor(provider?: CryptoProvider);
	provider: CryptoProvider | undefined;
	available: boolean;
	advertisedAlgorithms: string[];
	generateKey(request?: {
		name?: string;
		email: string;
		algorithm?: string;
	}): Promise<{
		publicKey: Uint8Array;
		privateKey: Uint8Array;
		fingerprint: string;
		algorithm: string;
	}>;
	encrypt(request?: {
		plaintext?: string | Uint8Array;
		recipientPublicKey?: Uint8Array | string;
		recipientPublicKeys?: Array<Uint8Array | string>;
		algorithm?: string;
	}): Promise<Uint8Array>;
	decrypt(request?: {
		ciphertext?: string | Uint8Array;
		privateKey?: Uint8Array | string;
		algorithm?: string;
	}): Promise<Uint8Array>;
	sign(): Promise<never>;
	verify(): Promise<never>;
}

export function createPgpEngine(provider?: CryptoProvider): PgpEngine;

export class SmimeEngine {
	constructor(provider?: CryptoProvider);
	available: boolean;
	advertisedAlgorithms: string[];
}

export interface VaultStore {
	load(): Promise<unknown>;
	save(record: unknown): Promise<void>;
	clear?(): Promise<void>;
}

export class MemoryVaultStore implements VaultStore {
	load(): Promise<unknown>;
	save(record: unknown): Promise<void>;
	clear(): Promise<void>;
}

export interface VaultEntry {
	kind: string;
	key_id?: number;
	family?: string;
	purpose?: string;
	algorithm?: string;
	fingerprint?: string;
	locator?: string;
	locators?: string[];
	status?: string;
	private_material?: Uint8Array;
}

export class Vault {
	constructor(options: { crypto: CryptoProvider; store?: VaultStore; principal?: string });
	crypto: CryptoProvider;
	store: VaultStore;
	principal?: string;
	unlocked: boolean;
	entries: VaultEntry[];
	vrk: Uint8Array | null;
	createVault(principal: string): Promise<this>;
	unlockVault(passphrase: string): Promise<this>;
	ensureVrk(): Uint8Array;
	lockVault(): void;
	listKeys(): Array<Omit<VaultEntry, "private_material">>;
	getKey(keyId: number | undefined): VaultEntry | null;
	getKeyByFingerprint(fingerprint: string): VaultEntry | null;
	getCurrentKey(purpose?: string): VaultEntry | null;
	getHistoricalKey(keyId: number): VaultEntry | null;
	getMsk(): VaultEntry | { kind: "msk_envelope"; envelope: MskEnvelope } | null;
	setMskEnvelope(envelope: MskEnvelope): MskEnvelope;
	addKey(entry: VaultEntry): VaultEntry;
	retireKey(keyId: number): VaultEntry | null;
	merge(other: Vault): this;
	persist(passphrase: string): Promise<unknown>;
	exportVault(passphrase: string): Promise<unknown>;
	importVault(exported: unknown, passphrase: string): Promise<this>;
	exportKeyPackage(fingerprint: string, passphrase: string): Promise<unknown>;
	importKeyPackage(exported: unknown, passphrase: string): Promise<VaultEntry>;
}

export class PubkeyClient {
	constructor(options: {
		readBaseUrl?: string;
		writeBaseUrl?: string;
		crypto: CryptoProvider;
		vault?: Vault;
		pgpEngine?: PgpEngine;
		smimeEngine?: SmimeEngine;
		sdkName?: string;
		sdkVersion?: string;
		fetchImpl?: typeof fetch;
	});
	readBaseUrl: string;
	writeBaseUrl: string;
	crypto: CryptoProvider;
	vault?: Vault;
	pgpEngine?: PgpEngine;
	smimeEngine?: SmimeEngine;
	enrollMsk(input: { email: string; mskPublicKey: Uint8Array }): Promise<unknown>;
	verifyEnroll(input: {
		email: string;
		otp: string;
		captcha?: string;
		mskKey: KeyHandle;
		device?: DeviceEnrollmentDevice;
	}): Promise<unknown>;
	setKeys(input: {
		email: string;
		artifacts: unknown[];
		mskKey: KeyHandle;
	}): Promise<unknown>;
	assertNoSilentMsk(input: {
		principalExists: boolean;
		localMsk: boolean;
		explicitRecovery: boolean;
	}): void;
	beginDeviceEnrollment(input: {
		email: string;
		device?: DeviceEnrollmentDevice;
		rendezvous?: Record<string, unknown>;
	}): Promise<{ pairingCode?: string; qr?: Record<string, unknown> }>;
	listDevices(input: { email: string; mskKey: KeyHandle }): Promise<unknown>;
	beginIdentityRecovery(input: { email: string; mskPublicKey: Uint8Array }): Promise<unknown>;
	replaceMasterSigningKey(input: {
		email: string;
		otp: string;
		captcha?: string;
		mskKey: KeyHandle;
		device?: DeviceEnrollmentDevice;
	}): Promise<unknown>;
	getBestKey(input: {
		email?: string;
		sha256?: string;
		principal?: string;
		purpose?: string;
		capabilities?: unknown;
		capabilityPolicy?: unknown;
	}): Promise<Record<string, unknown>>;
	discoveryCapabilities(policy?: unknown): Promise<{ families: Record<string, string[]> }>;
	getMe(input: { email: string; mskKey: KeyHandle }): Promise<unknown>;
	reportVaultCoverage(input: {
		email: string;
		mskKey: KeyHandle;
		deviceId: string;
		locators?: string[];
		fingerprints?: string[];
	}): Promise<unknown>;
	syncVault(input: {
		email: string;
		mskKey: KeyHandle;
		records?: Array<Record<string, unknown>>;
		vault?: Vault;
		vrk?: Uint8Array;
		persistSecret?: string;
	}): Promise<{ pulled: unknown[]; listed: unknown; applied: string[] }>;
}

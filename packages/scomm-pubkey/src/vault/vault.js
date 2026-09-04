import {
	ERROR_CODES,
	VAULT_AEAD,
	VAULT_FORMAT_VERSION,
	VAULT_KDF,
	VAULT_PBKDF2_ITERATIONS,
	encodeBase64Url,
	decodeBase64Url,
	formatLocator,
	KEY_PACKAGE_KIND,
	KEY_PACKAGE_VERSION,
	VAULT_WRAP_VERSION_V1,
} from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";
import { MemoryVaultStore } from "./store.js";

function nowMs() {
	return Date.now();
}

function cloneEntry(entry) {
	return {
		...entry,
		locators: entry.locators ? [...entry.locators] : undefined,
		private_material: entry.private_material
			? new Uint8Array(entry.private_material)
			: undefined,
	};
}

function fingerprintOf(entry) {
	return entry.fingerprint || "";
}

function samePrivate(a, b) {
	if (!a?.private_material || !b?.private_material) {
		return fingerprintOf(a) === fingerprintOf(b);
	}
	if (a.private_material.length !== b.private_material.length) return false;
	return a.private_material.every((byte, i) => byte === b.private_material[i]);
}

function publicJson(entry) {
	return {
		kind: entry.kind,
		key_id: entry.key_id,
		family: entry.family,
		purpose: entry.purpose,
		algorithm: entry.algorithm,
		fingerprint: entry.fingerprint,
		locator: entry.locator,
		locators: entry.locators,
		status: entry.status,
	};
}

// CKVF VaultPlaintext codec — converts between office's flat `entries` list
// and the spec's typed openpgp_keys/smime_keys/signing_keys arrays, matching
// secMail10's `vaultEntriesToPlaintextArrays`/`vaultEntriesFromPlaintextArrays`
// (packages/scomm_pubkey/lib/src/vault/vault_plaintext.dart) field-for-field.
// This is what makes a vault ciphertext genuinely readable across office and
// secMail10 — the earlier flat `{entries: [...]}` shape this replaced was
// office-only and silently produced zero entries when decrypting a real
// secMail10 vault (or vice versa).

/** Internal 'retired' <-> spec 'historical' vocabulary for the same concept. */
function statusToSpec(status) {
	return status === "retired" ? "historical" : status;
}

function statusFromSpec(status) {
	return status === "historical" ? "retired" : status;
}

function idOf(entry) {
	return String(entry.key_id ?? entry.fingerprint ?? entry.locator ?? "");
}

function openPgpKeyToJson(entry) {
	return {
		key_id: idOf(entry),
		type: entry.purpose === "signing" ? "signing" : "encryption",
		status: statusToSpec(entry.status),
		...(entry.created_at != null ? { created_at: entry.created_at } : {}),
		...(entry.private_material
			? { private_key: encodeBase64Url(entry.private_material) }
			: {}),
		...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}),
		...(entry.locator ? { locator: entry.locator } : {}),
		...(entry.locators ? { locators: entry.locators } : {}),
		...(entry.algorithm ? { algorithm: entry.algorithm } : {}),
	};
}

function openPgpKeyFromJson(json) {
	const keyId = Number.parseInt(String(json.key_id), 10);
	return {
		kind: "content",
		key_id: Number.isNaN(keyId) ? undefined : keyId,
		family: "pgp",
		purpose: json.type === "signing" ? "signing" : "encryption",
		algorithm: json.algorithm,
		fingerprint: json.fingerprint,
		locator: json.locator,
		locators: Array.isArray(json.locators) ? json.locators.map(String) : undefined,
		private_material:
			typeof json.private_key === "string" ? decodeBase64Url(json.private_key) : undefined,
		status: statusFromSpec(json.status ?? "active"),
		created_at: json.created_at,
	};
}

function smimeKeyToJson(entry) {
	return {
		cert_id: idOf(entry),
		status: statusToSpec(entry.status),
		...(entry.created_at != null ? { created_at: entry.created_at } : {}),
		...(entry.private_material
			? { private_key: encodeBase64Url(entry.private_material) }
			: {}),
		...(entry.certificate ? { certificate: encodeBase64Url(entry.certificate) } : {}),
		...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}),
		...(entry.locator ? { locator: entry.locator } : {}),
		...(entry.locators ? { locators: entry.locators } : {}),
		...(entry.algorithm ? { algorithm: entry.algorithm } : {}),
	};
}

function smimeKeyFromJson(json) {
	const keyId = Number.parseInt(String(json.cert_id), 10);
	return {
		kind: "content",
		key_id: Number.isNaN(keyId) ? undefined : keyId,
		family: "smime",
		purpose: "encryption",
		algorithm: json.algorithm,
		fingerprint: json.fingerprint,
		locator: json.locator,
		locators: Array.isArray(json.locators) ? json.locators.map(String) : undefined,
		private_material:
			typeof json.private_key === "string" ? decodeBase64Url(json.private_key) : undefined,
		certificate:
			typeof json.certificate === "string" ? decodeBase64Url(json.certificate) : undefined,
		status: statusFromSpec(json.status ?? "active"),
		created_at: json.created_at,
	};
}

function signingKeyToJson(entry) {
	return {
		key_id: idOf(entry),
		...(entry.purpose ? { purpose: entry.purpose } : {}),
		status: statusToSpec(entry.status),
		...(entry.private_material
			? { private_key: encodeBase64Url(entry.private_material) }
			: {}),
		...(entry.created_at != null ? { created_at: entry.created_at } : {}),
		...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}),
		...(entry.locator ? { locator: entry.locator } : {}),
		...(entry.algorithm ? { algorithm: entry.algorithm } : {}),
	};
}

function signingKeyFromJson(json) {
	const keyId = Number.parseInt(String(json.key_id), 10);
	return {
		kind: "content",
		key_id: Number.isNaN(keyId) ? undefined : keyId,
		family: undefined,
		purpose: json.purpose,
		algorithm: json.algorithm,
		fingerprint: json.fingerprint,
		locator: json.locator,
		private_material:
			typeof json.private_key === "string" ? decodeBase64Url(json.private_key) : undefined,
		status: statusFromSpec(json.status ?? "active"),
		created_at: json.created_at,
	};
}

function legacyEntryToJson(entry) {
	return {
		kind: entry.kind,
		...(entry.key_id != null ? { key_id: entry.key_id } : {}),
		...(entry.family ? { family: entry.family } : {}),
		...(entry.purpose ? { purpose: entry.purpose } : {}),
		...(entry.algorithm ? { algorithm: entry.algorithm } : {}),
		...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}),
		...(entry.locator ? { locator: entry.locator } : {}),
		...(entry.locators ? { locators: entry.locators } : {}),
		...(entry.private_material
			? { private_material: encodeBase64Url(entry.private_material) }
			: {}),
		status: statusToSpec(entry.status),
		...(entry.created_at != null ? { created_at: entry.created_at } : {}),
		...(entry.certificate ? { certificate: encodeBase64Url(entry.certificate) } : {}),
	};
}

function legacyEntryFromJson(json) {
	return {
		...json,
		private_material:
			typeof json.private_material === "string"
				? decodeBase64Url(json.private_material)
				: undefined,
		certificate:
			typeof json.certificate === "string" ? decodeBase64Url(json.certificate) : undefined,
		status: statusFromSpec(json.status ?? "active"),
	};
}

/** Inverse of `entriesFromPlaintextArrays`. Matches secMail10's `vaultEntriesToPlaintextArrays`. */
function entriesToPlaintextArrays(entries) {
	const openpgpKeys = [];
	const smimeKeys = [];
	const signingKeys = [];
	const legacyEntries = [];
	for (const entry of entries) {
		if (entry.family === "pgp") {
			openpgpKeys.push(openPgpKeyToJson(entry));
		} else if (entry.family === "smime") {
			smimeKeys.push(smimeKeyToJson(entry));
		} else if (!entry.family && entry.kind === "content") {
			signingKeys.push(signingKeyToJson(entry));
		} else {
			legacyEntries.push(legacyEntryToJson(entry));
		}
	}
	return {
		openpgp_keys: openpgpKeys,
		smime_keys: smimeKeys,
		signing_keys: signingKeys,
		legacy_entries: legacyEntries,
	};
}

/** Inverse of `entriesToPlaintextArrays`. Matches secMail10's `vaultEntriesFromPlaintextArrays`. */
function entriesFromPlaintextArrays(plaintext) {
	const entries = [];
	for (const item of Array.isArray(plaintext.openpgp_keys) ? plaintext.openpgp_keys : []) {
		entries.push(openPgpKeyFromJson(item));
	}
	for (const item of Array.isArray(plaintext.smime_keys) ? plaintext.smime_keys : []) {
		entries.push(smimeKeyFromJson(item));
	}
	for (const item of Array.isArray(plaintext.signing_keys) ? plaintext.signing_keys : []) {
		entries.push(signingKeyFromJson(item));
	}
	for (const item of Array.isArray(plaintext.legacy_entries) ? plaintext.legacy_entries : []) {
		if (item?.kind !== "msk") entries.push(legacyEntryFromJson(item));
	}
	return entries;
}

/**
 * Client-side SComm Vault. Never talks to the pubkey HTTP API.
 */
export class Vault {
	constructor({
		crypto,
		store = new MemoryVaultStore(),
		principal,
	} = {}) {
		if (!crypto) {
			throw new TypeError("Vault requires a CryptoProvider");
		}
		this.crypto = crypto;
		this.store = store;
		this.principal = principal;
		this.unlocked = false;
		this.createdAt = nowMs();
		this.updatedAt = this.createdAt;
		this.maxRevisionSeen = 0;
		/** @type {object[]} */
		this.entries = [];
		/** @type {object | null} */
		this.mskEnvelope = null;
		/** @type {Uint8Array | null} */
		this.vrk = null;
		// Authority Encryption Key — only present on a "full" tier device
		// (granted via device pairing or a full-tier offline import). Wraps
		// `mskEnvelope.encrypted_msk` when that field carries an `iv`
		// (AEK-wrapped, the CKVF-spec shape); absent means this device only
		// has content-key access (VRK), not signing authority. See
		// `wrapMskWithAek`/`unwrapMskWithAek` below.
		/** @type {Uint8Array | null} */
		this.aek = null;
		// Server-sync bookkeeping (`/v1/vault/*`, CKVF spec Section 8). Mirrors
		// secMail10's `Vault.generation`/`Vault.lastCiphertextHash`
		// (packages/scomm_pubkey/lib/src/vault/vault.dart): generation 0 means
		// "never uploaded"; lastCiphertextHash null means the same. Persisted
		// locally (see exportVault/unlockVault) so a restart doesn't forget
		// which generation this device last confirmed with the server.
		this.generation = 0;
		/** @type {Uint8Array | null} */
		this.lastCiphertextHash = null;
	}

	async createVault(principal) {
		this.principal = principal;
		this.entries = [];
		this.mskEnvelope = null;
		this.vrk = null;
		this.aek = null;
		this.generation = 0;
		this.lastCiphertextHash = null;
		this.createdAt = nowMs();
		this.updatedAt = this.createdAt;
		this.unlocked = true;
		return this;
	}

	async unlockVault(passphrase) {
		const record = await this.store.load();
		if (!record) {
			throw new PubkeyError(ERROR_CODES.vault_corrupt, "No vault in store");
		}
		let plaintext;
		try {
			plaintext = await this.crypto.unwrapVault(
				decodeBase64Url(record.ciphertext),
				passphrase,
				decodeBase64Url(record.kdf.salt),
				decodeBase64Url(record.encryption.iv),
				record.kdf.iterations,
			);
		} catch (err) {
			if (err instanceof PubkeyError) throw err;
			throw new PubkeyError(
				ERROR_CODES.vault_authentication_failure,
				"Vault authentication failed",
			);
		}
		let parsed;
		try {
			parsed = JSON.parse(new TextDecoder().decode(plaintext));
		} catch {
			throw new PubkeyError(ERROR_CODES.vault_corrupt, "Vault plaintext is not JSON");
		}
		if (parsed.vault_format_version !== VAULT_FORMAT_VERSION) {
			throw new PubkeyError(
				ERROR_CODES.protocol_version_mismatch,
				`Unsupported vault format ${parsed.vault_format_version}`,
			);
		}
		this.principal = parsed.principal;
		this.createdAt = parsed.created_at;
		this.updatedAt = parsed.updated_at;
		this.entries = (parsed.entries ?? [])
			.filter((entry) => entry.kind !== "msk")
			.map((entry) => ({
				...entry,
				private_material: entry.private_material
					? decodeBase64Url(entry.private_material)
					: undefined,
			}));
		this.mskEnvelope = parsed.msk_envelope ?? null;
		this.vrk = parsed.vrk ? decodeBase64Url(parsed.vrk) : null;
		this.aek = parsed.aek ? decodeBase64Url(parsed.aek) : null;
		this.generation = Number.isInteger(parsed.generation) ? parsed.generation : 0;
		this.lastCiphertextHash = parsed.last_ciphertext_hash
			? decodeBase64Url(parsed.last_ciphertext_hash)
			: null;
		this.unlocked = true;
		return this;
	}

	ensureVrk() {
		this._requireUnlocked();
		if (this.vrk instanceof Uint8Array && this.vrk.length === 32) {
			return this.vrk;
		}
		this.vrk = this.crypto.random(32);
		this.updatedAt = nowMs();
		return this.vrk;
	}

	lockVault() {
		this.unlocked = false;
		this.entries = [];
		this.vrk = null;
		this.aek = null;
	}

	_requireUnlocked() {
		if (!this.unlocked) {
			throw new PubkeyError(ERROR_CODES.vault_locked, "Vault is locked");
		}
	}

	listKeys() {
		this._requireUnlocked();
		return this.entries.map(publicJson);
	}

	getKey(keyId) {
		this._requireUnlocked();
		return this.entries.find((entry) => entry.key_id === keyId) ?? null;
	}

	getKeyByFingerprint(fingerprint) {
		this._requireUnlocked();
		return (
			this.entries.find((entry) => fingerprintOf(entry) === fingerprint) ?? null
		);
	}

	getKeysByLocator(locator) {
		this._requireUnlocked();
		const want = String(locator || "");
		return this.entries.filter((entry) => {
			if (entry.locator === want) return true;
			return (entry.locators ?? []).includes(want);
		});
	}

	getCurrentKey(purpose) {
		this._requireUnlocked();
		const active = this.entries.filter(
			(entry) =>
				entry.kind === "content" &&
				entry.status === "active" &&
				(!purpose || entry.purpose === purpose),
		);
		if (active.length === 0) return null;
		return active.reduce((best, entry) =>
			(entry.key_id ?? 0) > (best.key_id ?? 0) ? entry : best,
		);
	}

	getHistoricalKey(keyId) {
		return this.getKey(keyId);
	}

	getMsk() {
		this._requireUnlocked();
		if (this.mskEnvelope) return { kind: "msk_envelope", envelope: this.mskEnvelope };
		return this.entries.find((entry) => entry.kind === "msk") ?? null;
	}

	setMskEnvelope(envelope) {
		this._requireUnlocked();
		this.mskEnvelope = envelope;
		this.updatedAt = nowMs();
		return envelope;
	}

	addKey(entry) {
		this._requireUnlocked();
		if (entry.kind === "msk") {
			throw new PubkeyError(
				ERROR_CODES.vault_integrity,
				"MSK must be stored in the MSK envelope, not as an ordinary vault key",
			);
		}
		const incoming = cloneEntry(entry);
		if (incoming.family && incoming.locator) {
			incoming.locator = formatLocator(incoming.family, incoming.locator);
		}
		const fp = fingerprintOf(incoming);
		if (fp) {
			const existing = this.entries.find((item) => fingerprintOf(item) === fp);
			if (existing) {
				if (!samePrivate(existing, incoming)) {
					throw new PubkeyError(
						ERROR_CODES.vault_integrity,
						"Vault already has different secret material for this fingerprint",
					);
				}
				if (!existing.locator && incoming.locator) existing.locator = incoming.locator;
				if (!existing.locators && incoming.locators) {
					existing.locators = incoming.locators;
				}
				return existing;
			}
		}
		this.entries.push(incoming);
		this.updatedAt = nowMs();
		return incoming;
	}

	retireKey(keyId) {
		this._requireUnlocked();
		const entry = this.getKey(keyId);
		if (!entry) return null;
		entry.status = "retired";
		this.updatedAt = nowMs();
		return entry;
	}

	merge(other) {
		this._requireUnlocked();
		for (const entry of other.entries ?? []) {
			this.addKey(entry);
		}
		return this;
	}

	async exportVault(passphrase) {
		this._requireUnlocked();
		const plaintext = {
			vault_format_version: VAULT_FORMAT_VERSION,
			principal: this.principal,
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			msk_envelope: this.mskEnvelope,
			vrk: this.vrk ? encodeBase64Url(this.vrk) : undefined,
			aek: this.aek ? encodeBase64Url(this.aek) : undefined,
			generation: this.generation,
			last_ciphertext_hash: this.lastCiphertextHash
				? encodeBase64Url(this.lastCiphertextHash)
				: undefined,
			entries: this.entries.map((entry) => ({
				...entry,
				private_material: entry.private_material
					? encodeBase64Url(entry.private_material)
					: undefined,
			})),
		};
		const wrapped = await this.crypto.wrapVault(
			new TextEncoder().encode(JSON.stringify(plaintext)),
			passphrase,
			{ iterations: VAULT_PBKDF2_ITERATIONS },
		);
		return {
			vault_format_version: VAULT_FORMAT_VERSION,
			wrap_version: VAULT_WRAP_VERSION_V1,
			kdf: {
				name: VAULT_KDF,
				iterations: wrapped.iterations,
				salt: encodeBase64Url(wrapped.salt),
			},
			encryption: {
				name: VAULT_AEAD,
				iv: encodeBase64Url(wrapped.iv),
			},
			ciphertext: encodeBase64Url(wrapped.ciphertext),
		};
	}

	/**
	 * Encrypts the current vault content directly with the raw VRK (no
	 * PBKDF2 — unlike `exportVault`'s human-passphrase wrap, this is the
	 * opaque blob format the pubkey server's `/v1/vault/*` endpoints store
	 * and relay). Uses the CKVF-spec VaultPlaintext shape (`openpgp_keys`/
	 * `smime_keys`/`signing_keys`/`legacy_entries`, not a flat `entries`
	 * array) so a vault office uploads is byte-for-byte readable by
	 * secMail10, matching `Vault.exportVault(vek)`
	 * (packages/scomm_pubkey/lib/src/vault/vault.dart) field-for-field.
	 */
	async exportVaultCiphertext(vrk) {
		this._requireUnlocked();
		const plaintext = {
			vault_format_version: VAULT_FORMAT_VERSION,
			generation: this.generation,
			principal: this.principal,
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			current_signing_key_id: this.getCurrentKey?.("signing")?.key_id ?? null,
			current_encryption_key_id: this.getCurrentKey?.("encryption")?.key_id ?? null,
			msk_envelope: this.mskEnvelope,
			...entriesToPlaintextArrays(this.entries),
			metadata: { devices: [] },
		};
		const { iv, ciphertext } = await this.crypto.encryptAead(
			vrk,
			new TextEncoder().encode(JSON.stringify(plaintext)),
		);
		return { iv, ciphertext };
	}

	/**
	 * Inverse of `exportVaultCiphertext`. Pure — does not mutate this Vault.
	 * Accepts the CKVF-spec array shape; a legacy office-only ciphertext
	 * (flat `entries: [...]`, from before this fix) is still readable via
	 * the `legacy_entries` fallback below, since that shape happens to be
	 * exactly `legacy_entries`'s own per-item format.
	 */
	async decryptVaultCiphertext(vrk, iv, ciphertext) {
		const plaintext = await this.crypto.decryptAead(vrk, iv, ciphertext);
		let parsed;
		try {
			parsed = JSON.parse(new TextDecoder().decode(plaintext));
		} catch {
			throw new PubkeyError(ERROR_CODES.vault_corrupt, "Vault plaintext is not JSON");
		}
		if (parsed.vault_format_version !== VAULT_FORMAT_VERSION) {
			throw new PubkeyError(
				ERROR_CODES.protocol_version_mismatch,
				`Unsupported vault format ${parsed.vault_format_version}`,
			);
		}
		const hasSpecArrays = ["openpgp_keys", "smime_keys", "signing_keys", "legacy_entries"].some(
			(key) => Array.isArray(parsed[key]),
		);
		const entries = hasSpecArrays
			? entriesFromPlaintextArrays(parsed)
			: (Array.isArray(parsed.entries) ? parsed.entries : [])
					.filter((entry) => entry.kind !== "msk")
					.map((entry) => ({
						...entry,
						private_material: entry.private_material
							? decodeBase64Url(entry.private_material)
							: undefined,
					}));
		return {
			principal: parsed.principal,
			createdAt: parsed.created_at,
			updatedAt: parsed.updated_at,
			mskEnvelope: parsed.msk_envelope ?? null,
			entries,
		};
	}

	/**
	 * Applies a decrypted remote snapshot (from `decryptVaultCiphertext`) onto
	 * this unlocked Vault. `merge: true` (the default) unions entries via
	 * `addKey` — same fingerprint-conflict rules as `merge()` — and only
	 * fills in the MSK envelope if this vault doesn't already have one.
	 * `merge: false` replaces entries/envelope wholesale (a plain "adopt the
	 * server's snapshot" pull, e.g. right after pairing).
	 */
	applyRemoteSnapshot(snapshot, { merge = true } = {}) {
		this._requireUnlocked();
		if (!merge) {
			this.entries = [];
			this.mskEnvelope = snapshot.mskEnvelope ?? null;
		} else if (snapshot.mskEnvelope && !this.mskEnvelope) {
			this.mskEnvelope = snapshot.mskEnvelope;
		}
		for (const entry of snapshot.entries ?? []) {
			this.addKey(entry);
		}
		this.updatedAt = nowMs();
	}

	async exportKeyPackage(fingerprint, passphrase) {
		this._requireUnlocked();
		const entry = this.getKeyByFingerprint(fingerprint);
		if (!entry || !entry.private_material) {
			throw new PubkeyError(ERROR_CODES.key_not_found, "No private key for package");
		}
		const plaintext = {
			kind: KEY_PACKAGE_KIND,
			package_version: KEY_PACKAGE_VERSION,
			entry: {
				...publicJson(entry),
				private_material: encodeBase64Url(entry.private_material),
			},
		};
		const wrapped = await this.crypto.wrapVault(
			new TextEncoder().encode(JSON.stringify(plaintext)),
			passphrase,
			{ iterations: VAULT_PBKDF2_ITERATIONS },
		);
		return {
			kind: KEY_PACKAGE_KIND,
			package_version: KEY_PACKAGE_VERSION,
			family: entry.family,
			locator: entry.locator,
			fingerprint: entry.fingerprint,
			kdf: {
				name: VAULT_KDF,
				iterations: wrapped.iterations,
				salt: encodeBase64Url(wrapped.salt),
			},
			encryption: {
				name: VAULT_AEAD,
				iv: encodeBase64Url(wrapped.iv),
			},
			ciphertext: encodeBase64Url(wrapped.ciphertext),
		};
	}

	async importKeyPackage(exported, passphrase) {
		this._requireUnlocked();
		let plaintext;
		try {
			plaintext = await this.crypto.unwrapVault(
				decodeBase64Url(exported.ciphertext),
				passphrase,
				decodeBase64Url(exported.kdf.salt),
				decodeBase64Url(exported.encryption.iv),
				exported.kdf.iterations,
			);
		} catch (err) {
			if (err instanceof PubkeyError) throw err;
			throw new PubkeyError(
				ERROR_CODES.vault_authentication_failure,
				"Key package authentication failed",
			);
		}
		const parsed = JSON.parse(new TextDecoder().decode(plaintext));
		if (parsed.kind !== KEY_PACKAGE_KIND) {
			throw new PubkeyError(ERROR_CODES.vault_corrupt, "Not a key package");
		}
		const entry = parsed.entry ?? {};
		if (entry.private_material && typeof entry.private_material === "string") {
			entry.private_material = decodeBase64Url(entry.private_material);
		}
		return this.addKey(entry);
	}

	async importVault(exported, passphrase) {
		const previous = await this.store.load();
		try {
			await this.store.save(exported);
			return await this.unlockVault(passphrase);
		} catch (err) {
			if (previous) await this.store.save(previous);
			throw err;
		}
	}

	async backupVault(passphrase) {
		return this.exportVault(passphrase);
	}

	async restoreVault(exported, passphrase) {
		return this.importVault(exported, passphrase);
	}

	async persist(passphrase) {
		const exported = await this.exportVault(passphrase);
		const previous = await this.store.load();
		try {
			await this.store.save(exported);
		} catch (err) {
			if (previous) await this.store.save(previous);
			throw err;
		}
		return exported;
	}
}

/**
 * `encrypted_msk = AEAD_Encrypt(AEK, msk_private_key_bytes)`. Matches
 * secMail10's `KeyHierarchy.wrapMskWithAek`
 * (packages/scomm_pubkey/lib/src/vault/key_hierarchy.dart) field-for-field
 * (`iv`/`encrypted_msk`, not `ciphertext`) — the MSK private key never sits
 * in a vault's `msk_envelope` in raw form under this scheme, only this
 * AEK-wrapped ciphertext, which the outer VRK/VEK wrap then covers again. A
 * device holding only VRK (no AEK — a "limited" tier pairing grant) cannot
 * reverse this step.
 */
export async function wrapMskWithAek(crypto, aek, mskPrivateKeyBytes) {
	const { iv, ciphertext } = await crypto.encryptAead(aek, mskPrivateKeyBytes);
	return { iv: encodeBase64Url(iv), encrypted_msk: encodeBase64Url(ciphertext) };
}

/**
 * Inverse of `wrapMskWithAek`. Throws if `envelope` has no `iv` field at
 * all — that shape means it's office's own legacy local envelope (created by
 * `persistMsk` before this fix, or still produced when this device
 * generates its own identity locally rather than importing one), where
 * `encrypted_msk` already holds the raw, unwrapped MSK bytes and no AEK is
 * involved. Callers should branch on `'iv' in envelope` before calling this.
 */
export async function unwrapMskWithAek(crypto, aek, envelope) {
	if (typeof envelope?.iv !== "string" || typeof envelope?.encrypted_msk !== "string") {
		throw new PubkeyError(
			ERROR_CODES.vault_corrupt,
			"MSK envelope is missing iv/encrypted_msk",
		);
	}
	try {
		return await crypto.decryptAead(
			aek,
			decodeBase64Url(envelope.iv),
			decodeBase64Url(envelope.encrypted_msk),
		);
	} catch {
		throw new PubkeyError(
			"envelope_authentication_failure",
			"Failed to unwrap MSK envelope: wrong AEK or tampering",
		);
	}
}

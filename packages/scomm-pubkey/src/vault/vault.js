import {
	ERROR_CODES,
	VAULT_AEAD,
	VAULT_FORMAT_VERSION,
	VAULT_KDF,
	VAULT_PBKDF2_ITERATIONS,
	encodeBase64Url,
	decodeBase64Url,
	formatLocator,
	normalizeHex,
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

/** Low 64 bits of an OpenPGP fingerprint — the key id. */
const OPENPGP_KEY_ID_HEX_LEN = 16;

/**
 * Whether two fingerprints name the same key.
 *
 * Clients disagree on how much of it to keep: office stores the full v4
 * fingerprint, secMail10 stores only the key id (the low 64 bits) — the same
 * key, written two ways. An exact-string comparison let both spellings into
 * the vault as separate entries, so one key showed up twice on every client
 * that read it back.
 *
 * So: equal after stripping separators and case, or one is a suffix of the
 * other and the shorter is a full key id. Anything shorter than that is too
 * weak to identify a key and only matches exactly. Non-hex fingerprints
 * (S/MIME digests, test fixtures) normalize to empty and fall back to the
 * exact match, unchanged.
 */
function sameFingerprint(a, b) {
	if (a === b) return true;
	const left = normalizeHex(a);
	const right = normalizeHex(b);
	const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
	// Below a full key id there is not enough here to identify a key, and
	// stripping non-hex characters out of two unrelated labels can easily
	// leave the same few digits behind. Exact string equality only.
	if (shorter.length < OPENPGP_KEY_ID_HEX_LEN) return false;
	return longer.endsWith(shorter);
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

/**
 * Key ids travel through the vault plaintext as strings — every `key_id` /
 * `cert_id` in the arrays above goes through `idOf`, and secMail10 reads
 * `current_signing_key_id`/`current_encryption_key_id` with a `String?` cast
 * (`vault.dart`'s `_applyPlaintextBytes`). A JSON number there makes that
 * cast throw, and since generations are immutable and never deleted, the bad
 * generation stays current — secMail10 can then neither read the vault nor
 * upload a replacement.
 */
function keyIdPointer(value) {
	if (value == null || value === "") return null;
	return String(value);
}

/**
 * `retired`/`revoked` are terminal: a key only ever leaves `active`, never
 * returns to it. So a remote snapshot may move a local entry *into* a
 * terminal state (the user deleted the key on another device), and `revoked`
 * may supersede `retired` (an ordinary retirement later turns out to be a
 * compromise), but nothing may take an entry back to `active`.
 */
function resolveStatus(existing, incoming) {
	if (incoming === "revoked") return "revoked";
	if (incoming === "retired" && existing === "active") return "retired";
	return existing;
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
		// The identity's canonical "which key do new senders see / which key
		// signs" pointers, and its device roster. Office writes none of these
		// itself — there is no promote-a-key or pair-a-device flow here — but
		// it shares one vault document with secMail10, which does. They are
		// carried through read -> merge -> write unchanged so an office upload
		// cannot silently erase or rewrite them. Pointers are strings (see
		// `keyIdPointer`); `null` means "nothing promoted".
		/** @type {string | null} */
		this.currentSigningKeyId = null;
		/** @type {string | null} */
		this.currentEncryptionKeyId = null;
		/** @type {object[]} */
		this.devices = [];
	}

	async createVault(principal) {
		this.principal = principal;
		this.entries = [];
		this.currentSigningKeyId = null;
		this.currentEncryptionKeyId = null;
		this.devices = [];
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
		this.currentSigningKeyId = keyIdPointer(parsed.current_signing_key_id);
		this.currentEncryptionKeyId = keyIdPointer(parsed.current_encryption_key_id);
		this.devices = Array.isArray(parsed.metadata?.devices) ? parsed.metadata.devices : [];
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

	/**
	 * [getKeyByFingerprint] by key identity rather than by string: finds the
	 * entry whichever client wrote it and whichever spelling it used. See
	 * `sameFingerprint`.
	 */
	findKeyByFingerprint(fingerprint) {
		this._requireUnlocked();
		return this.entries.find((entry) => sameFingerprint(fingerprintOf(entry), fingerprint)) ?? null;
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
			const existing = this.entries.find((item) => sameFingerprint(fingerprintOf(item), fp));
			if (existing) {
				if (!samePrivate(existing, incoming)) {
					throw new PubkeyError(
						ERROR_CODES.vault_integrity,
						"Vault already has different secret material for this fingerprint",
					);
				}
				// Same material, re-added now carrying facts the stored copy
				// lacked. `key_id` matters most: an encryption key sits in the
				// vault unpublished (no server id) until it is published, and
				// publishing re-adds it with the id the server just minted.
				// Dropping that left the entry unreachable by `getKey`, so
				// every later lookup by key id — `retireKey` included — missed
				// it. Never overwrite an id already present: a *different* id
				// for the same material is a conflict, not new information.
				if (existing.key_id == null && incoming.key_id != null) {
					existing.key_id = incoming.key_id;
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
		this._clearPointersTo(entry);
		this.updatedAt = nowMs();
		return entry;
	}

	/**
	 * Drops a canonical pointer that names `entry`. The pointers mean "the key
	 * this identity advertises *now*", so they are only meaningful while their
	 * target is active — a retired artifact is not discoverable, so claiming it
	 * is advertised is simply false. Cleared, never re-pointed: choosing a
	 * replacement is an explicit, user-confirmed promotion, so electing one
	 * here would advertise a key nobody picked.
	 */
	_clearPointersTo(entry) {
		const id = keyIdPointer(entry?.key_id);
		if (id == null) return;
		if (this.currentSigningKeyId === id) this.currentSigningKeyId = null;
		if (this.currentEncryptionKeyId === id) this.currentEncryptionKeyId = null;
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
			// Persisted locally too: a restart that forgot these would upload
			// nulls on the next sync and wipe them for every other device.
			current_signing_key_id: keyIdPointer(this.currentSigningKeyId),
			current_encryption_key_id: keyIdPointer(this.currentEncryptionKeyId),
			metadata: { devices: this.devices ?? [] },
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
			// Carried through from whatever the last download said, never
			// derived. Deriving them (e.g. "the highest active key id") would
			// silently advertise a key the user never promoted and overwrite
			// the one they did — promotion is an explicit, user-confirmed act.
			current_signing_key_id: keyIdPointer(this.currentSigningKeyId),
			current_encryption_key_id: keyIdPointer(this.currentEncryptionKeyId),
			msk_envelope: this.mskEnvelope,
			...entriesToPlaintextArrays(this.entries),
			// Office registers no devices of its own, but secMail10 branches
			// its device-compromise response on this roster — uploading an
			// empty list makes it believe this is the identity's only
			// full-authority device and route the user into OTP-only recovery.
			metadata: { devices: this.devices ?? [] },
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
		const metadataDevices = parsed.metadata?.devices;
		return {
			principal: parsed.principal,
			createdAt: parsed.created_at,
			updatedAt: parsed.updated_at,
			mskEnvelope: parsed.msk_envelope ?? null,
			currentSigningKeyId: keyIdPointer(parsed.current_signing_key_id),
			currentEncryptionKeyId: keyIdPointer(parsed.current_encryption_key_id),
			devices: Array.isArray(metadataDevices) ? metadataDevices : [],
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
			const stored = this.addKey(entry);
			// `addKey` dedupes by fingerprint and returns the copy already
			// held, unchanged — so without this, a key retired on another
			// device stayed `active` here *and* got re-uploaded as active,
			// resurrecting a key the user had deleted.
			if (stored) stored.status = resolveStatus(stored.status, entry.status);
		}
		// The identity's own cross-device record, not this device's opinion:
		// adopt what the snapshot says rather than merging or keeping a stale
		// local copy. A `null` pointer is a real value ("nothing promoted").
		if ("currentSigningKeyId" in snapshot) {
			this.currentSigningKeyId = keyIdPointer(snapshot.currentSigningKeyId);
		}
		if ("currentEncryptionKeyId" in snapshot) {
			this.currentEncryptionKeyId = keyIdPointer(snapshot.currentEncryptionKeyId);
		}
		if (Array.isArray(snapshot.devices)) this.devices = snapshot.devices;
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

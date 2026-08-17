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
	VAULT_WRAP_VERSION_V2,
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
	}

	async createVault(principal) {
		this.principal = principal;
		this.entries = [];
		this.mskEnvelope = null;
		this.vrk = null;
		this.createdAt = nowMs();
		this.updatedAt = this.createdAt;
		this.unlocked = true;
		return this;
	}

	async unlockVault(passphrase, { pepper } = {}) {
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
				pepper ? (pepper instanceof Uint8Array ? pepper : decodeBase64Url(pepper)) : undefined,
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

	async exportVault(passphrase, { pepper } = {}) {
		this._requireUnlocked();
		const plaintext = {
			vault_format_version: VAULT_FORMAT_VERSION,
			principal: this.principal,
			created_at: this.createdAt,
			updated_at: this.updatedAt,
			msk_envelope: this.mskEnvelope,
			vrk: this.vrk ? encodeBase64Url(this.vrk) : undefined,
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
			{ iterations: VAULT_PBKDF2_ITERATIONS, pepper },
		);
		return {
			vault_format_version: VAULT_FORMAT_VERSION,
			wrap_version: pepper ? VAULT_WRAP_VERSION_V2 : VAULT_WRAP_VERSION_V1,
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

	async importVault(exported, passphrase, { pepper } = {}) {
		const previous = await this.store.load();
		try {
			await this.store.save(exported);
			return await this.unlockVault(passphrase, { pepper });
		} catch (err) {
			if (previous) await this.store.save(previous);
			throw err;
		}
	}

	async backupVault(passphrase, options) {
		return this.exportVault(passphrase, options);
	}

	async restoreVault(exported, passphrase, options) {
		return this.importVault(exported, passphrase, options);
	}

	async persist(passphrase, options) {
		const exported = await this.exportVault(passphrase, options);
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

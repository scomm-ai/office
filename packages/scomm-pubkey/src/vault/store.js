import { ERROR_CODES } from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";

/** Persistence for a locked/unlocked vault blob. Platform-specific. */
export class VaultStore {
	async load() {
		return null;
	}

	async save(_record) {
		throw new Error("not implemented");
	}

	async clear() {
		throw new Error("not implemented");
	}
}

export class MemoryVaultStore extends VaultStore {
	constructor() {
		super();
		this.record = null;
	}

	async load() {
		return this.record;
	}

	async save(record) {
		this.record = record;
	}

	async clear() {
		this.record = null;
	}
}

/** Encrypted backup / hosted sync. */
export class VaultTransport {
	async push(_exported, _options) {
		throw new Error("not implemented");
	}

	async pull(_options) {
		throw new Error("not implemented");
	}

	async head() {
		throw new Error("not implemented");
	}
}

/**
 * Hosted Vault transport using MSK-signed PubkeyClient vault_* operations.
 */
export class HttpVaultTransport extends VaultTransport {
	constructor({ client, email, getMskKey }) {
		super();
		this.client = client;
		this.email = email;
		this.getMskKey = getMskKey;
	}

	async push(exported, { expectedRevision = 0 } = {}) {
		const mskKey = await this.getMskKey();
		return this.client.vaultPut({
			email: this.email,
			blob: exported,
			expectedRevision,
			mskKey,
		});
	}

	async pull() {
		const mskKey = await this.getMskKey();
		return this.client.vaultGet({ email: this.email, mskKey });
	}

	async head() {
		const mskKey = await this.getMskKey();
		return this.client.vaultHead({ email: this.email, mskKey });
	}

	static conflict(err) {
		return (
			err instanceof PubkeyError &&
			(err.code === ERROR_CODES.vault_revision_conflict ||
				err.causeCode === "vault_revision_conflict")
		);
	}
}

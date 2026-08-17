/** Persistence for a locked/unlocked local vault. Platform-specific. */
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

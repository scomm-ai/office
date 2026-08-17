import { ERROR_CODES, MSK_ALGORITHM } from "@scomm/pubkey-protocol";
import { CryptoProvider } from "./provider.js";
import { PubkeyError } from "../errors.js";

/**
 * Optional WASM / Rust fallback. Not registered by default.
 * Use only when WebCrypto cannot perform a required algorithm.
 */
export class WasmCryptoProvider extends CryptoProvider {
	constructor(module) {
		super();
		this.module = module;
	}

	get id() {
		return "wasm-fallback";
	}

	get kind() {
		return "fallback";
	}

	async capabilities() {
		return {
			id: this.id,
			kind: this.kind,
			sign: this.module ? [MSK_ALGORITHM] : [],
			verify: this.module ? [MSK_ALGORITHM] : [],
			keyAgreement: [],
			aead: this.module ? ["aes-256-gcm"] : [],
			hash: [],
			kem: [],
			protections: [],
			extractable: [],
			random: false,
		};
	}

	async supports(operation, algorithm) {
		if (!this.module) return false;
		const caps = await this.capabilities();
		if (operation === "sign" || operation === "verify") {
			return caps.sign.includes(algorithm);
		}
		return false;
	}

	async generateKey() {
		throw new PubkeyError(
			ERROR_CODES.provider_unavailable,
			"WasmCryptoProvider has no module; WebCrypto is the default JS provider",
		);
	}
}

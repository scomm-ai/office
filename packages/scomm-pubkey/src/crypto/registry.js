import {
	ERROR_CODES,
	KEY_PROTECTION,
	REQUIREMENT_LEVELS,
	applyCapabilityPolicy,
	protocolFamiliesFromPrimitives,
} from "@scomm/pubkey-protocol";
import { PubkeyError } from "../errors.js";
import { WebCryptoProvider } from "./webcrypto.js";

/**
 * Central provider discovery. Protocol code must not branch on platform names.
 */
export class CryptoProviderRegistry {
	constructor(providers = []) {
		/** @type {import("./provider.js").CryptoProvider[]} */
		this._providers = [...providers];
	}

	register(provider) {
		this._providers.push(provider);
		return this;
	}

	discover() {
		return [...this._providers];
	}

	async capabilities() {
		return Promise.all(this._providers.map((provider) => provider.capabilities()));
	}

	_prefer(providers) {
		return (
			providers.find((provider) => provider.kind === "platform") ?? providers[0]
		);
	}

	/**
	 * @param {{
	 *   operation: string,
	 *   algorithm: string,
	 *   protection?: string,
	 *   extractable?: boolean,
	 *   purpose?: string,
	 *   protectionLevel?: string
	 * }} request
	 */
	async select(request) {
		const {
			operation,
			algorithm,
			protection,
			extractable,
			purpose,
			protectionLevel = REQUIREMENT_LEVELS.preferred,
		} = request;
		const properties = { protection, extractable, purpose };

		const matching = [];
		for (const provider of this._providers) {
			if (await provider.supports(operation, algorithm, properties)) {
				matching.push(provider);
			}
		}
		if (matching.length > 0) {
			return this._prefer(matching);
		}

		if (protection && protectionLevel === REQUIREMENT_LEVELS.required) {
			const code =
				protection === KEY_PROTECTION.hardwareBacked ||
				protection === KEY_PROTECTION.osProtected
					? ERROR_CODES.hardware_protection_unavailable
					: ERROR_CODES.provider_unavailable;
			throw new PubkeyError(
				code,
				`No provider satisfies ${operation}/${algorithm} with ${protection}`,
			);
		}

		if (protection) {
			const relaxed = [];
			for (const provider of this._providers) {
				if (
					await provider.supports(operation, algorithm, {
						extractable,
						purpose,
					})
				) {
					relaxed.push(provider);
				}
			}
			if (relaxed.length > 0) {
				return this._prefer(relaxed);
			}
		}

		throw new PubkeyError(
			ERROR_CODES.provider_unavailable,
			`No provider supports ${operation}/${algorithm}`,
		);
	}
}

/** Default JS registry: WebCrypto only. WASM is opt-in. */
export function createDefaultJsRegistry(providers = [new WebCryptoProvider()]) {
	return new CryptoProviderRegistry(providers);
}

export async function protocolCapabilitiesFromProvider(
	provider,
	policy,
	engines = {},
) {
	const caps = await provider.capabilities();
	const mapped = protocolFamiliesFromPrimitives({
		sign: caps.sign,
		keyAgreement: caps.keyAgreement,
		kem: caps.kem,
		aead: caps.aead,
		engines: { ...(caps.engines ?? {}), ...engines },
	});
	return applyCapabilityPolicy(mapped, policy);
}

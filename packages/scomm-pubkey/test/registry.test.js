import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CRYPTO_OPERATIONS,
	KEY_PROTECTION,
	REQUIREMENT_LEVELS,
} from "@scomm/pubkey-protocol";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { WasmCryptoProvider } from "../src/crypto/fallback.js";
import {
	CryptoProviderRegistry,
	createDefaultJsRegistry,
	protocolCapabilitiesFromProvider,
} from "../src/crypto/registry.js";
import { PubkeyError } from "../src/errors.js";
import { PgpEngine } from "../src/engines/pgp.js";
import { PqEngine } from "../src/engines/pq.js";

describe("CryptoProviderRegistry", () => {
	it("selects WebCrypto for Ed25519 signing by default", async () => {
		const registry = createDefaultJsRegistry();
		const provider = await registry.select({
			operation: CRYPTO_OPERATIONS.sign,
			algorithm: "ed25519",
		});
		assert.equal(provider.id, "webcrypto");
		assert.equal(provider.kind, "platform");
	});

	it("does not register the WASM fallback by default", () => {
		const registry = createDefaultJsRegistry();
		assert.equal(
			registry.discover().some((provider) => provider.id === "wasm-fallback"),
			false,
		);
	});

	it("refuses a required hardware-backed MSK instead of creating software", async () => {
		const registry = new CryptoProviderRegistry([
			new WebCryptoProvider(),
			new WasmCryptoProvider(),
		]);
		await assert.rejects(
			() =>
				registry.select({
					operation: CRYPTO_OPERATIONS.sign,
					algorithm: "ed25519",
					protection: KEY_PROTECTION.hardwareBacked,
					protectionLevel: REQUIREMENT_LEVELS.required,
				}),
			(err) =>
				err instanceof PubkeyError &&
				err.code === "hardware_protection_unavailable",
		);
	});

	it("maps provider primitives to protocol families without inventing PGP/PQ", async () => {
		const caps = await protocolCapabilitiesFromProvider(new WebCryptoProvider());
		assert.equal(caps.families.pgp, undefined);
		assert.equal(caps.families.pq, undefined);
	});

	it("throws capability_mismatch when S/MIME is required but unavailable", async () => {
		await assert.rejects(
			() =>
				protocolCapabilitiesFromProvider(new WebCryptoProvider(), {
					smime: REQUIREMENT_LEVELS.required,
				}),
			(err) => err.code === "capability_mismatch",
		);
	});

	it("keeps protocol engines above the provider", async () => {
		const provider = new WebCryptoProvider();
		const pgp = new PgpEngine(provider);
		const pq = new PqEngine(provider);
		assert.equal(pgp.available, true);
		await assert.rejects(
			() => pgp.encrypt({ plaintext: "x" }),
			(err) => err instanceof PubkeyError && err.code === "invalid_public_key",
		);
		await assert.rejects(() => pq.encapsulate(), (err) => err.code === "unsupported_algorithm");
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { PubkeyClient } from "../src/client.js";
import { Vault } from "../src/vault/vault.js";
import { encodeVaultRecord } from "../src/crypto/enrollment.js";
import { OPERATIONS } from "@scomm/pubkey-protocol";

describe("PubkeyClient", () => {
	it("initializes headlessly and signs a mutation envelope", async () => {
		const crypto = new WebCryptoProvider();
		const msk = await crypto.generateSigningKey("ed25519");
		/** @type {object[]} */
		const calls = [];
		const client = new PubkeyClient({
			crypto,
			readBaseUrl: "https://pubkey.test",
			writeBaseUrl: "https://api.pubkey.test",
			fetchImpl: async (url, init) => {
				calls.push({ url, init });
				return new Response(JSON.stringify({ key_id: 1 }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});

		const result = await client.setKeys({
			email: "alice@example.com",
			artifacts: [
				{
					family: "pgp",
					purpose: "encryption",
					algorithm: "openpgp-cv25519",
					public_material: "dGVzdA",
				},
			],
			mskKey: msk,
		});
		assert.equal(result.key_id, 1);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, "https://api.pubkey.test/v1/mutate");
		const body = JSON.parse(calls[0].init.body);
		assert.equal(body.operation, OPERATIONS.set_keys);
		assert.equal(body.principal, "9a28dce8-36a8-8cad-a0e2-8eaaa8c6d976");
		assert.equal(body.signature.algorithm, "ed25519");
		assert.equal(typeof body.signature.value, "string");
		assert.equal(typeof body.nonce, "string");
		assert.equal(typeof body.timestamp, "number");
	});

	it("sends capability negotiation on GET", async () => {
		const crypto = new WebCryptoProvider();
		let seen = "";
		const client = new PubkeyClient({
			crypto,
			readBaseUrl: "https://pubkey.test",
			writeBaseUrl: "https://api.pubkey.test",
			fetchImpl: async (url) => {
				seen = url;
				return new Response(
					JSON.stringify({
						family: "smime",
						key_id: 3,
						algorithm: "smime-mlkem-768",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});
		const selected = await client.getBestKey({
			email: "alice@example.com",
			purpose: "encryption",
			capabilities: { families: { smime: ["smime-mlkem-768"] } },
		});
		assert.equal(selected.key_id, 3);
		assert.match(seen, /\/v1\/keys\?/);
		assert.match(seen, /sha256=/);
		assert.match(seen, /capabilities=/);
		assert.match(seen, /purpose=encryption/);
		assert.doesNotMatch(seen, /[?&]principal=/);
		assert.doesNotMatch(seen, /[?&]email=/);
	});

	it("retries connection failures then succeeds", async () => {
		const crypto = new WebCryptoProvider();
		let attempts = 0;
		const client = new PubkeyClient({
			crypto,
			readBaseUrl: "http://127.0.0.1:3000",
			writeBaseUrl: "http://127.0.0.1:3000",
			fetchImpl: async () => {
				attempts += 1;
				if (attempts < 3) {
					throw new TypeError("Failed to fetch");
				}
				return new Response(JSON.stringify({ status: "ok" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});
		const selected = await client.getBestKey({
			email: "alice@example.com",
			purpose: "encryption",
			capabilities: { families: { smime: ["smime-mlkem-768"] } },
		});
		assert.equal(attempts, 3);
		assert.equal(selected.status, "ok");
	});

	it("maps exhausted connection failures to provider_unavailable", async () => {
		const crypto = new WebCryptoProvider();
		const client = new PubkeyClient({
			crypto,
			readBaseUrl: "http://127.0.0.1:3000",
			writeBaseUrl: "http://127.0.0.1:3000",
			fetchImpl: async () => {
				throw new TypeError("Failed to fetch");
			},
		});
		await assert.rejects(
			() =>
				client.getBestKey({
					email: "alice@example.com",
					purpose: "encryption",
					capabilities: { families: { smime: ["smime-mlkem-768"] } },
				}),
			(error) => {
				assert.equal(error.code, "provider_unavailable");
				assert.match(error.message, /pubkey server/);
				return true;
			},
		);
	});

	it("derives discovery capabilities from the provider instead of hardcoding PGP/PQ", async () => {
		const crypto = new WebCryptoProvider();
		const client = new PubkeyClient({
			crypto,
			readBaseUrl: "https://pubkey.test",
			writeBaseUrl: "https://api.pubkey.test",
		});
		const caps = await client.discoveryCapabilities();
		assert.equal(caps.families.pgp, undefined);
		assert.equal(caps.families.pq, undefined);
	});

	it("applies pulled VRK records and puts local-only ids", async () => {
		const crypto = new WebCryptoProvider();
		const msk = await crypto.generateSigningKey("ed25519");
		const source = new Vault({ crypto });
		const dest = new Vault({ crypto });
		await source.createVault("p");
		await dest.createVault("p");
		const vrk = source.ensureVrk();
		dest.vrk = new Uint8Array(vrk);
		source.addKey({
			kind: "content",
			fingerprint: "remote-only",
			private_material: new Uint8Array([9, 8, 7]),
		});
		dest.addKey({
			kind: "content",
			fingerprint: "local-only",
			private_material: new Uint8Array([1, 2, 3]),
		});
		const remoteRecord = await encodeVaultRecord(
			crypto,
			vrk,
			source.getKeyByFingerprint("remote-only"),
		);
		const ops = [];
		const client = new PubkeyClient({
			crypto,
			vault: dest,
			readBaseUrl: "https://pubkey.test",
			writeBaseUrl: "https://api.pubkey.test",
			fetchImpl: async (_url, init) => {
				const body = JSON.parse(init.body);
				ops.push(body.operation);
				if (body.operation === OPERATIONS.vault_list) {
					return new Response(
						JSON.stringify({ record_ids: [remoteRecord.record_id] }),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				if (body.operation === OPERATIONS.vault_get_records) {
					return new Response(
						JSON.stringify({ records: [remoteRecord] }),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				return new Response(JSON.stringify({ stored: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});
		const result = await client.syncVault({
			email: "alice@example.com",
			mskKey: msk,
			persistSecret: "pw",
		});
		assert.deepEqual(result.applied, ["remote-only"]);
		assert.equal(dest.getKeyByFingerprint("remote-only").fingerprint, "remote-only");
		assert.ok(ops.includes(OPERATIONS.vault_put_record));
		assert.ok(ops.includes(OPERATIONS.vault_get_records));
	});
});

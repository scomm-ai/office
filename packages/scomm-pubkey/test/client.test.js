import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { PubkeyClient } from "../src/client.js";
import { Vault } from "../src/vault/vault.js";
import { encodeVaultRecord } from "../src/crypto/enrollment.js";
import { PgpEngine } from "../src/engines/pgp.js";
import {
	encodeX25519Spki,
	frameDecryptChallengeCiphertext,
} from "../src/crypto/encryption-pop.js";
import { OPERATIONS, ARTIFACT_POP_OPERATION, encodeBase64Url, decodeBase64Url, canonicalSignedBytes, bytesToHex, sha256Bytes } from "@scomm/pubkey-protocol";

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

	it("posts signing keys to /v1/keys/signing with artifact_pop self_signature", async () => {
		const crypto = new WebCryptoProvider();
		const msk = await crypto.generateSigningKey("ed25519");
		const contentKey = await crypto.generateSigningKey("ed25519");
		/** @type {object | null} */
		let captured = null;
		const client = new PubkeyClient({
			crypto,
			readBaseUrl: "https://pubkey.test",
			writeBaseUrl: "https://api.pubkey.test",
			fetchImpl: async (url, init) => {
				captured = { url, body: JSON.parse(init.body) };
				return new Response(JSON.stringify({ key_id: 2, status: "active" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});
		const artifact = {
			family: "pgp",
			purpose: "signing",
			algorithm: "openpgp-ed25519",
			public_material: encodeBase64Url(contentKey.publicKey),
		};
		await client.setSigningKeyWithProof({
			email: "alice@example.com",
			artifact,
			mskKey: msk,
			contentSigningKey: contentKey,
		});
		assert.equal(captured.url, "https://api.pubkey.test/v1/keys/signing");
		assert.equal(captured.body.operation, OPERATIONS.set_signing_key);
		const sent = captured.body.payload.artifacts[0];
		const popBytes = await canonicalSignedBytes({
			protocolVersion: 1,
			operation: ARTIFACT_POP_OPERATION,
			principal: captured.body.principal,
			timestamp: captured.body.timestamp,
			nonce: captured.body.nonce,
			payload: {
				algorithm: artifact.algorithm,
				family: artifact.family,
				purpose: artifact.purpose,
				public_material_sha256: bytesToHex(
					await sha256Bytes(decodeBase64Url(artifact.public_material)),
				),
			},
		});
		assert.equal(
			await crypto.verify(
				contentKey.publicKey,
				popBytes,
				decodeBase64Url(sent.self_signature.value),
				"ed25519",
			),
			true,
		);
	});

	it("publishes OpenPGP encryption keys via challenge then /v1/keys/encryption", async () => {
		const crypto = new WebCryptoProvider();
		const caps = await crypto.capabilities();
		if (!caps.keyAgreement.includes("x25519")) {
			return;
		}
		const msk = await crypto.generateSigningKey("ed25519");
		const pgpEngine = new PgpEngine(crypto);
		const generated = await pgpEngine.generateKey({ email: "alice@example.com" });
		const subkey = await pgpEngine.extractX25519EncryptionSubkey(generated.privateKey);
		assert.equal(subkey.scalar.length, 32);
		assert.equal(subkey.publicKey.length, 32);

		const eph = await crypto.generateKey({ algorithm: "x25519" });
		const shared = await crypto.deriveSecret(eph, subkey.publicKey);
		const aesKey = await crypto.hash("sha-256", shared);
		const nonce = crypto.random(16);
		const box = await crypto.encryptAead(aesKey, nonce);
		const wrapped = frameDecryptChallengeCiphertext(box);

		const urls = [];
		/** @type {object | null} */
		let upload = null;
		const client = new PubkeyClient({
			crypto,
			pgpEngine,
			readBaseUrl: "https://pubkey.test",
			writeBaseUrl: "https://api.pubkey.test",
			fetchImpl: async (url, init) => {
				urls.push(url);
				if (String(url).endsWith("/v1/keys/encryption/challenge")) {
					return new Response(
						JSON.stringify({
							challenge_id: "chal-1",
							ciphertext: encodeBase64Url(wrapped),
							ephemeral_public: encodeBase64Url(encodeX25519Spki(eph.publicKey)),
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				upload = JSON.parse(init.body);
				return new Response(JSON.stringify({ key_id: 9, status: "active" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});

		const result = await client.publishEncryptionKey({
			email: "alice@example.com",
			artifact: {
				family: "pgp",
				purpose: "encryption",
				algorithm: "openpgp-cv25519",
				public_material: encodeBase64Url(generated.publicKey),
			},
			privateKey: generated.privateKey,
			mskKey: msk,
		});
		assert.equal(result.key_id, 9);
		assert.deepEqual(urls, [
			"https://api.pubkey.test/v1/keys/encryption/challenge",
			"https://api.pubkey.test/v1/keys/encryption",
		]);
		assert.equal(upload.operation, OPERATIONS.set_encryption_key);
		assert.equal(upload.payload.artifacts[0].decrypt_proof.challenge_id, "chal-1");
		assert.deepEqual(
			decodeBase64Url(upload.payload.artifacts[0].decrypt_proof.plaintext),
			nonce,
		);
	});
});

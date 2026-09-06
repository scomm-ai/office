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

	describe("server-synced vault (/v1/vault/*)", () => {
		it("uploadVault posts a vault_upload mutation, not vault_put_record", async () => {
			const crypto = new WebCryptoProvider();
			const msk = await crypto.generateSigningKey("ed25519");
			const vault = new Vault({ crypto });
			await vault.createVault("p");
			vault.ensureVrk();
			vault.addKey({
				kind: "content",
				fingerprint: "fp1",
				private_material: new Uint8Array([1, 2, 3]),
			});

			let seenBody;
			const client = new PubkeyClient({
				crypto,
				vault,
				readBaseUrl: "https://pubkey.test",
				writeBaseUrl: "https://api.pubkey.test",
				fetchImpl: async (url, init) => {
					assert.equal(url, "https://api.pubkey.test/v1/mutate");
					seenBody = JSON.parse(init.body);
					return new Response(
						JSON.stringify({ generation: 1, created_at: "2026-01-01T00:00:00Z" }),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				},
			});

			await client.uploadVault({ email: "alice@example.com", mskKey: msk });

			assert.equal(seenBody.operation, OPERATIONS.vault_upload);
			assert.equal(seenBody.payload.generation, 1);
			assert.equal(seenBody.payload.previous_generation_hash, null);
			assert.equal(typeof seenBody.payload.ciphertext, "string");
			assert.equal(typeof seenBody.payload.ciphertext_hash, "string");
			assert.equal(typeof seenBody.payload.msk_signature, "string");
			assert.equal(vault.generation, 1);
			assert.ok(vault.lastCiphertextHash instanceof Uint8Array);
		});

		it("round-trips a real upload/download cycle between two devices sharing a VRK", async () => {
			const cryptoA = new WebCryptoProvider();
			const cryptoB = new WebCryptoProvider();
			const msk = await cryptoA.generateSigningKey("ed25519");
			const mskPublicKey = encodeBase64Url(msk.publicKey);

			const deviceA = new Vault({ crypto: cryptoA });
			await deviceA.createVault("p");
			const vrk = deviceA.ensureVrk();
			deviceA.addKey({
				kind: "content",
				fingerprint: "from-a",
				private_material: new Uint8Array([9, 9, 9]),
			});

			// One in-memory server row, mirroring vaultService.ts's uploadVault
			// (hash-chain bookkeeping) / getCurrentVault (adds msk_public_key).
			let stored = null;
			function fakeServer(url, init) {
				const u = new URL(url);
				if (init?.method === "POST" && u.pathname === "/v1/mutate") {
					const body = JSON.parse(init.body);
					assert.equal(body.operation, OPERATIONS.vault_upload);
					stored = { ...body.payload };
					return new Response(
						JSON.stringify({ generation: stored.generation, created_at: "now" }),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				if (u.pathname.endsWith("/current")) {
					if (!stored) {
						return new Response(JSON.stringify({ vault: null }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}
					return new Response(
						JSON.stringify({ vault: { ...stored, msk_public_key: mskPublicKey } }),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
			}

			const clientA = new PubkeyClient({
				crypto: cryptoA,
				vault: deviceA,
				readBaseUrl: "https://pubkey.test",
				writeBaseUrl: "https://pubkey.test",
				fetchImpl: fakeServer,
			});
			await clientA.uploadVault({ email: "alice@example.com", mskKey: msk });
			assert.equal(deviceA.generation, 1);

			// Device B already has the VRK (e.g. via device pairing) but hasn't
			// synced yet.
			const deviceB = new Vault({ crypto: cryptoB });
			await deviceB.createVault("p");
			deviceB.vrk = new Uint8Array(vrk);
			const clientB = new PubkeyClient({
				crypto: cryptoB,
				vault: deviceB,
				readBaseUrl: "https://pubkey.test",
				writeBaseUrl: "https://pubkey.test",
				fetchImpl: fakeServer,
			});

			const generation = await clientB.downloadCurrentVault({ email: "alice@example.com" });
			assert.equal(generation, 1);
			assert.equal(deviceB.getKeyByFingerprint("from-a")?.fingerprint, "from-a");
			assert.equal(deviceB.generation, 1);
		});
	});

	describe("device pairing", () => {
		it("createPairingSession posts to /v1/pairing/:sessionId, not /v1/device-enrollments", async () => {
			const crypto = new WebCryptoProvider();
			/** @type {object[]} */
			const calls = [];
			const client = new PubkeyClient({
				crypto,
				readBaseUrl: "https://pubkey.test",
				writeBaseUrl: "https://api.pubkey.test",
				fetchImpl: async (url, init) => {
					calls.push({ url, init });
					return new Response(
						JSON.stringify({ session_id: "TESTCODE", state: "PENDING", expires_at: "2026-01-01T00:00:00Z" }),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				},
			});

			const started = await client.createPairingSession({
				email: "alice@example.com",
				deviceName: "Outlook",
				requestedTier: "limited",
				sessionId: "TESTCODE",
			});

			assert.equal(calls.length, 1);
			assert.equal(calls[0].url, "https://api.pubkey.test/v1/pairing/TESTCODE");
			assert.equal(calls[0].init.method, "POST");
			const body = JSON.parse(calls[0].init.body);
			assert.equal(body.device_name, "Outlook");
			assert.equal(body.requested_tier, "limited");
			assert.equal(typeof body.b_ephemeral_public_key, "string");
			assert.equal(typeof body.device_id, "string");
			assert.equal(started.sessionId, "TESTCODE");
			assert.equal(started.pairingCode, "TESTCODE");
		});

		it("round-trips a VRK transfer between two clients via a fake /v1/pairing/* mailbox", async () => {
			// One in-memory pairing session shared by device A (responder,
			// already has the vault) and device B (the new device), exactly
			// mirroring pairingService.ts's state machine: PENDING ->
			// RESPONDED -> COMPLETED, with the one-time RESPONDED retrieval
			// gated on B's own device id.
			let session = { state: "PENDING" };

			function fakeServer(url, init) {
				const u = new URL(url);
				if (init?.method === "POST" && u.pathname === "/v1/pairing/TESTCODE") {
					const body = JSON.parse(init.body);
					session = {
						state: "PENDING",
						b_ephemeral_public_key: body.b_ephemeral_public_key,
						device_id: body.device_id,
					};
					return new Response(
						JSON.stringify({ session_id: "TESTCODE", state: "PENDING", expires_at: "2026-01-01T00:00:00Z" }),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}
				if (init?.method === "PUT" && u.pathname === "/v1/pairing/TESTCODE/response") {
					const body = JSON.parse(init.body);
					session = {
						...session,
						state: "RESPONDED",
						a_ephemeral_public_key: body.a_ephemeral_public_key,
						vek_envelope: body.vek_envelope,
						aek_envelope: body.aek_envelope,
					};
					return new Response(JSON.stringify({ session_id: "TESTCODE", state: "RESPONDED" }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				if (u.pathname === "/v1/pairing/TESTCODE") {
					const retrieverDeviceId = u.searchParams.get("retriever_device_id");
					if (session.state === "RESPONDED" && retrieverDeviceId === session.device_id) {
						const responded = session;
						session = { ...session, state: "COMPLETED" };
						return new Response(JSON.stringify({ session_id: "TESTCODE", ...responded }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}
					return new Response(JSON.stringify({ session_id: "TESTCODE", state: session.state }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
			}

			const cryptoA = new WebCryptoProvider();
			const cryptoB = new WebCryptoProvider();
			const clientA = new PubkeyClient({
				crypto: cryptoA,
				writeBaseUrl: "https://api.pubkey.test",
				fetchImpl: fakeServer,
			});
			const clientB = new PubkeyClient({
				crypto: cryptoB,
				writeBaseUrl: "https://api.pubkey.test",
				fetchImpl: fakeServer,
			});

			const started = await clientB.createPairingSession({
				email: "alice@example.com",
				deviceName: "Outlook",
				requestedTier: "full",
				sessionId: "TESTCODE",
			});

			const vrk = cryptoA.random(32);
			const aek = cryptoA.random(32);
			await clientA.respondToPairingSession({
				email: "alice@example.com",
				sessionId: "TESTCODE",
				peerEphemeralPublicKey: session.b_ephemeral_public_key,
				vrk,
				aek,
			});

			const unwrapped = await clientB.completePairingAsNewDevice({
				email: "alice@example.com",
				sessionId: "TESTCODE",
				ephemeral: started.ephemeral,
				deviceId: started.deviceId,
				pollIntervalMs: 1,
			});

			assert.deepEqual(unwrapped.vrk, vrk);
			assert.deepEqual(unwrapped.aek, aek);
			assert.equal(session.state, "COMPLETED");
		});
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

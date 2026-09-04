import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { PubkeyClient } from "../src/client.js";
import { Vault } from "../src/vault/vault.js";
import { OPERATIONS, encodeBase64Url } from "@scomm/pubkey-protocol";

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
});

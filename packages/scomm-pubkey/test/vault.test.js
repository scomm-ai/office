import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { MemoryVaultStore } from "../src/vault/store.js";
import { Vault, wrapMskWithAek, unwrapMskWithAek } from "../src/vault/vault.js";
import { PubkeyError } from "../src/errors.js";

describe("Vault", () => {
	it("exports, imports, and retains historical keys", async () => {
		const crypto = new WebCryptoProvider();
		const store = new MemoryVaultStore();
		const vault = new Vault({ crypto, store });
		await vault.createVault("9a28dce8-36a8-8cad-a0e2-8eaaa8c6d976");
		const msk = await crypto.generateSigningKey("ed25519");
		const portable = await crypto.exportPrivateKey(msk);
		vault.setMskEnvelope({
			envelope_version: 1,
			algorithm: "ed25519",
			public_key: "pub",
			encrypted_msk: "ct",
			wraps: [],
		});
		vault.addKey({
			kind: "content",
			key_id: 1,
			family: "pgp",
			purpose: "encryption",
			algorithm: "openpgp-cv25519",
			fingerprint: "k1",
			status: "retired",
			private_material: new Uint8Array([1, 2, 3]),
		});
		vault.addKey({
			kind: "content",
			key_id: 2,
			family: "pq",
			purpose: "kem",
			algorithm: "pqc-mlkem-768",
			fingerprint: "k2",
			status: "active",
			private_material: new Uint8Array([4, 5, 6]),
		});

		const exported = await vault.exportVault("correct horse battery staple");
		assert.equal(exported.vault_format_version, 1);
		assert.equal(typeof exported.ciphertext, "string");
		assert.equal(JSON.stringify(exported).includes("private_material"), false);

		const restored = new Vault({ crypto, store: new MemoryVaultStore() });
		await restored.importVault(exported, "correct horse battery staple");
		assert.equal(restored.getHistoricalKey(1).fingerprint, "k1");
		assert.equal(restored.getCurrentKey("kem").key_id, 2);
		assert.ok(restored.getMsk());
	});

	it("unions different fingerprints even when generation key_id matches", async () => {
		const crypto = new WebCryptoProvider();
		const vault = new Vault({ crypto });
		await vault.createVault("9a28dce8-36a8-8cad-a0e2-8eaaa8c6d976");
		vault.addKey({
			kind: "content",
			key_id: 1,
			purpose: "encryption",
			fingerprint: "aaa",
			private_material: new Uint8Array([1]),
			status: "active",
		});
		vault.addKey({
			kind: "content",
			key_id: 1,
			purpose: "encryption",
			fingerprint: "bbb",
			private_material: new Uint8Array([2]),
			status: "active",
		});
		assert.equal(vault.listKeys().length, 2);
	});

	it("rejects the same fingerprint with different secret material", async () => {
		const crypto = new WebCryptoProvider();
		const vault = new Vault({ crypto });
		await vault.createVault("9a28dce8-36a8-8cad-a0e2-8eaaa8c6d976");
		vault.addKey({
			kind: "content",
			key_id: 1,
			purpose: "encryption",
			fingerprint: "aaa",
			private_material: new Uint8Array([1]),
			status: "active",
		});
		assert.throws(
			() =>
				vault.addKey({
					kind: "content",
					key_id: 2,
					purpose: "encryption",
					fingerprint: "aaa",
					private_material: new Uint8Array([2]),
					status: "active",
				}),
			(err) => err instanceof PubkeyError && err.code === "vault_integrity",
		);
	});

	it("exports and imports a password-wrapped single-key package", async () => {
		const crypto = new WebCryptoProvider();
		const source = new Vault({ crypto });
		const target = new Vault({ crypto });
		await source.createVault("p");
		await target.createVault("p");
		source.addKey({
			kind: "content",
			key_id: 3,
			family: "pgp",
			locator: "ab12cd34ef567890",
			purpose: "encryption",
			fingerprint: "fp-1",
			private_material: new Uint8Array([9, 8, 7]),
			status: "active",
		});
		const pkg = await source.exportKeyPackage("fp-1", "transfer-pass");
		assert.equal(pkg.kind, "scomm-key-package");
		assert.equal(pkg.locator, "AB12-CD34-EF56-7890");
		assert.equal(JSON.stringify(pkg).includes("private_material"), false);
		await target.importKeyPackage(pkg, "transfer-pass");
		assert.equal(target.getKeyByFingerprint("fp-1").locator, "AB12-CD34-EF56-7890");
	});

	it("merges the union of historical keys", async () => {
		const crypto = new WebCryptoProvider();
		const a = new Vault({ crypto });
		const b = new Vault({ crypto });
		await a.createVault("p");
		await b.createVault("p");
		a.addKey({
			kind: "content",
			key_id: 1,
			purpose: "encryption",
			fingerprint: "one",
			status: "retired",
		});
		b.addKey({
			kind: "content",
			key_id: 2,
			purpose: "encryption",
			fingerprint: "two",
			status: "active",
		});
		a.merge(b);
		assert.equal(a.listKeys().length, 2);
		assert.equal(a.getHistoricalKey(1).fingerprint, "one");
	});

	it("throws vault_locked when locked and vault_authentication_failure on a bad passphrase", async () => {
		const crypto = new WebCryptoProvider();
		const store = new MemoryVaultStore();
		const vault = new Vault({ crypto, store });
		await vault.createVault("9a28dce8-36a8-8cad-a0e2-8eaaa8c6d976");
		vault.addKey({
			kind: "content",
			key_id: 1,
			purpose: "encryption",
			fingerprint: "k1",
			status: "retired",
			private_material: new Uint8Array([1, 2, 3]),
		});
		await vault.persist("correct horse battery staple");
		vault.lockVault();
		assert.throws(
			() => vault.listKeys(),
			(err) => err instanceof PubkeyError && err.code === "vault_locked",
		);

		const other = new Vault({ crypto, store });
		await assert.rejects(
			() => other.unlockVault("wrong passphrase"),
			(err) =>
				err instanceof PubkeyError &&
				err.code === "vault_authentication_failure",
		);

		await other.unlockVault("correct horse battery staple");
		assert.equal(other.getHistoricalKey(1).fingerprint, "k1");
		assert.deepEqual(other.getHistoricalKey(1).private_material, new Uint8Array([1, 2, 3]));
	});

	it("persists a VRK and rejects different secrets for the same fingerprint", async () => {
		const crypto = new WebCryptoProvider();
		const store = new MemoryVaultStore();
		const vault = new Vault({ crypto, store });
		await vault.createVault("p");
		const vrk = vault.ensureVrk();
		assert.equal(vrk.length, 32);
		vault.addKey({
			kind: "content",
			fingerprint: "same",
			private_material: new Uint8Array([1]),
		});
		assert.throws(
			() =>
				vault.addKey({
					kind: "content",
					fingerprint: "same",
					private_material: new Uint8Array([2]),
				}),
			(err) => err instanceof PubkeyError && err.code === "vault_integrity",
		);
		await vault.persist("pw");
		const other = new Vault({ crypto, store });
		await other.unlockVault("pw");
		assert.deepEqual(other.vrk, vrk);
	});

	describe("CKVF-spec vault ciphertext (cross-client interop)", () => {
		it("round-trips a PGP content key through exportVaultCiphertext/decryptVaultCiphertext", async () => {
			const crypto = new WebCryptoProvider();
			const vault = new Vault({ crypto });
			await vault.createVault("p");
			const vrk = vault.ensureVrk();
			vault.addKey({
				kind: "content",
				family: "pgp",
				purpose: "encryption",
				algorithm: "openpgp-cv25519",
				fingerprint: "fp1",
				locator: "loc1",
				private_material: new Uint8Array([1, 2, 3]),
			});

			const { iv, ciphertext } = await vault.exportVaultCiphertext(vrk);
			const snapshot = await vault.decryptVaultCiphertext(vrk, iv, ciphertext);

			assert.equal(snapshot.entries.length, 1);
			const [entry] = snapshot.entries;
			assert.equal(entry.family, "pgp");
			assert.equal(entry.purpose, "encryption");
			assert.equal(entry.fingerprint, "fp1");
			assert.deepEqual(entry.private_material, new Uint8Array([1, 2, 3]));
			assert.equal(entry.status, "active");
		});

		it("decrypts a secMail10-shaped vault ciphertext (openpgp_keys array, AEK-wrapped MSK)", async () => {
			// Hand-builds the exact plaintext shape secMail10's
			// `Vault.exportVault(vek)` produces (packages/scomm_pubkey/lib/src/
			// vault/vault.dart + vault_plaintext.dart on the Dart side) — this is
			// the regression test for the bug where office's old flat
			// `{entries: [...]}` schema silently produced zero entries against a
			// real secMail10 vault.
			const crypto = new WebCryptoProvider();
			const vrk = crypto.random(32);
			const aek = crypto.random(32);
			const rawMsk = crypto.random(32);
			const mskWrap = await wrapMskWithAek(crypto, aek, rawMsk);

			const secMail10Plaintext = {
				vault_format_version: 1,
				generation: 3,
				principal: "p",
				created_at: 1000,
				updated_at: 2000,
				current_signing_key_id: null,
				current_encryption_key_id: 5,
				msk_envelope: {
					envelope_version: 1,
					algorithm: "ed25519",
					public_key: "abc",
					created_at: 1000,
					iv: mskWrap.iv,
					encrypted_msk: mskWrap.encrypted_msk,
				},
				openpgp_keys: [
					{
						key_id: "5",
						type: "encryption",
						status: "active",
						created_at: 1500,
						private_key: "AQIDBA", // base64url("\x01\x02\x03\x04")
						fingerprint: "fp-from-secmail10",
						algorithm: "openpgp-cv25519",
					},
				],
				smime_keys: [],
				signing_keys: [],
				legacy_entries: [],
				metadata: { devices: [] },
			};
			const { iv, ciphertext } = await crypto.encryptAead(
				vrk,
				new TextEncoder().encode(JSON.stringify(secMail10Plaintext)),
			);

			const vault = new Vault({ crypto });
			const snapshot = await vault.decryptVaultCiphertext(vrk, iv, ciphertext);

			assert.equal(snapshot.entries.length, 1);
			assert.equal(snapshot.entries[0].fingerprint, "fp-from-secmail10");
			assert.equal(snapshot.entries[0].family, "pgp");
			assert.equal(snapshot.entries[0].purpose, "encryption");
			assert.ok(snapshot.mskEnvelope.iv, "mskEnvelope should carry the AEK-wrap iv");

			const recovered = await unwrapMskWithAek(crypto, aek, snapshot.mskEnvelope);
			assert.deepEqual(recovered, rawMsk);
		});

		it("wrapMskWithAek/unwrapMskWithAek round-trip and fail closed on the wrong AEK", async () => {
			const crypto = new WebCryptoProvider();
			const aek = crypto.random(32);
			const wrongAek = crypto.random(32);
			const msk = crypto.random(32);
			const wrapped = await wrapMskWithAek(crypto, aek, msk);

			assert.deepEqual(await unwrapMskWithAek(crypto, aek, wrapped), msk);
			await assert.rejects(
				() => unwrapMskWithAek(crypto, wrongAek, wrapped),
				(err) => err instanceof PubkeyError && err.code === "envelope_authentication_failure",
			);
		});
	});
});

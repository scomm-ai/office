import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { MemoryVaultStore } from "../src/vault/store.js";
import { Vault } from "../src/vault/vault.js";

/**
 * Cross-client vault consistency with secMail10
 * (`packages/scomm_pubkey/lib/src/vault/vault.dart`).
 *
 * A vault generation is a single shared document: whatever office uploads,
 * secMail10 downloads and applies verbatim, and vice versa. Every field
 * office does not understand still has to survive the round trip, and every
 * field it does write has to carry the type and meaning secMail10 reads.
 * Getting that wrong does not degrade gracefully — generations are immutable
 * and never deleted, so a bad upload stays the current generation until some
 * client manages to replace it.
 */

const PRINCIPAL = "9a28dce8-36a8-8cad-a0e2-8eaaa8c6d976";

async function newVault(crypto) {
	const vault = new Vault({ crypto, store: new MemoryVaultStore() });
	await vault.createVault(PRINCIPAL);
	return vault;
}

function contentKey(overrides) {
	return {
		kind: "content",
		family: "pgp",
		purpose: "encryption",
		algorithm: "openpgp-cv25519",
		status: "active",
		private_material: new Uint8Array([1, 2, 3]),
		...overrides,
	};
}

/** Decrypts what office would upload, as secMail10 would read it. */
async function uploadedPlaintext(crypto, vault, vrk) {
	const box = await vault.exportVaultCiphertext(vrk);
	const plain = await crypto.decryptAead(vrk, box.iv, box.ciphertext);
	return JSON.parse(new TextDecoder().decode(plain));
}

/** Builds the ciphertext secMail10 would have uploaded for `plaintext`. */
async function remoteBox(crypto, vrk, plaintext) {
	return crypto.encryptAead(vrk, new TextEncoder().encode(JSON.stringify(plaintext)));
}

function secmail10Plaintext(overrides = {}) {
	return {
		vault_format_version: 1,
		generation: 2,
		principal: PRINCIPAL,
		created_at: 1780000000000,
		updated_at: 1780000000001,
		current_signing_key_id: null,
		current_encryption_key_id: null,
		msk_envelope: null,
		openpgp_keys: [],
		smime_keys: [],
		signing_keys: [],
		legacy_entries: [],
		metadata: { devices: [] },
		...overrides,
	};
}

describe("Vault cross-client sync consistency", () => {
	it("serializes the canonical key pointers as strings, like every other key id", async () => {
		const crypto = new WebCryptoProvider();
		const vault = await newVault(crypto);
		vault.addKey(contentKey({ key_id: 5, fingerprint: "AAAA1111" }));
		vault.currentEncryptionKeyId = "5";
		vault.currentSigningKeyId = "7";

		const parsed = await uploadedPlaintext(crypto, vault, crypto.random(32));

		// secMail10 reads both of these with a `as String?` cast; a number
		// there throws a raw TypeError and the whole vault fails to load.
		assert.equal(parsed.current_encryption_key_id, "5");
		assert.equal(parsed.current_signing_key_id, "7");
	});

	it("round-trips the canonical key pointers instead of inventing one", async () => {
		const crypto = new WebCryptoProvider();
		const vrk = crypto.random(32);
		const vault = await newVault(crypto);

		// secMail10's user explicitly promoted key 5. Key 9 is newer and
		// active, but was deliberately never promoted — promotion is an
		// explicit, user-confirmed act, never "whichever key is newest".
		const box = await remoteBox(
			crypto,
			vrk,
			secmail10Plaintext({
				current_encryption_key_id: "5",
				openpgp_keys: [
					{ key_id: "5", type: "encryption", status: "active", fingerprint: "AAAA1111" },
					{ key_id: "9", type: "encryption", status: "active", fingerprint: "BBBB2222" },
				],
			}),
		);
		const snapshot = await vault.decryptVaultCiphertext(vrk, box.iv, box.ciphertext);
		vault.applyRemoteSnapshot(snapshot);

		assert.equal(vault.currentEncryptionKeyId, "5");
		const parsed = await uploadedPlaintext(crypto, vault, vrk);
		assert.equal(
			parsed.current_encryption_key_id,
			"5",
			"office must not re-point the identity's advertised key at whatever is newest",
		);
	});

	it("leaves the pointers unset when the remote has none", async () => {
		const crypto = new WebCryptoProvider();
		const vrk = crypto.random(32);
		const vault = await newVault(crypto);
		vault.addKey(contentKey({ key_id: 9, fingerprint: "BBBB2222" }));

		const parsed = await uploadedPlaintext(crypto, vault, vrk);
		assert.equal(parsed.current_encryption_key_id, null);
		assert.equal(parsed.current_signing_key_id, null);
	});

	it("honours a retirement made on another client, and re-uploads it as retired", async () => {
		const crypto = new WebCryptoProvider();
		const vrk = crypto.random(32);
		const vault = await newVault(crypto);
		vault.addKey(contentKey({ key_id: 5, fingerprint: "AAAA1111" }));

		const box = await remoteBox(
			crypto,
			vrk,
			secmail10Plaintext({
				openpgp_keys: [
					{
						key_id: "5",
						type: "encryption",
						// secMail10 spells 'retired' as the spec's 'historical'.
						status: "historical",
						fingerprint: "AAAA1111",
					},
				],
			}),
		);
		const snapshot = await vault.decryptVaultCiphertext(vrk, box.iv, box.ciphertext);
		vault.applyRemoteSnapshot(snapshot);

		assert.equal(
			vault.getKeyByFingerprint("AAAA1111").status,
			"retired",
			"a key the user deleted elsewhere must not stay live here",
		);
		const parsed = await uploadedPlaintext(crypto, vault, vrk);
		assert.equal(
			parsed.openpgp_keys[0].status,
			"historical",
			"re-uploading it as active resurrects a key the user deleted",
		);
	});

	it("never downgrades a local terminal status back to active", async () => {
		const crypto = new WebCryptoProvider();
		const vrk = crypto.random(32);
		const vault = await newVault(crypto);
		vault.addKey(contentKey({ key_id: 5, fingerprint: "AAAA1111", status: "retired" }));

		const box = await remoteBox(
			crypto,
			vrk,
			secmail10Plaintext({
				openpgp_keys: [
					{ key_id: "5", type: "encryption", status: "active", fingerprint: "AAAA1111" },
				],
			}),
		);
		const snapshot = await vault.decryptVaultCiphertext(vrk, box.iv, box.ciphertext);
		vault.applyRemoteSnapshot(snapshot);

		assert.equal(vault.getKeyByFingerprint("AAAA1111").status, "retired");
	});

	it("preserves metadata.devices it did not write", async () => {
		const crypto = new WebCryptoProvider();
		const vrk = crypto.random(32);
		const vault = await newVault(crypto);

		const devices = [
			{ device_id: "dev-a", name: "Phone", tier: "full", added_at: 1780000000000 },
			{ device_id: "dev-b", name: "Laptop", tier: "limited", added_at: 1780000000001 },
		];
		const box = await remoteBox(crypto, vrk, secmail10Plaintext({ metadata: { devices } }));
		const snapshot = await vault.decryptVaultCiphertext(vrk, box.iv, box.ciphertext);
		vault.applyRemoteSnapshot(snapshot);

		const parsed = await uploadedPlaintext(crypto, vault, vrk);
		assert.deepEqual(
			parsed.metadata.devices,
			devices,
			"secMail10 branches its device-compromise response on this list — " +
				"emptying it makes it think this is the only full-authority device",
		);
	});

	it("back-fills a server key id onto material it already holds", async () => {
		const crypto = new WebCryptoProvider();
		const vault = await newVault(crypto);

		// An encryption key lives in the vault unpublished, so it has no id...
		vault.addKey(contentKey({ fingerprint: "CCCC3333" }));
		// ...until publishing it re-adds the same material carrying the id the
		// server minted.
		vault.addKey(contentKey({ key_id: 42, fingerprint: "CCCC3333" }));

		assert.equal(vault.entries.length, 1, "still deduped by fingerprint");
		assert.equal(vault.entries[0].key_id, 42);
		assert.ok(vault.getKey(42), "otherwise every later lookup by key id misses");
	});

	it("treats an OpenPGP key id as the same key as its full fingerprint", async () => {
		const crypto = new WebCryptoProvider();
		const vault = await newVault(crypto);

		// office stores the full v4 fingerprint; secMail10 stores only the
		// low 64 bits (the OpenPGP key id) as its "fingerprint". Same key,
		// two spellings — an exact-string dedupe lets both into the vault and
		// every client then shows the one key twice.
		const full = "B9672B00A358358D562F62BB742F90F6713A6750";
		vault.addKey(contentKey({ key_id: 33, fingerprint: full }));
		vault.addKey(contentKey({ key_id: 33, fingerprint: full.slice(-16) }));

		assert.equal(vault.entries.length, 1);
		assert.ok(vault.findKeyByFingerprint(full.slice(-16)));
		assert.ok(vault.findKeyByFingerprint(full));
	});

	it("keeps genuinely different keys apart", async () => {
		const crypto = new WebCryptoProvider();
		const vault = await newVault(crypto);
		vault.addKey(contentKey({ key_id: 1, fingerprint: "AAAA1111BBBB2222" }));
		vault.addKey(
			contentKey({ key_id: 2, fingerprint: "CCCC3333DDDD4444", material: [9, 9] }),
		);
		assert.equal(vault.entries.length, 2);
	});

	it("never overwrites a key id already on the entry", async () => {
		const crypto = new WebCryptoProvider();
		const vault = await newVault(crypto);
		vault.addKey(contentKey({ key_id: 7, fingerprint: "CCCC3333" }));
		vault.addKey(contentKey({ key_id: 42, fingerprint: "CCCC3333" }));
		assert.equal(vault.entries[0].key_id, 7);
	});

	it("clears a canonical pointer when the key it names is retired", async () => {
		const crypto = new WebCryptoProvider();
		const vault = await newVault(crypto);
		vault.addKey(contentKey({ key_id: 5, fingerprint: "AAAA1111" }));
		vault.addKey(contentKey({ key_id: 9, fingerprint: "BBBB2222" }));
		vault.currentEncryptionKeyId = "5";

		vault.retireKey(9);
		assert.equal(vault.currentEncryptionKeyId, "5", "retiring another key changes nothing");

		vault.retireKey(5);
		assert.equal(
			vault.currentEncryptionKeyId,
			null,
			"a retired artifact is not discoverable, so it is not advertised",
		);
	});
});

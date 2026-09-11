import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { PgpEngine, createPgpEngine, matchDecryptionKeys } from "../src/engines/pgp.js";
import { PubkeyClient } from "../src/client.js";

describe("PgpEngine", () => {
	it("is available and advertises Curve25519 and PQC algorithms", () => {
		const engine = createPgpEngine(new WebCryptoProvider());
		assert.equal(engine.available, true);
		// Must be real directory-registry wire names (registry.dart algorithm_id
		// 116/117), not the "openpgp-pqc" generateKey() request-time selector —
		// this list is sent to the server as-is in discoveryCapabilities().
		assert.deepEqual(engine.advertisedAlgorithms, [
			"openpgp-cv25519",
			"openpgp-ed25519",
			"openpgp-mldsa65-ed25519",
			"openpgp-mlkem768-x25519",
		]);
	});

	it("generates a v4 key and round-trips encrypt/decrypt", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({
			name: "Alice",
			email: "alice@example.com",
		});
		assert.equal(alice.algorithm, "openpgp-cv25519");
		assert.match(alice.fingerprint, /^[0-9a-f]{40}$/);
		assert.equal(alice.publicKey[0] === 0x2d, false);

		const plaintext = "hello from outlook";
		const ciphertext = await engine.encrypt({
			plaintext,
			recipientPublicKey: alice.publicKey,
		});
		const armored = new TextDecoder().decode(ciphertext);
		assert.match(armored, /-----BEGIN PGP MESSAGE-----/);

		const decrypted = await engine.decrypt({
			ciphertext,
			privateKey: alice.privateKey,
		});
		assert.equal(new TextDecoder().decode(decrypted), plaintext);
	});

	it("exports a public key from a generated private key", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({ email: "alice@example.com" });
		const exported = await engine.exportPublicKey(alice.privateKey);
		assert.ok(exported.byteLength > 0);
		const ciphertext = await engine.encrypt({
			plaintext: "via exported public",
			recipientPublicKey: exported,
		});
		const decrypted = await engine.decrypt({
			ciphertext,
			privateKey: alice.privateKey,
		});
		assert.equal(new TextDecoder().decode(decrypted), "via exported public");
	});

	it("encrypts to multiple recipients including armor-as-utf8 wire material", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({ email: "alice@example.com" });
		const bob = await engine.generateKey({ email: "bob@example.com" });
		const openpgp = await import("openpgp");
		const bobKey = await openpgp.readKey({ binaryKey: bob.publicKey });
		const bobArmoredUtf8 = new TextEncoder().encode(bobKey.armor());

		const ciphertext = await engine.encrypt({
			plaintext: "two recipients",
			recipientPublicKeys: [alice.publicKey, bobArmoredUtf8],
		});
		assert.equal(
			new TextDecoder().decode(
				await engine.decrypt({ ciphertext, privateKey: alice.privateKey }),
			),
			"two recipients",
		);
		assert.equal(
			new TextDecoder().decode(
				await engine.decrypt({ ciphertext, privateKey: bob.privateKey }),
			),
			"two recipients",
		);
	});

	it("decrypts HTML-wrapped Outlook armor", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({ email: "alice@example.com" });
		const ciphertext = await engine.encrypt({
			plaintext: "html wrapped",
			recipientPublicKey: alice.publicKey,
		});
		const armored = new TextDecoder().decode(ciphertext);
		const html =
			`<html><body><div>-----BEGIN PGP MESS<span>AGE-----</span><br>\r\n` +
			armored
				.replace("-----BEGIN PGP MESSAGE-----", "")
				.replace("-----END PGP MESSAGE-----", "")
				.replaceAll("\n", "<br>\r\n") +
			`-----END PGP MESSAGE-----</div></body></html>`;
		const stripped = html
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<[^>]+>/g, "")
			.replace(/\r\n/g, "\n");
		const start = stripped.indexOf("-----BEGIN PGP MESSAGE-----");
		const end = stripped.indexOf("-----END PGP MESSAGE-----");
		const extracted = stripped.slice(start, end + "-----END PGP MESSAGE-----".length);
		const decrypted = await engine.decrypt({
			ciphertext: extracted,
			privateKey: alice.privateKey,
		});
		assert.equal(new TextDecoder().decode(decrypted), "html wrapped");
	});

	it("clearsigns and verifies with the generated key", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({ email: "alice@example.com" });
		const signed = await engine.sign({
			plaintext: "signed from outlook",
			privateKey: alice.privateKey,
		});
		const armor = new TextDecoder().decode(signed);
		assert.match(armor, /-----BEGIN PGP SIGNED MESSAGE-----/);
		const verified = await engine.verify({
			signed: armor,
			publicKeys: [alice.publicKey],
		});
		assert.equal(verified.valid, true);
		assert.equal(verified.plaintext, "signed from outlook");
	});

	it("creates a detached signature without embedding armor in the plaintext", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({ email: "alice@example.com" });
		const signed = await engine.sign({
			plaintext: "hello body",
			privateKey: alice.privateKey,
			detached: true,
		});
		const armor = new TextDecoder().decode(signed);
		assert.match(armor, /-----BEGIN PGP SIGNATURE-----/);
		assert.doesNotMatch(armor, /BEGIN PGP SIGNED MESSAGE/);
		assert.doesNotMatch(armor, /hello body/);
	});

	it("encrypts with an embedded signature", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({ email: "alice@example.com" });
		const ciphertext = await engine.encrypt({
			plaintext: "signed secret",
			recipientPublicKey: alice.publicKey,
			signingPrivateKey: alice.privateKey,
		});
		const decrypted = await engine.decrypt({
			ciphertext,
			privateKey: alice.privateKey,
		});
		assert.equal(new TextDecoder().decode(decrypted), "signed secret");
	});

	it("publishes a full multi-packet key: one primary key packet (tag 6) plus a distinct, correctly bound encryption subkey packet (tag 14) — never a stripped/single-packet key", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({ email: "alice@example.com" });
		const openpgp = await import("openpgp");

		const parsed = await openpgp.readKey({ binaryKey: alice.publicKey });
		assert.equal(parsed.isPrivate(), false);

		// Exactly one primary key (tag 6), with a User ID carrying a valid
		// self-certification.
		const primaryUser = await parsed.getPrimaryUser();
		assert.ok(primaryUser.user, "primary key must carry a certified User ID");
		assert.ok(primaryUser.selfCertification, "User ID must carry a self-certification signature");

		// Exactly primary + one subkey (tag 6 + tag 14), each with a
		// distinct key ID — never a stripped single-packet key.
		const allKeys = parsed.getKeys();
		assert.equal(allKeys.length, 2);
		const primaryId = parsed.getKeyID().toHex();
		const subkeys = allKeys.filter((k) => k.getKeyID().toHex() !== primaryId);
		assert.equal(subkeys.length, 1);

		// The encryption-capable key, resolved only via openpgp.js's own
		// binding-signature-verified API, must be the subkey (tag 14), not
		// the primary key (tag 6) — confirms tag 6 vs tag 14 were not
		// conflated when the key was generated/published.
		const encryptionKey = await parsed.getEncryptionKey();
		assert.notEqual(
			encryptionKey.getKeyID().toHex(),
			primaryId,
			"the encryption key must be the subkey, not the primary key",
		);
		assert.equal(encryptionKey.getKeyID().toHex(), subkeys[0].getKeyID().toHex());

		// The published material is the full key (primary + subkey + user ID
		// + signatures), not a bare subkey point — round-trips to the same
		// packet count/shape after re-serializing.
		const reserialized = parsed.toPacketList();
		assert.ok(reserialized.length >= 4, "expected primary, subkey, user ID, and signature packets");
	});

	it("matchDecryptionKeys selects only the vault key that actually matches the ciphertext's recipient key ID", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({ email: "alice@example.com" });
		const bob = await engine.generateKey({ email: "bob@example.com" });

		const ciphertext = await engine.encrypt({
			plaintext: "only for bob",
			recipientPublicKey: bob.publicKey,
		});

		const matches = await matchDecryptionKeys(ciphertext, [alice.privateKey, bob.privateKey]);
		assert.equal(matches.length, 1);
		assert.deepEqual(matches[0], bob.privateKey);
	});

	it("matchDecryptionKeys returns no matches when no candidate key fits", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({ email: "alice@example.com" });
		const bob = await engine.generateKey({ email: "bob@example.com" });
		const carol = await engine.generateKey({ email: "carol@example.com" });

		const ciphertext = await engine.encrypt({
			plaintext: "only for bob",
			recipientPublicKey: bob.publicKey,
		});

		const matches = await matchDecryptionKeys(ciphertext, [alice.privateKey, carol.privateKey]);
		assert.equal(matches.length, 0);
	});

	it("advertises pgp on PubkeyClient discovery only when the engine is wired", async () => {
		const crypto = new WebCryptoProvider();
		const without = new PubkeyClient({ crypto });
		const bare = await without.discoveryCapabilities();
		assert.equal(bare.families.pgp, undefined);

		const withEngine = new PubkeyClient({
			crypto,
			pgpEngine: new PgpEngine(crypto),
		});
		const caps = await withEngine.discoveryCapabilities();
		assert.deepEqual(caps.families.pgp, [
			"openpgp-cv25519",
			"openpgp-ed25519",
			"openpgp-mldsa65-ed25519",
			"openpgp-mlkem768-x25519",
		]);
	});

	it("extracts a native X25519 scalar that agrees with WebCrypto ECDH", async () => {
		const crypto = new WebCryptoProvider();
		const caps = await crypto.capabilities();
		if (!caps.keyAgreement.includes("x25519")) {
			return;
		}
		const engine = new PgpEngine(crypto);
		const generated = await engine.generateKey({ email: "alice@example.com" });
		const subkey = await engine.extractX25519EncryptionSubkey(generated.privateKey);
		assert.equal(subkey.scalar.length, 32);
		assert.equal(subkey.publicKey.length, 32);
		const imported = await crypto.importPrivateKey({
			algorithm: "x25519",
			encoding: "raw-32",
			bytes: subkey.scalar,
			publicKey: subkey.publicKey,
		});
		const eph = await crypto.generateKey({ algorithm: "x25519" });
		const ab = await crypto.deriveSecret(imported, eph.publicKey);
		const ba = await crypto.deriveSecret(eph, subkey.publicKey);
		assert.deepEqual(ab, ba);
	});

	it("generates an RFC 9980 PQC composite key (ML-DSA-65+Ed25519, ML-KEM-768+X25519)", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({
			name: "Alice",
			email: "alice@example.com",
			algorithm: "openpgp-pqc",
		});
		assert.equal(alice.algorithm, "openpgp-pqc");
		assert.match(alice.fingerprint, /^[0-9a-f]{64}$/);

		const plaintext = "post-quantum hello";
		const ciphertext = await engine.encrypt({
			plaintext,
			recipientPublicKey: alice.publicKey,
		});
		const decrypted = await engine.decrypt({
			ciphertext,
			privateKey: alice.privateKey,
		});
		assert.equal(new TextDecoder().decode(decrypted), plaintext);
	});

	it("clearsigns and verifies with a PQC composite key (ML-DSA-65+Ed25519)", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({
			name: "Alice",
			email: "alice@example.com",
			algorithm: "openpgp-pqc",
		});
		const signed = await engine.sign({
			plaintext: "post-quantum signed from outlook",
			privateKey: alice.privateKey,
		});
		const armor = new TextDecoder().decode(signed);
		assert.match(armor, /-----BEGIN PGP SIGNED MESSAGE-----/);
		const verified = await engine.verify({
			signed: armor,
			publicKeys: [alice.publicKey],
		});
		assert.equal(verified.valid, true);
		assert.equal(verified.plaintext, "post-quantum signed from outlook");

		// Tampering must still fail verification against the composite signature.
		const tampered = armor.replace(
			"post-quantum signed from outlook",
			"post-quantum tampered message",
		);
		const verifiedTampered = await engine.verify({
			signed: tampered,
			publicKeys: [alice.publicKey],
		});
		assert.equal(verifiedTampered.valid, false);
	});

	it("full lifecycle: two PQC identities encrypt+sign to each other and decrypt+verify", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		const alice = await engine.generateKey({
			name: "Alice",
			email: "alice@example.com",
			algorithm: "openpgp-pqc",
		});
		const bob = await engine.generateKey({
			name: "Bob",
			email: "bob@example.com",
			algorithm: "openpgp-pqc",
		});

		// Alice signs-and-encrypts to Bob.
		const ciphertext = await engine.encrypt({
			plaintext: "meet at dawn",
			recipientPublicKey: bob.publicKey,
			signingPrivateKey: alice.privateKey,
		});
		const decrypted = await engine.decrypt({
			ciphertext,
			privateKey: bob.privateKey,
		});
		assert.equal(new TextDecoder().decode(decrypted), "meet at dawn");

		// Bob replies with a detached signature Alice can verify independently.
		const detached = await engine.sign({
			plaintext: "acknowledged",
			privateKey: bob.privateKey,
			detached: true,
		});
		assert.doesNotMatch(new TextDecoder().decode(detached), /BEGIN PGP SIGNED MESSAGE/);
	});

	it("rejects an unknown algorithm, including the pre-PQC 'openpgp-mlkem-x25519' spelling", async () => {
		const engine = new PgpEngine(new WebCryptoProvider());
		await assert.rejects(
			engine.generateKey({ email: "alice@example.com", algorithm: "openpgp-mlkem-x25519" }),
			/cannot generate/i,
		);
	});

	it("extracts the classical Ed25519/X25519 halves of a PQC composite key for the MSK PoP flow", async () => {
		const crypto = new WebCryptoProvider();
		const caps = await crypto.capabilities();
		if (!caps.keyAgreement.includes("x25519")) {
			return;
		}
		const engine = new PgpEngine(crypto);
		const generated = await engine.generateKey({
			email: "alice@example.com",
			algorithm: "openpgp-pqc",
		});

		const sig = await engine.extractEd25519SigningKey(generated.privateKey);
		assert.equal(sig.seed.length, 32);
		assert.equal(sig.publicKey.length, 32);

		const subkey = await engine.extractX25519EncryptionSubkey(generated.privateKey);
		assert.equal(subkey.scalar.length, 32);
		assert.equal(subkey.publicKey.length, 32);
		const imported = await crypto.importPrivateKey({
			algorithm: "x25519",
			encoding: "raw-32",
			bytes: subkey.scalar,
			publicKey: subkey.publicKey,
		});
		const eph = await crypto.generateKey({ algorithm: "x25519" });
		const ab = await crypto.deriveSecret(imported, eph.publicKey);
		const ba = await crypto.deriveSecret(eph, subkey.publicKey);
		assert.deepEqual(ab, ba);
	});
});

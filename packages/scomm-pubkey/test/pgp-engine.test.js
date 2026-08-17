import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { PgpEngine, createPgpEngine } from "../src/engines/pgp.js";
import { PubkeyClient } from "../src/client.js";

describe("PgpEngine", () => {
	it("is available and advertises Curve25519 algorithms", () => {
		const engine = createPgpEngine(new WebCryptoProvider());
		assert.equal(engine.available, true);
		assert.deepEqual(engine.advertisedAlgorithms, [
			"openpgp-cv25519",
			"openpgp-ed25519",
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
		assert.deepEqual(caps.families.pgp, ["openpgp-cv25519", "openpgp-ed25519"]);
	});
});

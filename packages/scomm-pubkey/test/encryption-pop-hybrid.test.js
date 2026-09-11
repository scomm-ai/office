import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { encodeBase64Url } from "@scomm/pubkey-protocol";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { PgpEngine } from "../src/engines/pgp.js";
import { PqEngine } from "../src/engines/pq.js";
import {
	encodeX25519Spki,
	frameDecryptChallengeCiphertext,
	solveHybridDecryptChallenge,
} from "../src/crypto/encryption-pop.js";

describe("hybrid PQC (ML-KEM-768+X25519) proof-of-possession", () => {
	it("recovers the wrapped nonce from a server-shaped hybrid challenge", async () => {
		const crypto = new WebCryptoProvider();
		const caps = await crypto.capabilities();
		if (!caps.keyAgreement.includes("x25519")) {
			return;
		}
		const pgpEngine = new PgpEngine(crypto);
		const pqEngine = new PqEngine(crypto);

		const generated = await pgpEngine.generateKey({
			email: "alice@example.com",
			algorithm: "openpgp-pqc",
		});

		// Read the raw public halves the "server" would encapsulate/ECDH to,
		// the same way the pubkey directory would from the published artifact.
		const openpgp = await import("openpgp");
		const key = await openpgp.readKey({ binaryKey: generated.publicKey });
		const encKey = await key.getEncryptionKey();
		const eccPublicKey = encKey.keyPacket.publicParams.eccPublicKey;
		const mlkemPublicKey = encKey.keyPacket.publicParams.mlkemPublicKey;

		// Simulate the server's half of the challenge: KEM-encapsulate to the
		// ML-KEM public key, ECDH with a fresh ephemeral X25519 key, combine
		// exactly as solveHybridDecryptChallenge expects (mlkem || x25519, SHA-256),
		// then AES-GCM-wrap a random nonce.
		const { cipherText: kemCiphertext, sharedSecret: mlkemShared } =
			ml_kem768.encapsulate(mlkemPublicKey);
		const serverEph = await crypto.generateKey({ algorithm: "x25519" });
		const x25519Shared = await crypto.deriveSecret(serverEph, eccPublicKey);
		const combined = new Uint8Array(64);
		combined.set(mlkemShared, 0);
		combined.set(x25519Shared, 32);
		const aesKey = await crypto.hash("sha-256", combined);
		const nonce = crypto.random(16);
		const box = await crypto.encryptAead(aesKey, nonce);
		const wrapped = frameDecryptChallengeCiphertext(box);

		const challenge = {
			challenge_id: "c1",
			ciphertext: encodeBase64Url(wrapped),
			ephemeral_public: encodeBase64Url(encodeX25519Spki(serverEph.publicKey)),
			kem_ciphertext: encodeBase64Url(kemCiphertext),
		};

		// Client side: exactly what PubkeyClient.publishEncryptionKey now does.
		const subkey = await pgpEngine.extractX25519EncryptionSubkey(generated.privateKey);
		const agreementKey = await crypto.importPrivateKey({
			algorithm: "x25519",
			encoding: "raw-32",
			bytes: subkey.scalar,
			publicKey: subkey.publicKey,
		});
		const mlkemSeed = await pgpEngine.extractMlkemSeed(generated.privateKey);

		const recovered = await solveHybridDecryptChallenge(
			crypto,
			pqEngine,
			agreementKey,
			mlkemSeed,
			challenge,
		);
		assert.deepEqual(recovered, nonce);
	});

	it("extractMlkemSeed returns undefined for a classical (non-PQC) key", async () => {
		const crypto = new WebCryptoProvider();
		const pgpEngine = new PgpEngine(crypto);
		const classical = await pgpEngine.generateKey({ email: "alice@example.com" });
		const seed = await pgpEngine.extractMlkemSeed(classical.privateKey);
		assert.equal(seed, undefined);
	});
});

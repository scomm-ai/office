import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeBase64Url } from "@scomm/pubkey-protocol";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import {
	encodeX25519Spki,
	frameDecryptChallengeCiphertext,
	solveDecryptChallenge,
	stripX25519Public,
	SPKI_X25519_PREFIX,
} from "../src/crypto/encryption-pop.js";

describe("encryption proof-of-possession", () => {
	it("strips SPKI and OpenPGP MPI prefixes from X25519 public points", () => {
		const raw = new Uint8Array(32).fill(7);
		assert.deepEqual(stripX25519Public(raw), raw);
		assert.deepEqual(stripX25519Public(encodeX25519Spki(raw)), raw);
		const mpi = new Uint8Array(33);
		mpi[0] = 0x40;
		mpi.set(raw, 1);
		assert.deepEqual(stripX25519Public(mpi), raw);
		assert.equal(SPKI_X25519_PREFIX.length, 12);
	});

	it("recovers the wrapped nonce from a server-shaped challenge", async () => {
		const crypto = new WebCryptoProvider();
		const caps = await crypto.capabilities();
		if (!caps.keyAgreement.includes("x25519")) {
			return;
		}
		const recipient = await crypto.generateKey({ algorithm: "x25519" });
		const eph = await crypto.generateKey({ algorithm: "x25519" });
		const shared = await crypto.deriveSecret(eph, recipient.publicKey);
		const aesKey = await crypto.hash("sha-256", shared);
		const nonce = crypto.random(16);
		const box = await crypto.encryptAead(aesKey, nonce);
		const wrapped = frameDecryptChallengeCiphertext(box);
		const recovered = await solveDecryptChallenge(crypto, recipient, {
			challenge_id: "c1",
			ciphertext: encodeBase64Url(wrapped),
			ephemeral_public: encodeBase64Url(encodeX25519Spki(eph.publicKey)),
		});
		assert.deepEqual(recovered, nonce);
		const nested = await solveDecryptChallenge(crypto, recipient, {
			success: true,
			data: {
				challenge_id: "c1",
				ciphertext: encodeBase64Url(wrapped),
				ephemeral_public: encodeBase64Url(encodeX25519Spki(eph.publicKey)),
			},
		});
		assert.deepEqual(nested, nonce);
	});
});

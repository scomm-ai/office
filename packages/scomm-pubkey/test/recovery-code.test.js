import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import {
	RECOVERY_SALT_BYTES,
	deriveRecoveryKey,
	deriveRecoveryKeyFromEnvelope,
	generateRecoveryCode,
	normalizeRecoveryCode,
	unwrapWithRecoveryKey,
	wrapWithRecoveryKey,
} from "../src/crypto/recovery-code.js";

describe("recovery code", () => {
	it("generates a 32-character Crockford base32 code", () => {
		const crypto = new WebCryptoProvider();
		const code = generateRecoveryCode(crypto);
		assert.equal(code.length, 32);
		assert.match(code, /^[0-9A-HJKMNP-TV-Z]+$/);
	});

	it("normalizes whitespace/dashes and case the same way a user might re-type it", () => {
		assert.equal(normalizeRecoveryCode(" h4kq-p2rm 7tdx "), "H4KQP2RM7TDX");
	});

	it("wraps and unwraps a secret under a REK derived from the code", async () => {
		const crypto = new WebCryptoProvider();
		const code = generateRecoveryCode(crypto);
		const salt = crypto.random(RECOVERY_SALT_BYTES);
		const secret = crypto.random(32);

		const rek = await deriveRecoveryKey(crypto, code, salt);
		const envelope = await wrapWithRecoveryKey(crypto, rek, secret, { salt });

		assert.equal(envelope.kdf, "argon2id");
		assert.equal(envelope.kdf_params.memory, 19456);
		assert.equal(envelope.kdf_params.iterations, 3);
		assert.equal(envelope.kdf_params.parallelism, 1);
		assert.ok(typeof envelope.salt === "string" && envelope.salt.length > 0);
		assert.ok(typeof envelope.iv === "string" && envelope.iv.length > 0);
		assert.ok(typeof envelope.ciphertext === "string" && envelope.ciphertext.length > 0);

		const rekFromEnvelope = await deriveRecoveryKeyFromEnvelope(crypto, code, envelope);
		const unwrapped = await unwrapWithRecoveryKey(crypto, rekFromEnvelope, envelope);
		assert.deepEqual(unwrapped, secret);
	});

	it("shares one salt/REK across vek and aek, matching the server's single-kdf-params-per-principal storage", async () => {
		const crypto = new WebCryptoProvider();
		const code = generateRecoveryCode(crypto);
		const salt = crypto.random(RECOVERY_SALT_BYTES);
		const vrk = crypto.random(32);
		const aek = crypto.random(32);

		const rek = await deriveRecoveryKey(crypto, code, salt);
		const vekEnvelope = await wrapWithRecoveryKey(crypto, rek, vrk, { salt });
		const aekEnvelope = await wrapWithRecoveryKey(crypto, rek, aek, { salt });
		assert.equal(vekEnvelope.salt, aekEnvelope.salt);

		const rekFromEnvelope = await deriveRecoveryKeyFromEnvelope(crypto, code, vekEnvelope);
		assert.deepEqual(await unwrapWithRecoveryKey(crypto, rekFromEnvelope, vekEnvelope), vrk);
		assert.deepEqual(await unwrapWithRecoveryKey(crypto, rekFromEnvelope, aekEnvelope), aek);
	});

	it("throws envelope_authentication_failure on a wrong recovery code, not a weaker fallback", async () => {
		const crypto = new WebCryptoProvider();
		const code = generateRecoveryCode(crypto);
		const wrongCode = generateRecoveryCode(crypto);
		const salt = crypto.random(RECOVERY_SALT_BYTES);
		const secret = crypto.random(32);

		const rek = await deriveRecoveryKey(crypto, code, salt);
		const envelope = await wrapWithRecoveryKey(crypto, rek, secret, { salt });

		const wrongRek = await deriveRecoveryKeyFromEnvelope(crypto, wrongCode, envelope);
		await assert.rejects(
			() => unwrapWithRecoveryKey(crypto, wrongRek, envelope),
			(err) => err.code === "envelope_authentication_failure",
		);
	});
});

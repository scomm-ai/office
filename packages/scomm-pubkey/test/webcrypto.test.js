import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
	CRYPTO_OPERATIONS,
	KEY_PROTECTION,
	canonicalSignedBytes,
	decodeBase64Url,
} from "@scomm/pubkey-protocol";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import { PubkeyError } from "../src/errors.js";

const fixtures = JSON.parse(
	readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"../../scomm-pubkey-protocol/fixtures/signed-requests.json",
		),
		"utf8",
	),
);

describe("WebCryptoProvider", () => {
	it("reports probed capabilities without advertising WASM or OpenSSL", async () => {
		const provider = new WebCryptoProvider();
		const caps = await provider.capabilities();
		assert.equal(caps.id, "webcrypto");
		assert.equal(caps.kind, "platform");
		assert.ok(caps.sign.includes("ed25519"));
		assert.ok(caps.aead.includes("aes-256-gcm"));
		assert.equal(caps.kem.length, 0);
		assert.equal(caps.wasm, undefined);
	});

	it("generates Ed25519 keys and verifies signatures", async () => {
		const cryptoProvider = new WebCryptoProvider();
		const key = await cryptoProvider.generateSigningKey("ed25519");
		assert.equal(key.publicKey.length, 32);
		assert.equal(key.provider, "webcrypto");
		assert.equal(key.extractable, true);
		assert.equal(key.protection, KEY_PROTECTION.software);
		const payload = await canonicalSignedBytes({
			protocolVersion: 1,
			operation: "set_keys",
			principal: "9a28dce8-36a8-8cad-a0e2-8eaaa8c6d976",
			timestamp: 1780000000000,
			nonce: "AAAAAAAAAAAAAAAAAAAAAA",
			payload: { ok: true },
		});
		const signature = await cryptoProvider.sign(key, payload);
		assert.equal(
			await cryptoProvider.verify(key.publicKey, payload, signature, "ed25519"),
			true,
		);
		payload[0] ^= 1;
		assert.equal(
			await cryptoProvider.verify(key.publicKey, payload, signature, "ed25519"),
			false,
		);
	});

	it("verifies the shared Ed25519 fixture signature", async () => {
		const cryptoProvider = new WebCryptoProvider();
		const vector = fixtures.vectors[0];
		const payload = await canonicalSignedBytes({
			protocolVersion: vector.envelope.protocol_version,
			operation: vector.envelope.operation,
			principal: vector.envelope.principal,
			timestamp: vector.envelope.timestamp,
			nonce: vector.envelope.nonce,
			payload: vector.envelope.payload,
		});
		const ok = await cryptoProvider.verify(
			decodeBase64Url(fixtures.msk.public_key_base64url),
			payload,
			decodeBase64Url(vector.signature_base64url),
			"ed25519",
		);
		assert.equal(ok, true);
	});

	it("keeps non-extractable keys as opaque handles", async () => {
		const cryptoProvider = new WebCryptoProvider();
		const key = await cryptoProvider.generateSigningKey("ed25519", {
			extractable: false,
		});
		assert.equal(key.extractable, false);
		const payload = new TextEncoder().encode("opaque");
		const signature = await cryptoProvider.sign(key, payload);
		assert.equal(
			await cryptoProvider.verify(key.publicKey, payload, signature),
			true,
		);
		await assert.rejects(
			() => cryptoProvider.exportPrivateKey(key),
			(err) => err instanceof PubkeyError && err.code === "key_not_exportable",
		);
	});

	it("exports extractable keys for Vault portability", async () => {
		const cryptoProvider = new WebCryptoProvider();
		const key = await cryptoProvider.generateSigningKey("ed25519");
		const portable = await cryptoProvider.exportPrivateKey(key);
		assert.equal(portable.bytes.length, 32);
		const imported = await cryptoProvider.importPrivateKey(portable);
		const payload = new TextEncoder().encode("roundtrip");
		const signature = await cryptoProvider.sign(imported, payload);
		assert.equal(
			await cryptoProvider.verify(key.publicKey, payload, signature),
			true,
		);
	});

	it("generateDeviceKey falls back to software without a native provider", async () => {
		const cryptoProvider = new WebCryptoProvider();
		const key = await cryptoProvider.generateDeviceKey({ extractable: true });
		assert.equal(key.protection, KEY_PROTECTION.software);
		assert.equal(key.publicKey.length, 32);
	});

	it("refuses hardware-backed generation instead of silently downgrading", async () => {
		const cryptoProvider = new WebCryptoProvider();
		await assert.rejects(
			() =>
				cryptoProvider.generateSigningKey("ed25519", {
					protection: KEY_PROTECTION.hardwareBacked,
				}),
			(err) =>
				err instanceof PubkeyError &&
				err.code === "hardware_protection_unavailable",
		);
		assert.equal(
			await cryptoProvider.supports(CRYPTO_OPERATIONS.sign, "ed25519", {
				protection: KEY_PROTECTION.hardwareBacked,
			}),
			false,
		);
	});

	it("performs key agreement when the host supports it", async () => {
		const cryptoProvider = new WebCryptoProvider();
		const caps = await cryptoProvider.capabilities();
		if (!caps.keyAgreement.includes("x25519") && !caps.keyAgreement.includes("p-256")) {
			return;
		}
		const algorithm = caps.keyAgreement.includes("x25519") ? "x25519" : "p-256";
		const alice = await cryptoProvider.generateKey({
			algorithm,
			purpose: "key-agreement",
			extractable: false,
		});
		const bob = await cryptoProvider.generateKey({
			algorithm,
			purpose: "key-agreement",
			extractable: false,
		});
		const ab = await cryptoProvider.deriveSecret(alice, bob.publicKey);
		const ba = await cryptoProvider.deriveSecret(bob, alice.publicKey);
		assert.deepEqual(ab, ba);
		assert.ok(ab.length > 0);
	});

	it("hashes with SHA-256", async () => {
		const cryptoProvider = new WebCryptoProvider();
		const digest = await cryptoProvider.hash(
			"sha-256",
			new TextEncoder().encode("abc"),
		);
		assert.equal(digest.length, 32);
		assert.equal(
			[...digest].map((b) => b.toString(16).padStart(2, "0")).join(""),
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});

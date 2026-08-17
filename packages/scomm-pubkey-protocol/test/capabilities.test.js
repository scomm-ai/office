import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyCapabilityPolicy,
	protocolFamiliesFromPrimitives,
} from "../src/capabilities.js";

describe("protocolFamiliesFromPrimitives", () => {
	it("does not advertise PGP merely because Ed25519 signing exists", () => {
		const caps = protocolFamiliesFromPrimitives({
			sign: ["ed25519"],
			aead: ["aes-256-gcm"],
		});
		assert.deepEqual(caps.families, {});
	});

	it("does not invent an S/MIME family from key-agreement primitives alone", () => {
		const caps = protocolFamiliesFromPrimitives({
			keyAgreement: ["x25519", "p-256"],
		});
		assert.deepEqual(caps.families, {});
	});

	it("maps X25519 / P-256 to S/MIME only when an S/MIME engine is present", () => {
		const caps = protocolFamiliesFromPrimitives({
			keyAgreement: ["x25519", "p-256"],
			engines: { smime: true },
		});
		assert.deepEqual(caps.families.smime, ["smime-x25519", "smime-ecdh-p256"]);
		assert.equal(caps.families.pgp, undefined);
		assert.equal(caps.families.pq, undefined);
	});

	it("maps ML-KEM to smime-mlkem-* and never invents a pq family", () => {
		const caps = protocolFamiliesFromPrimitives({
			kem: ["ml-kem-768"],
			engines: { smime: true },
		});
		assert.deepEqual(caps.families.smime, ["smime-mlkem-768"]);
		assert.equal(caps.families.pq, undefined);
	});
});

describe("applyCapabilityPolicy", () => {
	it("refuses a required S/MIME family when no S/MIME algorithms are available", () => {
		assert.throws(
			() =>
				applyCapabilityPolicy(
					{ families: { pgp: ["openpgp-cv25519"] } },
					{ smime: "required" },
				),
			(err) => err.code === "capability_mismatch",
		);
	});

	it("keeps classical families when S/MIME is only preferred", () => {
		const result = applyCapabilityPolicy(
			{ families: { pgp: ["openpgp-cv25519"] } },
			{ smime: "preferred" },
		);
		assert.deepEqual(result.families, { pgp: ["openpgp-cv25519"] });
	});

	it("strips a leftover pq family from advertised capabilities", () => {
		const result = applyCapabilityPolicy({
			families: { pq: ["pqc-mlkem-768"], smime: ["smime-x25519"] },
		});
		assert.deepEqual(result.families, { smime: ["smime-x25519"] });
	});
});

import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
	canonicalSignedUtf8,
	payloadSha256Hex,
} from "../src/canonical.js";
import { canonicalizeJson } from "../src/jcs.js";

const fixtures = JSON.parse(
	readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"../fixtures/signed-requests.json",
		),
		"utf8",
	),
);

describe("signed-requests fixtures", () => {
	for (const vector of fixtures.vectors) {
		it(vector.id, async () => {
			const env = vector.envelope;
			assert.equal(canonicalizeJson(env.payload), vector.payload_jcs);
			assert.equal(await payloadSha256Hex(env.payload), vector.payload_sha256);
			const utf8 = await canonicalSignedUtf8({
				protocolVersion: env.protocol_version,
				operation: env.operation,
				principal: env.principal,
				timestamp: env.timestamp,
				nonce: env.nonce,
				payload: env.payload,
			});
			assert.equal(utf8, vector.canonical_utf8);

			const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
			const pub = Buffer.concat([
				spkiPrefix,
				Buffer.from(fixtures.msk.public_key_hex, "hex"),
			]);
			const key = createPublicKey({ key: pub, format: "der", type: "spki" });
			const ok = verify(
				null,
				Buffer.from(utf8, "utf8"),
				key,
				Buffer.from(vector.signature_base64url, "base64url"),
			);
			assert.equal(ok, true);
		});
	}
});

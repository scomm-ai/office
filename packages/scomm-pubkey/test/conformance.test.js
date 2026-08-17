import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
	canonicalSignedUtf8,
	canonicalizeJson,
	normalizeEmail,
	payloadSha256Hex,
	principalFromEmail,
	selectBestArtifact,
} from "@scomm/pubkey-protocol";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const fixturesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../scomm-pubkey-protocol/fixtures",
);

function load(name) {
	return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

describe("JS SDK conformance", () => {
	it("matches identity fixtures", async () => {
		const fixtures = load("normalized-identities.json");
		for (const vector of fixtures.vectors) {
			assert.equal(normalizeEmail(vector.input), vector.canonical);
			assert.equal(await principalFromEmail(vector.input), vector.principal);
		}
	});

	it("matches signed-request canonical bytes", async () => {
		const fixtures = load("signed-requests.json");
		for (const vector of fixtures.vectors) {
			const env = vector.envelope;
			assert.equal(canonicalizeJson(env.payload), vector.payload_jcs);
			assert.equal(await payloadSha256Hex(env.payload), vector.payload_sha256);
			assert.equal(
				await canonicalSignedUtf8({
					protocolVersion: env.protocol_version,
					operation: env.operation,
					principal: env.principal,
					timestamp: env.timestamp,
					nonce: env.nonce,
					payload: env.payload,
				}),
				vector.canonical_utf8,
			);
		}
	});

	it("matches capability negotiation", () => {
		const fixtures = load("capability-negotiation.json");
		for (const testCase of fixtures.cases) {
			const selected = selectBestArtifact(
				testCase.artifacts,
				testCase.capabilities,
				testCase.preferences,
			);
			if (testCase.expected === null) {
				assert.equal(selected, null);
			} else {
				assert.equal(selected.key_id, testCase.expected.key_id);
			}
		}
	});

	it("does not depend on Office.js", () => {
		assert.equal(pkg.dependencies["office-js"], undefined);
		assert.equal(pkg.dependencies["@microsoft/office-js"], undefined);
		const src = readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), "../src/index.js"),
			"utf8",
		);
		assert.equal(src.includes("office-js"), false);
		assert.equal(src.includes("Office."), false);
	});
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { selectBestArtifact } from "../src/registry.js";
import { ERROR_CODE_LIST } from "../src/errors.js";

const fixtures = JSON.parse(
	readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"../fixtures/capability-negotiation.json",
		),
		"utf8",
	),
);

describe("capability-negotiation fixtures", () => {
	for (const testCase of fixtures.cases) {
		it(testCase.id, () => {
			const selected = selectBestArtifact(
				testCase.artifacts,
				testCase.capabilities,
				testCase.preferences,
			);
			if (testCase.expected === null) {
				assert.equal(selected, null);
				return;
			}
			assert.equal(selected.key_id, testCase.expected.key_id);
			assert.equal(selected.family, testCase.expected.family);
			assert.equal(selected.algorithm, testCase.expected.algorithm);
		});
	}
});

describe("error codes", () => {
	it("includes the required machine-readable codes", () => {
		for (const code of [
			"invalid_signature",
			"unknown_principal",
			"master_key_not_armed",
			"timestamp_out_of_window",
			"nonce_replayed",
			"unsupported_protocol_version",
			"otp_invalid",
			"provider_unavailable",
			"hardware_protection_unavailable",
			"key_not_exportable",
			"vault_locked",
			"vault_corrupt",
			"vault_authentication_failure",
			"capability_mismatch",
		]) {
			assert.ok(ERROR_CODE_LIST.includes(code), code);
		}
	});
});

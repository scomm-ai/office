import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
	isValidEmail,
	normalizeEmail,
	emailSha256Hex,
	principalFromEmail,
	requireCanonicalEmail,
} from "../src/identity.js";

const fixtures = JSON.parse(
	readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"../fixtures/normalized-identities.json",
		),
		"utf8",
	),
);

describe("normalized-identities fixtures", () => {
	for (const vector of fixtures.vectors) {
		it(vector.id, async () => {
			assert.equal(normalizeEmail(vector.input), vector.canonical);
			assert.equal(await emailSha256Hex(vector.canonical), vector.sha256);
			assert.equal(await principalFromEmail(vector.input), vector.principal);
		});
	}

	it("accepts valid mailboxes", () => {
		for (const email of fixtures.valid) {
			assert.equal(isValidEmail(email), true, email);
		}
	});

	it("rejects invalid mailboxes", () => {
		for (const email of fixtures.invalid) {
			assert.equal(isValidEmail(email), false, email);
		}
	});

	it("requireCanonicalEmail rejects non-canonical input", () => {
		assert.equal(requireCanonicalEmail("alice@example.com"), "alice@example.com");
		assert.throws(
			() => requireCanonicalEmail("Alice@example.com"),
			(err) => err.code === "email_not_canonical",
		);
	});
});

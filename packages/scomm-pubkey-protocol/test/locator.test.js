import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatOpenPgpLocator, formatSmimeLocator, normalizeHex } from "../src/locator.js";

describe("locators", () => {
	it("formats a 64-bit OpenPGP Key-ID as grouped hex", () => {
		assert.equal(formatOpenPgpLocator("ab12cd34ef567890"), "AB12-CD34-EF56-7890");
		assert.equal(formatOpenPgpLocator("AB12 CD34 EF56 7890"), "AB12-CD34-EF56-7890");
	});

	it("uses the last 16 hex chars of a longer fingerprint", () => {
		assert.equal(
			formatOpenPgpLocator("0011223344556677AB12CD34EF567890"),
			"AB12-CD34-EF56-7890",
		);
	});

	it("normalizes S/MIME cert ids", () => {
		assert.equal(formatSmimeLocator("0xab:cd:12"), "ABCD12");
		assert.equal(normalizeHex("de:ad"), "DEAD");
	});
});

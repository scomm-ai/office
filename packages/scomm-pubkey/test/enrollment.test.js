import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PubkeyClient } from "../src/client.js";
import { WebCryptoProvider } from "../src/crypto/webcrypto.js";
import {
	mustNotGenerateMsk,
	resolveIdentityUxState,
	IDENTITY_UX_STATES,
} from "@scomm/pubkey-protocol";

describe("enrollment policy", () => {
	it("rejects OTP vault recover", async () => {
		const client = new PubkeyClient({ crypto: new WebCryptoProvider() });
		await assert.rejects(
			() => client.requestVaultRecover({ email: "a@b.com" }),
			(err) => err.code === "otp_not_device_enrollment",
		);
	});

	it("does not silently generate an MSK for an existing principal", () => {
		assert.equal(
			mustNotGenerateMsk({
				principalExists: true,
				localMsk: false,
				explicitRecovery: false,
			}),
			true,
		);
		assert.equal(
			resolveIdentityUxState({
				principalExists: true,
				localMsk: null,
				deviceAuthorized: false,
			}),
			IDENTITY_UX_STATES.unauthorized,
		);
	});
});

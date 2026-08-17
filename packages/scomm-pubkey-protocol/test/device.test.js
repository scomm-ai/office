import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	canonicalizeDeviceAuthorization,
	deviceAuthorizationPayload,
	FULL_DEVICE_PERMISSIONS,
	mustNotGenerateMsk,
	resolveIdentityUxState,
	IDENTITY_UX_STATES,
	enrollmentQrPayload,
	canonicalizeEnrollmentQr,
	createMskEnvelopeSkeleton,
	wrapForDevice,
	revokeDeviceWraps,
	mergeRecordIndexes,
} from "../src/index.js";

describe("device authorization", () => {
	it("canonicalizes permissions in sorted order", () => {
		const a = canonicalizeDeviceAuthorization({
			principalId: "p",
			deviceId: "d",
			devicePublicKey: "pub",
			createdAt: 1,
			permissions: ["sync_vault", "decrypt_mail"],
			nonce: "n",
		});
		const b = canonicalizeDeviceAuthorization({
			principalId: "p",
			deviceId: "d",
			devicePublicKey: "pub",
			createdAt: 1,
			permissions: ["decrypt_mail", "sync_vault"],
			nonce: "n",
		});
		assert.equal(a, b);
		assert.deepEqual(deviceAuthorizationPayload({
			principalId: "p",
			deviceId: "d",
			devicePublicKey: "pub",
			createdAt: 1,
			nonce: "n",
		}).permissions, [...FULL_DEVICE_PERMISSIONS].sort());
	});
});

describe("identity UX", () => {
	it("never treats missing local MSK as create-identity when principal exists", () => {
		assert.equal(
			mustNotGenerateMsk({ principalExists: true, localMsk: false, explicitRecovery: false }),
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

describe("enrollment QR", () => {
	it("omits secrets and is deterministic", () => {
		const payload = enrollmentQrPayload({
			sessionId: "s",
			devicePublicKey: "d",
			ephemeralPublicKey: "e",
			expiry: 9,
			commitment: "c",
		});
		assert.equal(payload.msk_private_key, undefined);
		assert.equal(
			canonicalizeEnrollmentQr(payload),
			canonicalizeEnrollmentQr({
				sessionId: "s",
				devicePublicKey: "d",
				ephemeralPublicKey: "e",
				expiry: 9,
				commitment: "c",
			}),
		);
	});
});

describe("MSK envelope", () => {
	it("keeps wraps separate from mail keys and supports revoke", () => {
		let envelope = createMskEnvelopeSkeleton({
			publicKey: "pub",
			createdAt: 1,
			encryptedMsk: "ct",
			wraps: [{ device_id: "a", wrapped_cek: "w1" }],
		});
		envelope = wrapForDevice(envelope, { device_id: "b", wrapped_cek: "w2" });
		assert.equal(envelope.wraps.length, 2);
		envelope = revokeDeviceWraps(envelope, "a");
		assert.deepEqual(envelope.revoked_device_ids, ["a"]);
		assert.equal(envelope.wraps[0].device_id, "b");
	});
});

describe("vault records", () => {
	it("merges record ids without loss", () => {
		assert.deepEqual(mergeRecordIndexes(["b"], ["a", "b"]), ["a", "b"]);
	});
});

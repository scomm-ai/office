import {
	DEVICE_KEY_ALGORITHM,
	ENROLLMENT_STATE,
	FULL_DEVICE_PERMISSIONS,
	MSK_ALGORITHM,
	OPERATIONS,
	PROTOCOL_VERSION,
	applyCapabilityPolicy,
	canonicalSignedBytes,
	decodeBase64Url,
	deviceAuthorizationPayload,
	encodeBase64Url,
	mustNotGenerateMsk,
	normalizeEmail,
	principalFromEmail,
	requireCanonicalEmail,
	resolveIdentityUxState,
} from "@scomm/pubkey-protocol";
import { pubkeyFetch, joinUrl } from "./http.js";
import { PubkeyError } from "./errors.js";
import { protocolCapabilitiesFromProvider } from "./crypto/registry.js";
import {
	buildEnrollmentQr,
	encryptEnrollmentPayload,
	decryptEnrollmentPayload,
	deriveEnrollmentSessionKeys,
	encodeVaultRecord,
	decodeVaultRecord,
	generateDeviceKey,
	generateEnrollmentEphemeral,
	generateMSK,
	wrapMSKForDevice,
	wrapVrkForDevice,
} from "./crypto/enrollment.js";

function decodePeer(value) {
	return value instanceof Uint8Array ? value : decodeBase64Url(value);
}

function randomNonce() {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return encodeBase64Url(bytes);
}

/**
 * Headless Pubkey SDK client. Reconstruct from Vault + CryptoProvider per event.
 */
export class PubkeyClient {
	constructor({
		readBaseUrl = "https://pubkey.scomm.ai",
		writeBaseUrl = "https://api.pubkey.scomm.ai",
		crypto,
		vault,
		pgpEngine,
		smimeEngine,
		sdkName = "scomm-pubkey-js",
		sdkVersion = "1.0.0",
		fetchImpl,
	} = {}) {
		if (!crypto) {
			throw new TypeError("PubkeyClient requires a CryptoProvider");
		}
		this.readBaseUrl = readBaseUrl;
		this.writeBaseUrl = writeBaseUrl;
		this.crypto = crypto;
		this.vault = vault;
		this.pgpEngine = pgpEngine;
		this.smimeEngine = smimeEngine;
		this.sdkName = sdkName;
		this.sdkVersion = sdkVersion;
		this.fetchImpl = fetchImpl;
	}

	async enrollMsk({ email, mskPublicKey }) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		return pubkeyFetch(joinUrl(this.writeBaseUrl, "/v1/msk/enroll"), {
			method: "POST",
			body: {
				email: canonical,
				msk: {
					algorithm: MSK_ALGORITHM,
					public_key: encodeBase64Url(mskPublicKey),
				},
			},
			fetch: this.fetchImpl,
		});
	}

	async verifyEnroll({
		email,
		otp,
		captcha,
		mskKey,
		device,
	}) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonical);
		const proof = await this._signOperation({
			operation: OPERATIONS.arm_msk,
			principal,
			payload: { email: canonical },
			key: mskKey,
		});
		let firstDevice;
		if (device) {
			firstDevice = await this._signDeviceAuthorization({
				email,
				mskKey,
				device,
			});
		}
		return pubkeyFetch(joinUrl(this.writeBaseUrl, "/v1/msk/enroll/verify"), {
			method: "POST",
			body: {
				email: canonical,
				otp,
				captcha,
				msk_proof: proof,
				first_device: firstDevice,
			},
			fetch: this.fetchImpl,
		});
	}

	async replaceMsk({ email, mskPublicKey }) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		return pubkeyFetch(joinUrl(this.writeBaseUrl, "/v1/msk/replace"), {
			method: "POST",
			body: {
				email: canonical,
				msk: {
					algorithm: MSK_ALGORITHM,
					public_key: encodeBase64Url(mskPublicKey),
				},
			},
			fetch: this.fetchImpl,
		});
	}

	async verifyReplace({ email, otp, captcha, mskKey, device }) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonical);
		const proof = await this._signOperation({
			operation: OPERATIONS.arm_replacement_msk,
			principal,
			payload: { email: canonical },
			key: mskKey,
		});
		let recoveryDevice;
		if (device) {
			recoveryDevice = await this._signDeviceAuthorization({
				email,
				mskKey,
				device,
			});
		}
		return pubkeyFetch(joinUrl(this.writeBaseUrl, "/v1/msk/replace/verify"), {
			method: "POST",
			body: {
				email: canonical,
				otp,
				captcha,
				msk_proof: proof,
				recovery_device: recoveryDevice,
			},
			fetch: this.fetchImpl,
		});
	}

	async mutate({ email, operation, payload, mskKey }) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonical);
		const envelope = await this._signOperation({
			operation,
			principal,
			payload,
			key: mskKey,
		});
		return pubkeyFetch(joinUrl(this.writeBaseUrl, "/v1/mutate"), {
			method: "POST",
			body: envelope,
			fetch: this.fetchImpl,
		});
	}

	async setKeys({ email, artifacts, mskKey }) {
		return this.mutate({
			email,
			operation: OPERATIONS.set_keys,
			payload: { artifacts },
			mskKey,
		});
	}

	async retireKey({ email, keyId, mskKey }) {
		return this.mutate({
			email,
			operation: OPERATIONS.retire_key,
			payload: { key_id: keyId },
			mskKey,
		});
	}

	async updatePreferences({ email, preferences, mskKey }) {
		return this.mutate({
			email,
			operation: OPERATIONS.update_preferences,
			payload: preferences,
			mskKey,
		});
	}

	async discoveryCapabilities(policy) {
		const engines = {
			pgp: this.pgpEngine?.available === true,
			smime: this.smimeEngine?.available === true,
		};
		const mapped = await protocolCapabilitiesFromProvider(
			this.crypto,
			policy,
			engines,
		);
		const families = { ...(mapped.families ?? {}) };
		if (engines.pgp && this.pgpEngine?.advertisedAlgorithms?.length) {
			families.pgp = [...this.pgpEngine.advertisedAlgorithms];
		}
		if (engines.smime && this.smimeEngine?.advertisedAlgorithms?.length) {
			families.smime = [...this.smimeEngine.advertisedAlgorithms];
		}
		return applyCapabilityPolicy({ families }, policy);
	}

	async getBestKey({
		email,
		sha256,
		principal,
		purpose,
		capabilities,
		capabilityPolicy,
	}) {
		const params = new URLSearchParams();
		if (sha256) params.set("sha256", sha256);
		if (principal) params.set("principal", principal);
		if (purpose) params.set("purpose", purpose);
		if (email) params.set("email", requireCanonicalEmail(normalizeEmail(email)));
		const resolved =
			capabilities ?? (await this.discoveryCapabilities(capabilityPolicy));
		params.set("capabilities", JSON.stringify(resolved));
		return pubkeyFetch(
			joinUrl(this.readBaseUrl, `/v1/keys?${params.toString()}`),
			{ fetch: this.fetchImpl },
		);
	}

	async reportVaultCoverage({
		email,
		mskKey,
		deviceId,
		platform,
		locators,
		fingerprints,
	}) {
		return this.mutate({
			email,
			operation: OPERATIONS.report_vault_coverage,
			payload: {
				device_id: deviceId,
				platform,
				locators,
				fingerprints,
			},
			mskKey,
		});
	}

	async vaultPut({ email, blob, expectedRevision, mskKey }) {
		return this.mutate({
			email,
			operation: OPERATIONS.vault_put,
			payload: { blob, expected_revision: expectedRevision },
			mskKey,
		});
	}

	async vaultGet({ email, mskKey }) {
		return this.mutate({
			email,
			operation: OPERATIONS.vault_get,
			payload: {},
			mskKey,
		});
	}

	async vaultHead({ email, mskKey }) {
		return this.mutate({
			email,
			operation: OPERATIONS.vault_head,
			payload: {},
			mskKey,
		});
	}

	async vaultDisable({ email, mskKey }) {
		return this.mutate({
			email,
			operation: OPERATIONS.vault_disable,
			payload: {},
			mskKey,
		});
	}

	async requestVaultRecover() {
		throw new PubkeyError(
			"otp_not_device_enrollment",
			"OTP cannot recover a vault or enroll a device",
		);
	}

	async verifyVaultRecover() {
		return this.requestVaultRecover();
	}

	identityState(input) {
		return resolveIdentityUxState(input);
	}

	assertNoSilentMsk(input) {
		if (mustNotGenerateMsk(input)) {
			throw new PubkeyError(
				"master_key_replacement_requires_otp",
				"Existing identity requires device transfer or explicit recovery",
			);
		}
	}

	async beginDeviceEnrollment({ email, device, rendezvous }) {
		const deviceKey = device?.identityKey ?? (await generateDeviceKey(this.crypto));
		const wrapKey =
			device?.wrapKey ??
			(await this.crypto.generateKey({
				algorithm: "x25519",
				purpose: "key-agreement",
				extractable: false,
			}));
		const ephemeral = await generateEnrollmentEphemeral(this.crypto);
		const sessionId = encodeBase64Url(this.crypto.random(16));
		const qr = await buildEnrollmentQr(this.crypto, {
			sessionId,
			devicePublicKey: deviceKey.publicKey,
			ephemeral,
			rendezvous: rendezvous ?? { write_base: this.writeBaseUrl },
		});
		const created = await pubkeyFetch(
			joinUrl(this.writeBaseUrl, "/v1/device-enrollments"),
			{
				method: "POST",
				body: {
					email: requireCanonicalEmail(normalizeEmail(email)),
					qr,
					device_public_key: encodeBase64Url(deviceKey.publicKey),
					device_wrap_public_key: encodeBase64Url(wrapKey.publicKey),
					device_key_algorithm: DEVICE_KEY_ALGORITHM,
				},
				fetch: this.fetchImpl,
			},
		);
		return {
			...created,
			state: ENROLLMENT_STATE.qrCreated,
			qr,
			deviceKey,
			wrapKey,
			ephemeral,
			pairingCode: JSON.stringify(qr),
		};
	}

	async approveDeviceEnrollment({
		email,
		mskKey,
		qr,
		approverDeviceId,
		approverWrapPublicKey,
		mskCek,
		vrk,
		deviceName,
	}) {
		const ephemeral = await generateEnrollmentEphemeral(this.crypto);
		const transcript = `${qr.session_id}:${qr.commitment}:${encodeBase64Url(ephemeral.publicKey)}`;
		const sessionKey = await deriveEnrollmentSessionKeys(this.crypto, {
			localEphemeral: ephemeral,
			peerEphemeralPublic: decodePeer(qr.ephemeral_public_key),
			transcript,
		});
		const authorization = await this._signDeviceAuthorization({
			email,
			mskKey,
			device: {
				deviceId: qr.session_id,
				publicKey: decodePeer(qr.device_public_key),
				wrapPublicKey: qr.device_wrap_public_key
					? decodePeer(qr.device_wrap_public_key)
					: decodePeer(qr.device_public_key),
				name: deviceName,
			},
		});
		const bootstrap = {
			authorization,
			msk_wrap: await wrapMSKForDevice(
				this.crypto,
				mskCek,
				decodePeer(qr.device_public_key),
			),
			vrk_wrap: vrk
				? await wrapVrkForDevice(
						this.crypto,
						vrk,
						decodePeer(qr.device_public_key),
					)
				: null,
			approver_device_id: approverDeviceId,
			approver_wrap_public_key: approverWrapPublicKey
				? encodeBase64Url(approverWrapPublicKey)
				: undefined,
		};
		const box = await encryptEnrollmentPayload(this.crypto, sessionKey, bootstrap);
		await pubkeyFetch(
			joinUrl(this.writeBaseUrl, `/v1/device-enrollments/${qr.session_id}/relay`),
			{
				method: "POST",
				body: {
					slot: "bootstrap",
					ephemeral_public_key: encodeBase64Url(ephemeral.publicKey),
					...box,
				},
				fetch: this.fetchImpl,
			},
		);
		return this.completeDeviceEnrollment({
			email,
			sessionId: qr.session_id,
			authorization,
			mskKey,
		});
	}

	async completeDeviceEnrollment({ email, sessionId, authorization, mskKey }) {
		const envelope = await this._signOperation({
			operation: OPERATIONS.complete_device_enrollment,
			principal: await principalFromEmail(requireCanonicalEmail(normalizeEmail(email))),
			payload: { session_id: sessionId, authorization: authorization.payload },
			key: mskKey,
		});
		return pubkeyFetch(
			joinUrl(this.writeBaseUrl, `/v1/device-enrollments/${sessionId}/complete`),
			{
				method: "POST",
				body: { ...envelope, authorization },
				fetch: this.fetchImpl,
			},
		);
	}

	async pullEnrollmentBootstrap({ sessionId, ephemeral, qr }) {
		const relay = await pubkeyFetch(
			joinUrl(this.writeBaseUrl, `/v1/device-enrollments/${sessionId}/relay?slot=bootstrap`),
			{ fetch: this.fetchImpl },
		);
		const transcript = `${qr.session_id}:${qr.commitment}:${relay.ephemeral_public_key}`;
		const sessionKey = await deriveEnrollmentSessionKeys(this.crypto, {
			localEphemeral: ephemeral,
			peerEphemeralPublic: decodePeer(relay.ephemeral_public_key),
			transcript,
		});
		return decryptEnrollmentPayload(this.crypto, sessionKey, relay);
	}

	async listDevices({ email, mskKey }) {
		return this.mutate({
			email,
			operation: OPERATIONS.list_devices,
			payload: {},
			mskKey,
		});
	}

	async revokeDevice({ email, deviceId, mskKey }) {
		return this.mutate({
			email,
			operation: OPERATIONS.revoke_device,
			payload: { device_id: deviceId },
			mskKey,
		});
	}

	async beginIdentityRecovery({ email, mskPublicKey }) {
		return this.replaceMsk({ email, mskPublicKey });
	}

	async replaceMasterSigningKey({ email, otp, captcha, mskKey, device }) {
		return this.verifyReplace({ email, otp, captcha, mskKey, device });
	}

	async syncVault({
		email,
		mskKey,
		records = [],
		vault,
		vrk,
		persistSecret,
	} = {}) {
		const target = vault ?? this.vault;
		let key = vrk ?? target?.vrk ?? null;
		let localRecords = records;
		const listed = await this.mutate({
			email,
			operation: OPERATIONS.vault_list,
			payload: {},
			mskKey,
		});
		const remoteIds = new Set((listed.record_ids ?? []).map(String));
		if (target?.unlocked && !key) {
			if (remoteIds.size) {
				throw new PubkeyError(
					"vault_locked",
					"This device has no Vault Root Key. Add this device before Sync with Scomm.AI.",
				);
			}
			key = target.ensureVrk();
		}
		if (target?.unlocked && key && !localRecords.length) {
			localRecords = [];
			for (const entry of target.entries) {
				localRecords.push(await encodeVaultRecord(this.crypto, key, entry));
			}
		}
		const localIds = new Set(localRecords.map((record) => String(record.record_id)));
		const missing = [...remoteIds].filter((id) => !localIds.has(id));
		let pulled = [];
		if (missing.length) {
			const got = await this.mutate({
				email,
				operation: OPERATIONS.vault_get_records,
				payload: { record_ids: missing },
				mskKey,
			});
			pulled = got.records ?? [];
		}
		const applied = [];
		if (target?.unlocked && key) {
			for (const record of pulled) {
				const entry = await decodeVaultRecord(this.crypto, key, record);
				target.addKey(entry);
				if (entry.fingerprint) applied.push(entry.fingerprint);
			}
		} else if (pulled.length) {
			throw new PubkeyError(
				"vault_locked",
				"Pulled vault records were not applied",
			);
		}
		for (const record of localRecords) {
			if (!remoteIds.has(String(record.record_id))) {
				await this.mutate({
					email,
					operation: OPERATIONS.vault_put_record,
					payload: record,
					mskKey,
				});
			}
		}
		if (persistSecret && target?.unlocked) {
			await target.persist(persistSecret);
		}
		return { pulled, listed, applied };
	}

	async _signDeviceAuthorization({ email, mskKey, device }) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonical);
		const payload = deviceAuthorizationPayload({
			principalId: principal,
			deviceId: device.deviceId ?? encodeBase64Url(this.crypto.random(16)),
			devicePublicKey: encodeBase64Url(device.publicKey ?? device.identityKey.publicKey),
			deviceWrapPublicKey: device.wrapPublicKey
				? encodeBase64Url(device.wrapPublicKey)
				: undefined,
			createdAt: Date.now(),
			permissions: device.permissions ?? [...FULL_DEVICE_PERMISSIONS],
			nonce: encodeBase64Url(this.crypto.random(16)),
			deviceName: device.name,
		});
		const envelope = await this._signOperation({
			operation: OPERATIONS.authorize_device,
			principal,
			payload,
			key: mskKey,
		});
		return { ...envelope, payload };
	}

	async getMe({ email, mskKey }) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonical);
		const envelope = await this._signOperation({
			operation: OPERATIONS.get_me,
			principal,
			payload: {},
			key: mskKey,
		});
		return pubkeyFetch(joinUrl(this.writeBaseUrl, "/v1/me"), {
			method: "POST",
			body: envelope,
			fetch: this.fetchImpl,
		});
	}

	async _signOperation({ operation, principal, payload, key }) {
		if (!key) {
			throw new PubkeyError(
				"master_key_not_armed",
				"MSK KeyRef is required to sign this request",
			);
		}
		const timestamp = Date.now();
		const nonce = randomNonce();
		const bytes = await canonicalSignedBytes({
			protocolVersion: PROTOCOL_VERSION,
			operation,
			principal,
			timestamp,
			nonce,
			payload,
		});
		const signature = await this.crypto.sign(key, bytes);
		return {
			protocol_version: PROTOCOL_VERSION,
			sdk: { name: this.sdkName, version: this.sdkVersion },
			principal,
			operation,
			timestamp,
			nonce,
			payload,
			signature: {
				algorithm: MSK_ALGORITHM,
				value: encodeBase64Url(signature),
			},
		};
	}
}

import {
	MSK_ALGORITHM,
	OPERATIONS,
	PROTOCOL_VERSION,
	ARTIFACT_POP_OPERATION,
	PURPOSES,
	ERROR_CODES,
	applyCapabilityPolicy,
	canonicalSignedBytes,
	canonicalVaultRecordBytes,
	decodeBase64Url,
	deviceAuthorizationPayload,
	encodeBase64Url,
	mustNotGenerateMsk,
	normalizeEmail,
	principalFromEmail,
	requireCanonicalEmail,
	resolveIdentityUxState,
	emailSha256Hex,
	sha256Bytes,
	sha256ToUuidV8,
	sha256Bytes,
	bytesToHex,
} from "@scomm/pubkey-protocol";
import { pubkeyFetch, joinUrl } from "./http.js";
import { PubkeyError } from "./errors.js";
import { protocolCapabilitiesFromProvider } from "./crypto/registry.js";
import { solveDecryptChallenge, unwrapDecryptChallenge } from "./crypto/encryption-pop.js";
import {
	generatePairingEphemeral,
	generatePairingSessionCode,
	derivePairingTek,
	wrapPairingTransfer,
	unwrapPairingTransfer,
} from "./crypto/enrollment.js";

function decodePeer(value) {
	return value instanceof Uint8Array ? value : decodeBase64Url(value);
}

function randomNonce() {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return encodeBase64Url(bytes);
}

function bytesEqual(a, b) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
	return diff === 0;
}

/**
 * Headless Pubkey SDK client. Reconstruct from Vault + CryptoProvider per event.
 */
export class PubkeyClient {
	constructor({
		readBaseUrl = "https://pubkey.scomm.ai",
		writeBaseUrl = "https://pubkey.scomm.ai",
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
		const sha256 = await emailSha256Hex(canonical);
		const proof = await this._signOperation({
			operation: OPERATIONS.arm_msk,
			principal,
			payload: {},
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
				sha256,
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
		const sha256 = await emailSha256Hex(canonical);
		const proof = await this._signOperation({
			operation: OPERATIONS.arm_replacement_msk,
			principal,
			payload: {},
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
				sha256,
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

	/**
	 * Uploads a signing artifact with per-artifact proof-of-possession.
	 * POSTs to `/v1/keys/signing`. `self_signature` is over `artifact_pop`
	 * canonical bytes, signed with the artifact's own private key.
	 */
	async setSigningKeyWithProof({
		email,
		artifact,
		mskKey,
		contentSigningKey,
		compositePopSigner,
	}) {
		if (!contentSigningKey && typeof compositePopSigner !== "function") {
			throw new PubkeyError(
				ERROR_CODES.key_not_found,
				"contentSigningKey or compositePopSigner is required",
			);
		}
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonical);
		const timestamp = Date.now();
		const nonce = randomNonce();
		const material = decodeBase64Url(artifact.public_material);
		const popBytes = await canonicalSignedBytes({
			protocolVersion: PROTOCOL_VERSION,
			operation: ARTIFACT_POP_OPERATION,
			principal,
			timestamp,
			nonce,
			payload: {
				algorithm: artifact.algorithm,
				family: artifact.family,
				purpose: artifact.purpose,
				public_material_sha256: bytesToHex(await sha256Bytes(material)),
			},
		});
		let selfSignature;
		if (typeof compositePopSigner === "function") {
			const dual = compositePopSigner(popBytes);
			selfSignature = {
				algorithm: artifact.algorithm,
				value: encodeBase64Url(dual.mldsa),
				ed25519_value: encodeBase64Url(dual.ed25519),
			};
		} else {
			const sig = await this.crypto.sign(contentSigningKey, popBytes);
			selfSignature = {
				algorithm: artifact.algorithm,
				value: encodeBase64Url(sig),
			};
		}
		const envelope = await this._signOperation({
			operation: OPERATIONS.set_signing_key,
			principal,
			payload: {
				artifacts: [{ ...artifact, self_signature: selfSignature }],
			},
			key: mskKey,
			timestamp,
			nonce,
		});
		return pubkeyFetch(joinUrl(this.writeBaseUrl, "/v1/keys/signing"), {
			method: "POST",
			body: envelope,
			fetch: this.fetchImpl,
		});
	}

	/**
	 * Requests a decrypt challenge for an encryption artifact.
	 * Must be followed by {@link setEncryptionKeyWithProof} with the recovered nonce.
	 */
	async requestEncryptionKeyChallenge({
		email,
		family,
		algorithm,
		publicMaterial,
		mskKey,
	}) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonical);
		const envelope = await this._signOperation({
			operation: OPERATIONS.request_key_challenge,
			principal,
			payload: {
				family,
				algorithm,
				public_material: publicMaterial,
			},
			key: mskKey,
		});
		return pubkeyFetch(joinUrl(this.writeBaseUrl, "/v1/keys/encryption/challenge"), {
			method: "POST",
			body: envelope,
			fetch: this.fetchImpl,
			retries: 1,
		});
	}

	/**
	 * Completes an encryption-key upload with decrypt proof-of-possession.
	 */
	async setEncryptionKeyWithProof({ email, artifact, decryptProof, mskKey }) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonical);
		const envelope = await this._signOperation({
			operation: OPERATIONS.set_encryption_key,
			principal,
			payload: {
				artifacts: [{ ...artifact, decrypt_proof: decryptProof }],
			},
			key: mskKey,
		});
		return pubkeyFetch(joinUrl(this.writeBaseUrl, "/v1/keys/encryption"), {
			method: "POST",
			body: envelope,
			fetch: this.fetchImpl,
			retries: 1,
		});
	}

	/**
	 * Publishes an OpenPGP (or raw X25519) encryption artifact: challenge, decrypt, upload.
	 *
	 * @param {{
	 *   email: string,
	 *   artifact: Record<string, unknown>,
	 *   privateKey: Uint8Array | string,
	 *   mskKey: import("./crypto/provider.js").KeyHandle,
	 *   contentKey?: import("./crypto/provider.js").KeyHandle,
	 * }} input
	 */
	async publishEncryptionKey({
		email,
		artifact,
		privateKey,
		mskKey,
		contentKey,
	}) {
		let agreementKey = contentKey;
		if (!agreementKey) {
			if (artifact.family === "pgp") {
				if (!this.pgpEngine?.available) {
					throw new PubkeyError(
						ERROR_CODES.unsupported_algorithm,
						"OpenPGP engine is not available",
					);
				}
				const subkey = await this.pgpEngine.extractX25519EncryptionSubkey(privateKey);
				agreementKey = await this.crypto.importPrivateKey({
					algorithm: "x25519",
					encoding: "raw-32",
					bytes: subkey.scalar,
					publicKey: subkey.publicKey,
					purpose: PURPOSES.encryption,
				});
			} else {
				throw new PubkeyError(
					ERROR_CODES.unsupported_algorithm,
					"publishEncryptionKey requires contentKey for non-PGP artifacts",
				);
			}
		}
		const challenge = unwrapDecryptChallenge(
			await this.requestEncryptionKeyChallenge({
				email,
				family: artifact.family,
				algorithm: artifact.algorithm,
				publicMaterial: artifact.public_material,
				mskKey,
			}),
		);
		if (challenge.kem_ciphertext) {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"Hybrid PQC decrypt challenges are not supported in this SDK yet",
			);
		}
		const plaintext = await solveDecryptChallenge(this.crypto, agreementKey, challenge);
		return this.setEncryptionKeyWithProof({
			email,
			artifact,
			decryptProof: {
				challenge_id: challenge.challenge_id,
				plaintext: encodeBase64Url(plaintext),
			},
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
		purpose,
		capabilities,
		capabilityPolicy,
	}) {
		const params = new URLSearchParams();
		const hash =
			sha256 ||
			(email
				? await emailSha256Hex(requireCanonicalEmail(normalizeEmail(email)))
				: null);
		if (!hash) {
			throw new PubkeyError(
				"principal_mismatch",
				"sha256 of the canonical email is required",
			);
		}
		params.set("sha256", hash);
		if (purpose) params.set("purpose", purpose);
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
		locators,
		fingerprints,
	}) {
		return this.mutate({
			email,
			operation: OPERATIONS.report_vault_coverage,
			payload: {
				device_id: deviceId,
				locators,
				fingerprints,
			},
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

	// Device pairing (`/v1/pairing/*`, CKVF spec Section 10/15). This is
	// pairing, not genesis: the identity must already have an armed MSK on
	// the server, or `createPairingSession` 404s. Wire-compatible with
	// secMail10's `PubkeyClient.createPairingSession` /
	// `getPairingSession` / `respondToPairingSession` (packages/scomm_pubkey/
	// lib/src/client/pubkey_client.dart) — these previously targeted
	// `/v1/device-enrollments*`, which the server has never implemented
	// (it only ever exposed `/v1/pairing/:sessionId[/response]`).

	/**
	 * Device B (the new device) creates a pairing mailbox and returns the
	 * session id — display it (or the returned `pairingCode`, the same
	 * value) for the user to type into their existing SComm device.
	 */
	async createPairingSession({
		email,
		deviceName,
		requestedTier = "limited",
		sessionId,
		expiresIn = 300,
	}) {
		const canonicalEmail = requireCanonicalEmail(normalizeEmail(email));
		const ephemeral = await generatePairingEphemeral(this.crypto);
		const id = sessionId ?? generatePairingSessionCode(this.crypto);
		const deviceId = await this._deviceIdFromPublicKey(ephemeral.publicKey);
		const created = await pubkeyFetch(
			joinUrl(this.writeBaseUrl, `/v1/pairing/${id}`),
			{
				method: "POST",
				body: {
					email: canonicalEmail,
					device_name: deviceName,
					requested_tier: requestedTier,
					b_ephemeral_public_key: encodeBase64Url(ephemeral.publicKey),
					device_id: deviceId,
					expires_in: expiresIn,
				},
				fetch: this.fetchImpl,
			},
		);
		return { ...created, sessionId: id, pairingCode: id, ephemeral, deviceId };
	}

	/**
	 * Polls a pairing mailbox. Used by both roles: device A (fetching the
	 * pending request, then just checking for COMPLETED) and device B
	 * (polling for A's response). Only B's own poll should pass
	 * `retrieverDeviceId` (its own device id from `createPairingSession`) —
	 * that is what lets the server distinguish B's one-time retrieval of
	 * the RESPONDED envelope from A's routine "did B finish?" status check.
	 */
	async getPairingSession({ sessionId, emailSha256, retrieverDeviceId }) {
		const params = new URLSearchParams({ email_sha256: emailSha256 });
		if (retrieverDeviceId) params.set("retriever_device_id", retrieverDeviceId);
		return pubkeyFetch(
			joinUrl(this.writeBaseUrl, `/v1/pairing/${sessionId}?${params.toString()}`),
			{ fetch: this.fetchImpl },
		);
	}

	/**
	 * Device A (already holds an unlocked Vault) delivers the wrapped
	 * envelope(s) to device B. `peerEphemeralPublicKey` is B's
	 * `b_ephemeral_public_key` from the PENDING session. Envelope contents
	 * are opaque to the server — this only relays ciphertext and an
	 * ephemeral public key, never raw VRK/AEK (never mistake this for a
	 * `set_keys`/`mutate` call; the server does not validate or inspect it).
	 */
	async respondToPairingSession({ email, sessionId, peerEphemeralPublicKey, vrk, aek }) {
		const canonicalEmail = requireCanonicalEmail(normalizeEmail(email));
		const emailSha256 = await emailSha256Hex(canonicalEmail);
		const ephemeral = await generatePairingEphemeral(this.crypto);
		const tek = await derivePairingTek(
			this.crypto,
			ephemeral,
			decodePeer(peerEphemeralPublicKey),
		);
		const { vekEnvelope, aekEnvelope } = await wrapPairingTransfer(
			this.crypto,
			tek,
			vrk,
			aek,
		);
		return pubkeyFetch(
			joinUrl(this.writeBaseUrl, `/v1/pairing/${sessionId}/response`),
			{
				method: "PUT",
				body: {
					email_sha256: emailSha256,
					a_ephemeral_public_key: encodeBase64Url(ephemeral.publicKey),
					vek_envelope: vekEnvelope,
					aek_envelope: aekEnvelope,
				},
				fetch: this.fetchImpl,
			},
		);
	}

	/**
	 * Device B side: poll until A responds, then unwrap VRK (and AEK, if
	 * granted). The server flips PENDING -> RESPONDED -> COMPLETED as a
	 * side effect of this device's own `retrieverDeviceId`-tagged GET, so
	 * there is no separate "complete" call — unlike the old
	 * `/v1/device-enrollments/:id/complete` endpoint this replaces.
	 */
	async completePairingAsNewDevice({
		email,
		sessionId,
		ephemeral,
		deviceId,
		pollIntervalMs = 2000,
		timeoutMs = 5 * 60 * 1000,
	}) {
		const canonicalEmail = requireCanonicalEmail(normalizeEmail(email));
		const emailSha256 = await emailSha256Hex(canonicalEmail);
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const status = await this.getPairingSession({
				sessionId,
				emailSha256,
				retrieverDeviceId: deviceId,
			});
			if (status.state === "RESPONDED" && status.vek_envelope) {
				const tek = await derivePairingTek(
					this.crypto,
					ephemeral,
					decodePeer(status.a_ephemeral_public_key),
				);
				return unwrapPairingTransfer(
					this.crypto,
					tek,
					status.vek_envelope,
					status.aek_envelope ?? undefined,
				);
			}
			if (status.state === "COMPLETED") {
				throw new PubkeyError(
					"pairing_session_already_responded",
					"Pairing envelope was already retrieved by this device",
				);
			}
			if (Date.now() >= deadline) {
				throw new PubkeyError(
					"pairing_session_expired",
					"Timed out waiting for the other device to respond",
				);
			}
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
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

	// Server-synced vault (`/v1/vault/*`, CKVF spec Section 8). Wire-compatible
	// with secMail10's `PubkeyClient.uploadVault` / `downloadCurrentVault` /
	// `downloadVaultGeneration` (packages/scomm_pubkey/lib/src/client/
	// pubkey_client.dart) — this previously called `vault_list` /
	// `vault_get_records` / `vault_put_record` mutate operations that
	// `mutateService.ts`'s `applyMutation` switch has never recognized (every
	// call 400'd). The real protocol uploads the whole encrypted vault as one
	// immutable, hash-chained generation via `vault_upload`, and reads it back
	// with plain (unauthenticated but self-verifying) GETs.

	/**
	 * Uploads the current Vault content as the next generation. Requires the
	 * Vault to be unlocked and hold a VRK (add this device via pairing, or
	 * `vault.ensureVrk()` on the very first device, before calling this).
	 */
	async uploadVault({
		email,
		mskKey,
		vault,
		vrk,
		uploadingDevice,
		mutationKind,
		targetDeviceId,
	} = {}) {
		const target = vault ?? this.vault;
		if (!target?.unlocked) {
			throw new PubkeyError("vault_locked", "Vault must be unlocked to upload");
		}
		const key = vrk ?? target.vrk;
		if (!key) {
			throw new PubkeyError(
				"vault_locked",
				"This device has no Vault Root Key. Add this device before Sync with Scomm.AI.",
			);
		}
		const canonicalEmail = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonicalEmail);
		// Genesis already leaves generation at 0 with no lastCiphertextHash, so
		// the very first upload sends generation 1 as-is; every later upload is
		// a real mutation on top of an already-confirmed generation.
		const nextGeneration =
			target.lastCiphertextHash == null ? Math.max(target.generation, 1) : target.generation + 1;
		const previousGeneration = target.generation;
		target.generation = nextGeneration;
		let box;
		try {
			box = await target.exportVaultCiphertext(key);
		} catch (err) {
			target.generation = previousGeneration;
			throw err;
		}
		const ciphertextHash = await sha256Bytes(box.ciphertext);
		const timestamp = Date.now();
		const previousGenerationHash = target.lastCiphertextHash;
		const recordBytes = canonicalVaultRecordBytes({
			protocolVersion: PROTOCOL_VERSION,
			identityId: principal,
			generation: nextGeneration,
			ciphertextHash,
			previousGenerationHash,
			timestamp,
			nonce: box.iv,
		});
		const recordSignature = await this.crypto.sign(mskKey, recordBytes);

		let result;
		try {
			result = await this.mutate({
				email,
				operation: OPERATIONS.vault_upload,
				payload: {
					generation: nextGeneration,
					previous_generation_hash: previousGenerationHash
						? encodeBase64Url(previousGenerationHash)
						: null,
					ciphertext_hash: encodeBase64Url(ciphertextHash),
					ciphertext: encodeBase64Url(box.ciphertext),
					nonce: encodeBase64Url(box.iv),
					uploading_device: uploadingDevice ?? null,
					msk_signature: encodeBase64Url(recordSignature),
					timestamp,
					...(mutationKind ? { mutation_kind: mutationKind } : {}),
					...(targetDeviceId ? { target_device_id: targetDeviceId } : {}),
				},
				mskKey,
			});
		} catch (err) {
			target.generation = previousGeneration;
			throw err;
		}
		target.lastCiphertextHash = ciphertextHash;
		return result;
	}

	/**
	 * Fetches and applies the server's latest vault generation onto `vault`
	 * (default `this.vault`). Verifies `ciphertext_hash` and `msk_signature`
	 * before ever decrypting — deliberately unauthenticated (no MSK-signed
	 * request envelope): a freshly-paired device holds VRK but no live MSK
	 * signing capability yet, since the MSK envelope lives *inside* the vault
	 * content this call fetches. Returns `null` if nothing has been uploaded
	 * for this identity yet.
	 */
	async downloadCurrentVault({ email, vault, vrk, merge = true } = {}) {
		const target = vault ?? this.vault;
		const canonicalEmail = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonicalEmail);
		const hash = await emailSha256Hex(canonicalEmail);
		const record = await this._fetchAndVerifyVaultRecord({
			path: `/v1/vault/${hash}/current`,
			principal,
			acceptedPublicKeys: (result) => {
				if (typeof result?.msk_public_key !== "string") {
					throw new PubkeyError(
						"master_key_not_armed",
						"Server did not return an armed MSK public key for this identity",
					);
				}
				return [decodeBase64Url(result.msk_public_key)];
			},
		});
		if (!record) return null;

		const key = vrk ?? target?.vrk;
		if (target?.unlocked && key) {
			if (target.lastCiphertextHash && bytesEqual(target.lastCiphertextHash, record.ciphertextHash)) {
				// Already holds this exact generation (most commonly because it
				// just uploaded it itself) — nothing to apply.
				target.generation = record.generation;
				return record.generation;
			}
			if (target.lastCiphertextHash && record.generation < target.generation) {
				throw new PubkeyError(
					"vault_revision_conflict",
					`Server reported generation ${record.generation}, older than this device's already-applied generation ${target.generation}`,
				);
			}
			const snapshot = await target.decryptVaultCiphertext(key, record.nonce, record.ciphertext);
			target.applyRemoteSnapshot(snapshot, { merge });
			target.generation = record.generation;
			target.lastCiphertextHash = record.ciphertextHash;
		} else if (target?.unlocked) {
			throw new PubkeyError(
				"vault_locked",
				"This device has no Vault Root Key to decrypt the downloaded vault",
			);
		}
		return record.generation;
	}

	/**
	 * Fetches one specific, immutable historical vault generation and decrypts
	 * it with `vrk` (the *old* VRK a re-importing device already holds
	 * locally — never derived or fetched here). Does not mutate `vault`
	 * state; returns the decrypted entries for the caller to merge. The MSK
	 * that signed this generation may since have been replaced, so this
	 * verifies against ANY key the identity has ever armed
	 * (`msk_public_keys`), not just the current one.
	 */
	async downloadVaultGeneration({ email, generation, vault, vrk } = {}) {
		const target = vault ?? this.vault;
		const canonicalEmail = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonicalEmail);
		const hash = await emailSha256Hex(canonicalEmail);
		const record = await this._fetchAndVerifyVaultRecord({
			path: `/v1/vault/${hash}/generation/${generation}`,
			principal,
			acceptedPublicKeys: (result) => {
				const keys = (Array.isArray(result?.msk_public_keys) ? result.msk_public_keys : [])
					.filter((entry) => typeof entry === "string")
					.map(decodeBase64Url);
				if (!keys.length) {
					throw new PubkeyError(
						"master_key_not_armed",
						"Server did not return any MSK public key to verify this historical generation against",
					);
				}
				return keys;
			},
		});
		if (!record) return null;
		const key = vrk ?? target?.vrk;
		if (!key) {
			throw new PubkeyError("vault_locked", "A Vault Root Key is required to decrypt this generation");
		}
		return (await target.decryptVaultCiphertext(key, record.nonce, record.ciphertext)).entries;
	}

	/**
	 * Shared by downloadCurrentVault/downloadVaultGeneration: fetches `path`,
	 * checks `ciphertext_hash`, and verifies `msk_signature` against whichever
	 * public key(s) `acceptedPublicKeys` extracts from the raw response.
	 * Deliberately does not decrypt.
	 */
	async _fetchAndVerifyVaultRecord({ path, principal, acceptedPublicKeys }) {
		const result = await pubkeyFetch(joinUrl(this.readBaseUrl, path), {
			fetch: this.fetchImpl,
		});
		const record = result?.vault;
		if (!record) return null;

		const ciphertext = decodeBase64Url(record.ciphertext);
		const ciphertextHash = decodeBase64Url(record.ciphertext_hash);
		if (!bytesEqual(await sha256Bytes(ciphertext), ciphertextHash)) {
			throw new PubkeyError(
				"vault_corrupt",
				"Downloaded vault ciphertext does not match its claimed hash",
			);
		}
		const nonce = decodeBase64Url(record.nonce);
		const previousGenerationHash = record.previous_generation_hash
			? decodeBase64Url(record.previous_generation_hash)
			: null;
		const recordBytes = canonicalVaultRecordBytes({
			protocolVersion: PROTOCOL_VERSION,
			identityId: principal,
			generation: record.generation,
			ciphertextHash,
			previousGenerationHash,
			timestamp: record.timestamp,
			nonce,
		});
		const candidates = acceptedPublicKeys(record);
		let verified = false;
		for (const publicKey of candidates) {
			if (
				await this.crypto.verify(
					publicKey,
					recordBytes,
					decodeBase64Url(record.msk_signature),
					MSK_ALGORITHM,
				)
			) {
				verified = true;
				break;
			}
		}
		if (!verified) {
			throw new PubkeyError(
				"invalid_signature",
				"Vault record signature is invalid",
			);
		}
		return { generation: record.generation, ciphertext, ciphertextHash, nonce };
	}

	/**
	 * Convenience for the "Sync with Scomm.AI" UX: pull the latest remote
	 * generation (merging it into the local Vault so both devices keep the
	 * union of keys), then push local state back up as the next generation.
	 * If nothing has ever been uploaded, this is just the first upload.
	 */
	async syncVault({ email, mskKey, vault, vrk, persistSecret } = {}) {
		const target = vault ?? this.vault;
		if (!target?.unlocked) {
			throw new PubkeyError("vault_locked", "Vault is locked");
		}
		if (!(vrk ?? target.vrk)) {
			target.ensureVrk();
		}
		const downloadedGeneration = await this.downloadCurrentVault({ email, vault: target, vrk });
		const uploaded = await this.uploadVault({ email, mskKey, vault: target, vrk });
		if (persistSecret) {
			await target.persist(persistSecret);
		}
		return { downloadedGeneration, uploaded, generation: target.generation };
	}

	async _signDeviceAuthorization({ email, mskKey, device }) {
		const canonical = requireCanonicalEmail(normalizeEmail(email));
		const principal = await principalFromEmail(canonical);
		const publicKey = device.publicKey ?? device.identityKey.publicKey;
		const payload = deviceAuthorizationPayload({
			principalId: principal,
			deviceId: await this._deviceIdFromPublicKey(publicKey),
			devicePublicKey: encodeBase64Url(publicKey),
			createdAt: Date.now(),
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

	async _deviceIdFromPublicKey(publicKey) {
		return sha256ToUuidV8(await this.crypto.hash("sha-256", publicKey));
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

	async _signOperation({ operation, principal, payload, key, timestamp, nonce }) {
		if (!key) {
			throw new PubkeyError(
				"master_key_not_armed",
				"MSK KeyRef is required to sign this request",
			);
		}
		const ts = timestamp ?? Date.now();
		const n = nonce ?? randomNonce();
		const bytes = await canonicalSignedBytes({
			protocolVersion: PROTOCOL_VERSION,
			operation,
			principal,
			timestamp: ts,
			nonce: n,
			payload,
		});
		const signature = await this.crypto.sign(key, bytes);
		return {
			protocol_version: PROTOCOL_VERSION,
			sdk: { name: this.sdkName, version: this.sdkVersion },
			principal,
			operation,
			timestamp: ts,
			nonce: n,
			payload,
			signature: {
				algorithm: MSK_ALGORITHM,
				value: encodeBase64Url(signature),
			},
		};
	}
}

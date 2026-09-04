import {
	CRYPTO_OPERATIONS,
	ERROR_CODES,
	KEY_PROTECTION,
	MSK_ALGORITHM,
	PURPOSES,
} from "@scomm/pubkey-protocol";
import { CryptoProvider } from "./provider.js";
import { wipeBytes } from "./bytes.js";
import { PubkeyError } from "../errors.js";

function randomId() {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function concatBytes(...parts) {
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

const ED25519_PKCS8_PREFIX = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
	0x22, 0x04, 0x20,
]);

/** PKCS8 PrivateKeyInfo prefix for X25519 (OID 1.3.101.110). Same layout as Ed25519. */
const X25519_PKCS8_PREFIX = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04,
	0x22, 0x04, 0x20,
]);

async function probeGenerate(algorithm, extractable, usages) {
	try {
		await crypto.subtle.generateKey(algorithm, extractable, usages);
		return true;
	} catch {
		return false;
	}
}

/**
 * WebCrypto-first provider. Preferred JS execution path for Ed25519, AES-GCM,
 * SHA-256, and (when the host implements them) X25519 / ECDH P-256.
 *
 * Keys are CryptoKey handles. Raw private bytes are retained only when the
 * caller requested an extractable key (Vault portability).
 */
export class WebCryptoProvider extends CryptoProvider {
	constructor() {
		super();
		/** @type {Map<string, {
		 *   privateKey: CryptoKey,
		 *   publicKey?: CryptoKey,
		 *   algorithm: string,
		 *   purpose?: string,
		 *   extractable: boolean,
		 *   protection: string,
		 *   rawPrivate?: Uint8Array,
		 *   rawPublic?: Uint8Array
		 * }>} */
		this._keys = new Map();
		this._probed = null;
	}

	get id() {
		return "webcrypto";
	}

	get kind() {
		return "platform";
	}

	async _probe() {
		if (this._probed) return this._probed;
		const [ed25519, x25519, p256] = await Promise.all([
			probeGenerate("Ed25519", false, ["sign", "verify"]),
			probeGenerate("X25519", false, ["deriveBits"]),
			probeGenerate({ name: "ECDH", namedCurve: "P-256" }, false, [
				"deriveBits",
			]),
		]);
		this._probed = { ed25519, x25519, p256 };
		return this._probed;
	}

	async capabilities() {
		const probed = await this._probe();
		return {
			id: this.id,
			kind: this.kind,
			sign: probed.ed25519 ? [MSK_ALGORITHM] : [],
			verify: probed.ed25519 ? [MSK_ALGORITHM] : [],
			keyAgreement: [
				...(probed.x25519 ? ["x25519"] : []),
				...(probed.p256 ? ["p-256"] : []),
			],
			aead: ["aes-256-gcm"],
			hash: ["sha-256"],
			kem: [],
			protections: [KEY_PROTECTION.software, KEY_PROTECTION.portableVault],
			extractable: [true, false],
			random: true,
		};
	}

	async supports(operation, algorithm, properties = {}) {
		const protection = properties.protection;
		if (
			protection === KEY_PROTECTION.hardwareBacked ||
			protection === KEY_PROTECTION.osProtected
		) {
			return false;
		}
		const caps = await this.capabilities();
		const algo = String(algorithm ?? "").toLowerCase();
		switch (operation) {
			case CRYPTO_OPERATIONS.random:
				return true;
			case CRYPTO_OPERATIONS.hash:
				return algo === "sha-256" || algo === "sha256";
			case CRYPTO_OPERATIONS.sign:
			case CRYPTO_OPERATIONS.verify:
			case CRYPTO_OPERATIONS.generateKey:
			case CRYPTO_OPERATIONS.importKey:
			case CRYPTO_OPERATIONS.exportKey:
				if (algo === MSK_ALGORITHM || algo === "ed25519") {
					return caps.sign.includes(MSK_ALGORITHM);
				}
				if (
					operation === CRYPTO_OPERATIONS.generateKey ||
					operation === CRYPTO_OPERATIONS.importKey
				) {
					return (
						caps.keyAgreement.includes(algo) ||
						algo === "aes-256-gcm" ||
						algo === "x25519" ||
						algo === "p-256"
					);
				}
				return false;
			case CRYPTO_OPERATIONS.deriveSecret:
				return caps.keyAgreement.includes(algo);
			case CRYPTO_OPERATIONS.encrypt:
			case CRYPTO_OPERATIONS.decrypt:
				return algo === "aes-256-gcm";
			default:
				return false;
		}
	}

	random(length) {
		return crypto.getRandomValues(new Uint8Array(length));
	}

	async hash(algorithm, data) {
		const normalized = String(algorithm).toLowerCase().replace("_", "-");
		if (normalized !== "sha-256" && normalized !== "sha256") {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				`WebCryptoProvider cannot hash ${algorithm}`,
			);
		}
		return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
	}

	_rejectHardware(protection) {
		if (
			protection === KEY_PROTECTION.hardwareBacked ||
			protection === KEY_PROTECTION.osProtected
		) {
			throw new PubkeyError(
				ERROR_CODES.hardware_protection_unavailable,
				"WebCrypto cannot create hardware-backed or OS-protected keys",
			);
		}
	}

	async generateKey(request = {}) {
		const algorithm = request.algorithm ?? MSK_ALGORITHM;
		const extractable = request.extractable ?? true;
		const protection = request.protection ?? KEY_PROTECTION.software;
		const purpose = request.purpose;
		this._rejectHardware(protection);
		const probed = await this._probe();

		if (algorithm === MSK_ALGORITHM || algorithm === "ed25519") {
			if (!probed.ed25519) {
				throw new PubkeyError(
					ERROR_CODES.unsupported_algorithm,
					"WebCrypto Ed25519 is not available in this host",
				);
			}
			const pair = await crypto.subtle.generateKey("Ed25519", extractable, [
				"sign",
				"verify",
			]);
			const rawPublic = new Uint8Array(
				await crypto.subtle.exportKey("raw", pair.publicKey),
			);
			let rawPrivate;
			if (extractable) {
				const pkcs8 = new Uint8Array(
					await crypto.subtle.exportKey("pkcs8", pair.privateKey),
				);
				rawPrivate = pkcs8.subarray(pkcs8.length - 32);
			}
			return this._store({
				privateKey: pair.privateKey,
				publicKey: pair.publicKey,
				algorithm: MSK_ALGORITHM,
				purpose: purpose ?? PURPOSES.masterSigning,
				extractable,
				protection,
				rawPrivate,
				rawPublic,
			});
		}

		if (algorithm === "x25519" || algorithm === "X25519") {
			if (!probed.x25519) {
				throw new PubkeyError(
					ERROR_CODES.unsupported_algorithm,
					"WebCrypto X25519 is not available in this host",
				);
			}
			const pair = await crypto.subtle.generateKey("X25519", extractable, [
				"deriveBits",
			]);
			const rawPublic = new Uint8Array(
				await crypto.subtle.exportKey("raw", pair.publicKey),
			);
			let rawPrivate;
			if (extractable) {
				const pkcs8 = new Uint8Array(
					await crypto.subtle.exportKey("pkcs8", pair.privateKey),
				);
				rawPrivate = pkcs8.subarray(pkcs8.length - 32);
			}
			return this._store({
				privateKey: pair.privateKey,
				publicKey: pair.publicKey,
				algorithm: "x25519",
				purpose: purpose ?? PURPOSES.keyAgreement,
				extractable,
				protection,
				rawPrivate,
				rawPublic,
			});
		}

		if (algorithm === "p-256" || algorithm === "P-256" || algorithm === "ecdh-p256") {
			if (!probed.p256) {
				throw new PubkeyError(
					ERROR_CODES.unsupported_algorithm,
					"WebCrypto ECDH P-256 is not available in this host",
				);
			}
			const pair = await crypto.subtle.generateKey(
				{ name: "ECDH", namedCurve: "P-256" },
				extractable,
				["deriveBits"],
			);
			const rawPublic = new Uint8Array(
				await crypto.subtle.exportKey("raw", pair.publicKey),
			);
			return this._store({
				privateKey: pair.privateKey,
				publicKey: pair.publicKey,
				algorithm: "p-256",
				purpose: purpose ?? PURPOSES.keyAgreement,
				extractable,
				protection,
				rawPublic,
			});
		}

		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			`WebCryptoProvider cannot generate ${algorithm}`,
		);
	}

	_store(slot) {
		const id = randomId();
		this._keys.set(id, slot);
		return {
			id,
			provider: this.id,
			algorithm: slot.algorithm,
			purpose: slot.purpose,
			extractable: slot.extractable,
			protection: slot.protection,
			publicKey: slot.rawPublic,
		};
	}

	_slot(key) {
		const slot = this._keys.get(key?.id);
		if (!slot) {
			throw new PubkeyError(ERROR_CODES.key_not_found, "Unknown KeyHandle");
		}
		return slot;
	}

	async sign(key, payload) {
		const slot = this._slot(key);
		if (slot.algorithm !== MSK_ALGORITHM) {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				`Cannot sign with ${slot.algorithm}`,
			);
		}
		const sig = await crypto.subtle.sign("Ed25519", slot.privateKey, payload);
		return new Uint8Array(sig);
	}

	async verify(publicKey, payload, signature, algorithm = MSK_ALGORITHM) {
		if (algorithm !== MSK_ALGORITHM && algorithm !== "ed25519") {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				`Cannot verify ${algorithm} with WebCryptoProvider`,
			);
		}
		const key = await crypto.subtle.importKey(
			"raw",
			publicKey,
			"Ed25519",
			true,
			["verify"],
		);
		return crypto.subtle.verify("Ed25519", key, signature, payload);
	}

	async deriveSecret(privateKey, peerPublicKey) {
		const slot = this._slot(privateKey);
		if (slot.algorithm === "x25519") {
			const peer = await crypto.subtle.importKey(
				"raw",
				peerPublicKey,
				"X25519",
				false,
				[],
			);
			return new Uint8Array(
				await crypto.subtle.deriveBits(
					{ name: "X25519", public: peer },
					slot.privateKey,
					256,
				),
			);
		}
		if (slot.algorithm === "p-256") {
			const peer = await crypto.subtle.importKey(
				"raw",
				peerPublicKey,
				{ name: "ECDH", namedCurve: "P-256" },
				false,
				[],
			);
			return new Uint8Array(
				await crypto.subtle.deriveBits(
					{ name: "ECDH", public: peer },
					slot.privateKey,
					256,
				),
			);
		}
		throw new PubkeyError(
			ERROR_CODES.unsupported_algorithm,
			`Cannot deriveSecret with ${slot.algorithm}`,
		);
	}

	async importPrivateKey(portable, options = {}) {
		const extractable = options.extractable ?? portable.extractable ?? true;
		const protection = options.protection ?? KEY_PROTECTION.software;
		this._rejectHardware(protection);
		const algorithm = String(portable.algorithm ?? "").toLowerCase();
		if (algorithm === "x25519") {
			return this._importX25519(portable, extractable, protection);
		}
		if (algorithm !== MSK_ALGORITHM && algorithm !== "ed25519") {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				`Cannot import ${portable.algorithm}`,
			);
		}
		if (!portable.bytes || portable.bytes.length !== 32) {
			throw new PubkeyError(
				ERROR_CODES.key_import_failure,
				"Ed25519 seed must be 32 bytes",
			);
		}
		const rawPrivate = new Uint8Array(portable.bytes);
		const pkcs8 = concatBytes(ED25519_PKCS8_PREFIX, rawPrivate);
		let privateKey;
		try {
			privateKey = await crypto.subtle.importKey(
				"pkcs8",
				pkcs8,
				"Ed25519",
				extractable,
				["sign"],
			);
		} catch (cause) {
			wipeBytes(rawPrivate);
			throw new PubkeyError(
				ERROR_CODES.key_import_failure,
				"WebCrypto rejected the Ed25519 seed",
				{ cause },
			);
		}
		const rawPublic = portable.publicKey
			? new Uint8Array(portable.publicKey)
			: undefined;
		let publicKey;
		if (rawPublic) {
			publicKey = await crypto.subtle.importKey(
				"raw",
				rawPublic,
				"Ed25519",
				true,
				["verify"],
			);
		}
		const handle = this._store({
			privateKey,
			publicKey,
			algorithm: MSK_ALGORITHM,
			purpose: portable.purpose,
			extractable,
			protection,
			rawPrivate: extractable ? rawPrivate : undefined,
			rawPublic,
		});
		if (!extractable) {
			wipeBytes(rawPrivate);
		}
		return handle;
	}

	/**
	 * Imports a raw 32-byte X25519 scalar for ECDH (encryption proof-of-possession).
	 */
	async _importX25519(portable, extractable, protection) {
		const probed = await this._probe();
		if (!probed.x25519) {
			throw new PubkeyError(
				ERROR_CODES.unsupported_algorithm,
				"WebCrypto X25519 is not available in this host",
			);
		}
		if (!portable.bytes || portable.bytes.length !== 32) {
			throw new PubkeyError(
				ERROR_CODES.key_import_failure,
				"X25519 scalar must be 32 bytes",
			);
		}
		const rawPrivate = new Uint8Array(portable.bytes);
		const pkcs8 = concatBytes(X25519_PKCS8_PREFIX, rawPrivate);
		let privateKey;
		try {
			privateKey = await crypto.subtle.importKey(
				"pkcs8",
				pkcs8,
				"X25519",
				extractable,
				["deriveBits"],
			);
		} catch (cause) {
			wipeBytes(rawPrivate);
			throw new PubkeyError(
				ERROR_CODES.key_import_failure,
				"WebCrypto rejected the X25519 scalar",
				{ cause },
			);
		}
		const rawPublic = portable.publicKey
			? new Uint8Array(portable.publicKey)
			: undefined;
		let publicKey;
		if (rawPublic) {
			publicKey = await crypto.subtle.importKey(
				"raw",
				rawPublic,
				"X25519",
				true,
				[],
			);
		}
		const handle = this._store({
			privateKey,
			publicKey,
			algorithm: "x25519",
			purpose: portable.purpose ?? PURPOSES.keyAgreement,
			extractable,
			protection,
			rawPrivate: extractable ? rawPrivate : undefined,
			rawPublic,
		});
		if (!extractable) {
			wipeBytes(rawPrivate);
		}
		return handle;
	}

	async exportPrivateKey(key) {
		const slot = this._slot(key);
		if (!slot.extractable || !slot.rawPrivate) {
			throw new PubkeyError(
				ERROR_CODES.key_not_exportable,
				"Key is not extractable",
			);
		}
		return {
			algorithm: slot.algorithm,
			encoding: "raw-32",
			bytes: new Uint8Array(slot.rawPrivate),
			publicKey: slot.rawPublic ? new Uint8Array(slot.rawPublic) : undefined,
			purpose: slot.purpose,
		};
	}

	async wrapVault(plaintext, passphrase, options = {}) {
		const iterations = options.iterations ?? 210_000;
		const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
		const iv = options.iv ?? crypto.getRandomValues(new Uint8Array(12));
		const key = await this._vaultKey(
			passphrase,
			salt,
			iterations,
		);
		const ciphertext = new Uint8Array(
			await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
		);
		return { salt, iv, iterations, ciphertext };
	}

	async unwrapVault(ciphertext, passphrase, salt, iv, iterations) {
		const key = await this._vaultKey(passphrase, salt, iterations);
		try {
			return new Uint8Array(
				await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext),
			);
		} catch {
			throw new PubkeyError(
				ERROR_CODES.vault_authentication_failure,
				"Vault authentication failed",
			);
		}
	}

	async hkdfSha256(ikm, info, length = 32, salt = new Uint8Array(32)) {
		const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
			"deriveBits",
		]);
		return new Uint8Array(
			await crypto.subtle.deriveBits(
				{
					name: "HKDF",
					hash: "SHA-256",
					salt,
					info: typeof info === "string" ? new TextEncoder().encode(info) : info,
				},
				key,
				length * 8,
			),
		);
	}

	async encryptAead(keyBytes, plaintext) {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const key = await crypto.subtle.importKey(
			"raw",
			keyBytes,
			{ name: "AES-GCM" },
			false,
			["encrypt"],
		);
		const ciphertext = new Uint8Array(
			await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
		);
		return { iv, ciphertext };
	}

	async decryptAead(keyBytes, iv, ciphertext) {
		const key = await crypto.subtle.importKey(
			"raw",
			keyBytes,
			{ name: "AES-GCM" },
			false,
			["decrypt"],
		);
		return new Uint8Array(
			await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext),
		);
	}

	async _vaultKey(passphrase, salt, iterations) {
		const material = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(passphrase),
			"PBKDF2",
			false,
			["deriveBits"],
		);
		const bits = await crypto.subtle.deriveBits(
			{
				name: "PBKDF2",
				salt,
				iterations,
				hash: "SHA-256",
			},
			material,
			256,
		);
		return crypto.subtle.importKey("raw", new Uint8Array(bits), { name: "AES-GCM" }, false, [
			"encrypt",
			"decrypt",
		]);
	}
}

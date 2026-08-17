import { ERROR_CODES } from "./errors.js";
import { FAMILIES, REQUIREMENT_LEVELS } from "./constants.js";

const WIRE_FAMILIES = [FAMILIES.pgp, FAMILIES.smime];

/**
 * Translate primitive provider algorithms into Pubkey discovery families.
 *
 * Wire families are pgp and smime only. ML-KEM is advertised as
 * `smime-mlkem-*` when an S/MIME engine can run it. Ed25519 used as an
 * MSK is not a discovery family. Families are advertised only when the
 * corresponding protocol engine is actually available.
 *
 * @param {{
 *   sign?: string[],
 *   keyAgreement?: string[],
 *   kem?: string[],
 *   aead?: string[],
 *   engines?: { pgp?: boolean, smime?: boolean }
 * }} primitives
 * @returns {{ families: Record<string, string[]> }}
 */
export function protocolFamiliesFromPrimitives(primitives = {}) {
	const families = {};
	const engines = primitives.engines ?? {};
	const keyAgreement = new Set(
		(primitives.keyAgreement ?? []).map((item) => String(item).toLowerCase()),
	);
	const kem = new Set((primitives.kem ?? []).map((item) => String(item).toLowerCase()));
	const sign = new Set((primitives.sign ?? []).map((item) => String(item).toLowerCase()));

	if (engines.pgp) {
		const pgp = [];
		if (sign.has("ed25519") || sign.has("openpgp-ed25519")) {
			pgp.push("openpgp-ed25519");
		}
		if (keyAgreement.has("x25519") || sign.has("openpgp-cv25519")) {
			pgp.push("openpgp-cv25519");
		}
		if (pgp.length) families[FAMILIES.pgp] = pgp;
	}

	if (engines.smime) {
		const smime = [];
		if (keyAgreement.has("x25519")) smime.push("smime-x25519");
		if (
			keyAgreement.has("p-256") ||
			keyAgreement.has("ecdh-p256")
		) {
			smime.push("smime-ecdh-p256");
		}
		if (
			kem.has("ml-kem-768") ||
			kem.has("pqc-mlkem-768") ||
			kem.has("smime-mlkem-768")
		) {
			smime.push("smime-mlkem-768");
		}
		if (
			kem.has("ml-kem-1024") ||
			kem.has("pqc-mlkem-1024") ||
			kem.has("smime-mlkem-1024")
		) {
			smime.push("smime-mlkem-1024");
		}
		if (smime.length) families[FAMILIES.smime] = smime;
	}

	return { families };
}

/**
 * Apply required / preferred / unavailable policy to protocol capabilities.
 * A required family that the provider cannot satisfy is an error — never a
 * silent downgrade.
 *
 * @param {{ families: Record<string, string[]> }} capabilities
 * @param {{ pgp?: string, smime?: string }} [policy]
 */
export function applyCapabilityPolicy(capabilities, policy = {}) {
	const families = { ...(capabilities?.families ?? {}) };
	delete families.pq;

	for (const family of WIRE_FAMILIES) {
		const level = policy[family];
		const present = Array.isArray(families[family]) && families[family].length > 0;
		if (level === REQUIREMENT_LEVELS.required && !present) {
			const err = new Error(
				`Capability policy requires ${family}, but no compatible algorithms are available`,
			);
			err.code = ERROR_CODES.capability_mismatch;
			throw err;
		}
		if (level === REQUIREMENT_LEVELS.unavailable && present) {
			delete families[family];
		}
	}

	return { families };
}

import { FAMILIES, PURPOSES } from "./constants.js";

const KEY_FN_ENCRYPT = 1;
const KEY_FN_VERIFY = 2;
const KEY_FN_AUTHENTICATE = 4;
const KEY_FN_KEY_AGREEMENT = 8;
const KEY_FN_CERTIFY = 16;

function row(id, name, family, keyFunctions, purpose) {
	return {
		algorithm_id: id,
		algorithm: name,
		family,
		key_functions: keyFunctions,
		purpose,
	};
}

/** Canonical algorithm registry. Wire families are pgp and smime. */
export const ALGORITHM_REGISTRY = Object.freeze([
	row(1, "ed25519", null, KEY_FN_VERIFY, PURPOSES.masterSigning),
	row(104, "openpgp-rsa2048", FAMILIES.pgp, KEY_FN_VERIFY, PURPOSES.signing),
	row(105, "openpgp-rsa3072", FAMILIES.pgp, KEY_FN_VERIFY, PURPOSES.signing),
	row(106, "openpgp-rsa4096", FAMILIES.pgp, KEY_FN_VERIFY, PURPOSES.signing),
	row(107, "openpgp-dsa2048", FAMILIES.pgp, KEY_FN_VERIFY, PURPOSES.signing),
	row(108, "openpgp-ecdsa-p256", FAMILIES.pgp, KEY_FN_VERIFY, PURPOSES.signing),
	row(109, "openpgp-ecdsa-p384", FAMILIES.pgp, KEY_FN_VERIFY, PURPOSES.signing),
	row(110, "openpgp-ecdsa-p521", FAMILIES.pgp, KEY_FN_VERIFY, PURPOSES.signing),
	row(111, "openpgp-ed25519", FAMILIES.pgp, KEY_FN_VERIFY, PURPOSES.signing),
	row(112, "openpgp-ed448", FAMILIES.pgp, KEY_FN_VERIFY, PURPOSES.signing),
	row(113, "openpgp-cv25519", FAMILIES.pgp, KEY_FN_ENCRYPT, PURPOSES.encryption),
	row(114, "openpgp-cv448", FAMILIES.pgp, KEY_FN_ENCRYPT, PURPOSES.encryption),
	row(115, "openpgp-elgamal", FAMILIES.pgp, KEY_FN_ENCRYPT, PURPOSES.encryption),
	row(204, "smime-rsa-sha256", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(205, "smime-rsa-sha384", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(206, "smime-rsa-sha512", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(207, "smime-ecdsa-sha256", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(208, "smime-ecdsa-sha384", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(209, "smime-ecdsa-sha512", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(210, "smime-ed25519", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(211, "smime-ed448", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(212, "smime-rsa-pkcs1", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.encryption),
	row(213, "smime-rsa-oaep-sha1", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.encryption),
	row(214, "smime-rsa-oaep-sha256", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.encryption),
	row(215, "smime-rsa-oaep-sha384", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.encryption),
	row(216, "smime-rsa-oaep-sha512", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.encryption),
	row(217, "smime-ecdh-p256", FAMILIES.smime, KEY_FN_KEY_AGREEMENT, PURPOSES.keyAgreement),
	row(218, "smime-ecdh-p384", FAMILIES.smime, KEY_FN_KEY_AGREEMENT, PURPOSES.keyAgreement),
	row(219, "smime-ecdh-p521", FAMILIES.smime, KEY_FN_KEY_AGREEMENT, PURPOSES.keyAgreement),
	row(220, "smime-x25519", FAMILIES.smime, KEY_FN_KEY_AGREEMENT, PURPOSES.keyAgreement),
	row(221, "smime-x448", FAMILIES.smime, KEY_FN_KEY_AGREEMENT, PURPOSES.keyAgreement),
	row(222, "smime-dh", FAMILIES.smime, KEY_FN_KEY_AGREEMENT, PURPOSES.keyAgreement),
	row(223, "smime-ed25519-kem", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(224, "smime-ed448-kem", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(225, "smime-mlkem-512", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(226, "smime-mlkem-768", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(227, "smime-mlkem-1024", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(228, "smime-mlkem768-x25519", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(229, "smime-mlkem768-p256", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(230, "smime-mlkem1024-p384", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(304, "pqc-mldsa65", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(305, "pqc-mldsa87", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(306, "pqc-slhdsa-sha256", FAMILIES.smime, KEY_FN_VERIFY, PURPOSES.signing),
	row(307, "pqc-mlkem-512", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(308, "pqc-mlkem-768", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(309, "pqc-mlkem-1024", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(310, "pqc-mlkem768-x25519", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(311, "pqc-mlkem768-p256", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(312, "pqc-mlkem1024-p384", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(313, "pqc-mlkem768-p521", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(314, "pqc-mlkem1024-p521", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(315, "pqc-hqc-128", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(316, "pqc-hqc-192", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
	row(317, "pqc-hqc-256", FAMILIES.smime, KEY_FN_ENCRYPT, PURPOSES.kem),
]);

const byName = new Map(ALGORITHM_REGISTRY.map((row) => [row.algorithm, row]));
const byId = new Map(ALGORITHM_REGISTRY.map((row) => [row.algorithm_id, row]));

export function getAlgorithm(name) {
	return byName.get(name);
}

export function requireAlgorithm(name) {
	const meta = getAlgorithm(name);
	if (!meta) {
		const err = new Error(`Unknown algorithm: ${name}`);
		err.code = "unsupported_algorithm";
		throw err;
	}
	return meta;
}

export function getAlgorithmById(id) {
	return byId.get(id);
}

export function listAlgorithms(family) {
	if (!family) {
		return [...ALGORITHM_REGISTRY];
	}
	return ALGORITHM_REGISTRY.filter((row) => row.family === family);
}

const WIRE_FAMILIES = new Set([FAMILIES.pgp, FAMILIES.smime]);

function isPqAlgorithm(algorithm) {
	const name = String(algorithm || "").toLowerCase();
	return (
		name.includes("mlkem") ||
		name.includes("mldsa") ||
		name.includes("slhdsa") ||
		name.includes("hqc") ||
		name.startsWith("pqc-")
	);
}

export function algorithmPreferenceRank(algorithm) {
	return isPqAlgorithm(algorithm) ? 1 : 0;
}

export function familyPreferenceRank(family) {
	if (family === FAMILIES.smime) return 1;
	if (family === FAMILIES.pgp) return 0;
	return -1;
}

/**
 * Select the best mutually supported artifact.
 * Families on the wire are pgp and smime only. PQ is an algorithm property.
 */
export function selectBestArtifact(
	artifacts,
	capabilities,
	preferences = {},
	purpose,
) {
	const supported = new Set();
	const families = capabilities?.families ?? {};
	for (const [family, algos] of Object.entries(families)) {
		if (!WIRE_FAMILIES.has(family)) continue;
		for (const algo of algos ?? []) {
			supported.add(`${family}:${algo}`);
		}
	}

	const candidates = artifacts.filter((artifact) => {
		if (artifact.status && artifact.status !== "active") return false;
		if (
			artifact.public_material != null &&
			artifact.public_material.length === 0
		) {
			return false;
		}
		if (!WIRE_FAMILIES.has(artifact.family)) return false;
		if (purpose && artifact.purpose && artifact.purpose !== purpose) {
			return false;
		}
		return supported.has(`${artifact.family}:${artifact.algorithm}`);
	});
	if (candidates.length === 0) return null;

	const preferredFamily = preferences.preferred_family;
	const preferredAlgorithm = preferences.preferred_algorithm;
	if (WIRE_FAMILIES.has(preferredFamily)) {
		const preferred = candidates.find(
			(artifact) =>
				artifact.family === preferredFamily &&
				(!preferredAlgorithm || artifact.algorithm === preferredAlgorithm),
		);
		if (preferred) return preferred;
	}

	candidates.sort((a, b) => {
		const pq =
			algorithmPreferenceRank(b.algorithm) - algorithmPreferenceRank(a.algorithm);
		if (pq !== 0) return pq;
		const family = familyPreferenceRank(b.family) - familyPreferenceRank(a.family);
		if (family !== 0) return family;
		return Number(b.key_id) - Number(a.key_id);
	});
	return candidates[0];
}

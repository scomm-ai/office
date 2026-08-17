/** OpenPGP 64-bit Key-ID display: AB12-CD34-EF56-7890 */
export const OPENPGP_LOCATOR_GROUPS = 4;
export const OPENPGP_LOCATOR_HEX_LEN = 16;
export const KEY_PACKAGE_KIND = "scomm-key-package";
export const KEY_PACKAGE_VERSION = 1;
export const VAULT_WRAP_VERSION_V1 = 1;

export function normalizeHex(value) {
	return String(value || "")
		.replace(/^0x/i, "")
		.replace(/[^0-9A-Fa-f]/g, "")
		.toUpperCase();
}

/**
 * Format an OpenPGP 64-bit Key-ID as XXXX-XXXX-XXXX-XXXX.
 * Accepts 16 hex chars, or longer fingerprints (uses the last 16).
 */
export function formatOpenPgpLocator(value) {
	let hex = normalizeHex(value);
	if (hex.length > OPENPGP_LOCATOR_HEX_LEN) {
		hex = hex.slice(-OPENPGP_LOCATOR_HEX_LEN);
	}
	if (hex.length !== OPENPGP_LOCATOR_HEX_LEN) {
		return hex;
	}
	return [0, 4, 8, 12].map((i) => hex.slice(i, i + 4)).join("-");
}

export function formatSmimeLocator(value) {
	return normalizeHex(value);
}

export function formatLocator(family, value) {
	if (family === "pgp") return formatOpenPgpLocator(value);
	return formatSmimeLocator(value);
}

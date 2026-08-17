/**
 * Public mailbox canonicalization. Must match pubkey `src/lib/emailTid.ts`.
 *
 * 1. Trim Unicode whitespace
 * 2. Unicode NFC
 * 3. Split on the last ASCII `@`
 * 4. Domain: Unicode lowercase, NFC
 * 5. Local: Unicode lowercase, NFC; drop from the first ASCII `+` onward
 * 6. Join `local@domain` — SHA-256 the UTF-8 bytes of this string for the principal
 */

function foldUtf8(value) {
	return value.toLowerCase().normalize("NFC");
}

export function normalizeEmail(email) {
	if (typeof email !== "string") {
		return "";
	}
	const trimmed = email.trim().normalize("NFC");
	const at = trimmed.lastIndexOf("@");
	if (at <= 0 || at === trimmed.length - 1) {
		return foldUtf8(trimmed);
	}
	let local = foldUtf8(trimmed.slice(0, at));
	const domain = foldUtf8(trimmed.slice(at + 1));
	const plus = local.indexOf("+");
	if (plus !== -1) {
		local = local.slice(0, plus);
	}
	return `${local}@${domain}`;
}

const MAX_EMAIL_OCTETS = 254;
const MAX_LOCAL_OCTETS = 64;
const MAX_DOMAIN_OCTETS = 255;
const MAX_LABEL_OCTETS = 63;
const LOCAL_CHARS = /^[\p{L}\p{N}\p{M}!#$%&'*+/=?^_`{|}~.-]+$/u;
const DOMAIN_LABEL_CHARS = /^[\p{L}\p{N}\p{M}-]+$/u;
const DISALLOWED_IN_ADDRESS = /[\s\p{Cc}\p{Cf}]/u;

function utf8ByteLength(value) {
	return new TextEncoder().encode(value).byteLength;
}

function isValidLocalPart(local) {
	if (
		local.length === 0 ||
		local.startsWith(".") ||
		local.endsWith(".") ||
		local.includes("..")
	) {
		return false;
	}
	return LOCAL_CHARS.test(local);
}

function isValidDomain(domain) {
	if (
		domain.startsWith("[") ||
		domain.endsWith("]") ||
		domain.startsWith(".") ||
		domain.endsWith(".") ||
		domain.includes("..")
	) {
		return false;
	}
	const labels = domain.split(".");
	if (labels.length < 2) {
		return false;
	}
	for (const label of labels) {
		if (
			label.length === 0 ||
			utf8ByteLength(label) > MAX_LABEL_OCTETS ||
			label.startsWith("-") ||
			label.endsWith("-") ||
			!DOMAIN_LABEL_CHARS.test(label)
		) {
			return false;
		}
	}
	const tld = labels[labels.length - 1];
	if (tld.length < 2 || /^\d+$/.test(tld) || !/\p{L}/u.test(tld)) {
		return false;
	}
	return true;
}

export function isValidEmail(email) {
	if (typeof email !== "string" || email.length === 0) {
		return false;
	}
	if (DISALLOWED_IN_ADDRESS.test(email) || email.includes("\0")) {
		return false;
	}
	const at = email.indexOf("@");
	if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) {
		return false;
	}
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	if (
		utf8ByteLength(email) > MAX_EMAIL_OCTETS ||
		utf8ByteLength(local) > MAX_LOCAL_OCTETS ||
		utf8ByteLength(domain) > MAX_DOMAIN_OCTETS
	) {
		return false;
	}
	return isValidLocalPart(local) && isValidDomain(domain);
}

export function requireCanonicalEmail(email) {
	if (typeof email !== "string" || email.length === 0) {
		const err = new Error("Valid email is required");
		err.code = "invalid_email";
		throw err;
	}
	const canonical = normalizeEmail(email);
	if (email !== canonical) {
		const err = new Error("Email must be sent in canonical form");
		err.code = "email_not_canonical";
		throw err;
	}
	if (!isValidEmail(canonical)) {
		const err = new Error("Valid email is required");
		err.code = "invalid_email";
		throw err;
	}
	return canonical;
}

/** UUID v8 from the last 16 bytes of a SHA-256 digest (RFC 9562 version + variant). */
export function sha256ToUuidV8(sha256) {
	if (!(sha256 instanceof Uint8Array) || sha256.length !== 32) {
		throw new TypeError("sha256 must be a 32-byte SHA-256 digest");
	}
	const bytes = Uint8Array.from(sha256.subarray(16, 32));
	bytes[6] = (bytes[6] & 0x0f) | 0x80;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function sha256Bytes(data) {
	const encoded =
		typeof data === "string" ? new TextEncoder().encode(data) : data;
	const digest = await crypto.subtle.digest("SHA-256", encoded);
	return new Uint8Array(digest);
}

export async function textToUuidV8(value) {
	if (typeof value !== "string") {
		throw new TypeError("value must be a string");
	}
	return sha256ToUuidV8(await sha256Bytes(value));
}

export async function emailSha256(canonicalEmail) {
	return sha256Bytes(canonicalEmail);
}

export async function emailSha256Hex(canonicalEmail) {
	const bytes = await emailSha256(canonicalEmail);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function principalFromEmail(email) {
	const canonical = normalizeEmail(email);
	if (!canonical) {
		throw new TypeError("email is required");
	}
	return textToUuidV8(canonical);
}

export function uuidLast16Bits(uuid) {
	const hex = String(uuid).replaceAll("-", "");
	return Number.parseInt(hex.slice(28, 32), 16);
}

export function bytesToHex(bytes) {
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

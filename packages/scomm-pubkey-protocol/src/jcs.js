/**
 * RFC 8785 JSON Canonicalization Scheme for protocol payloads.
 * Constrained to JSON values used by SComm (objects, arrays, strings, finite numbers, booleans, null).
 */
export function canonicalizeJson(value) {
	return serialize(value);
}

function serialize(value) {
	if (value === null) {
		return "null";
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError("JCS does not allow non-finite numbers");
		}
		return JSON.stringify(value);
	}
	if (typeof value === "string") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(serialize).join(",")}]`;
	}
	if (typeof value === "object") {
		const keys = Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(",")}}`;
	}
	throw new TypeError(`Unsupported JCS value type: ${typeof value}`);
}

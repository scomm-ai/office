import { ERROR_CODES, PubkeyError } from "./errors.js";

const CONNECTION_ATTEMPTS = 4;
const CONNECTION_RETRY_DELAY_MS = 400;
const UNREACHABLE_MESSAGE =
	"Cannot reach the pubkey server. Check that it is running.";

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export function isPubkeyConnectionError(error) {
	if (!error || error instanceof PubkeyError) return false;
	const message = String(error.message || error).toLowerCase();
	return (
		message.includes("failed to fetch") ||
		message.includes("networkerror") ||
		message.includes("network request failed") ||
		message.includes("connection failed") ||
		message.includes("connection refused") ||
		message.includes("econnrefused") ||
		message.includes("load failed")
	);
}

export async function pubkeyFetch(url, options = {}) {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	let lastError;
	for (let attempt = 1; attempt <= CONNECTION_ATTEMPTS; attempt += 1) {
		try {
			const response = await fetchImpl(url, {
				method: options.method ?? "GET",
				headers: {
					Accept: "application/json",
					...(options.body ? { "Content-Type": "application/json" } : {}),
					...options.headers,
				},
				body: options.body ? JSON.stringify(options.body) : undefined,
			});
			const text = await response.text();
			let body = null;
			if (text) {
				try {
					body = JSON.parse(text);
				} catch {
					body = { message: text };
				}
			}
			if (!response.ok) {
				throw PubkeyError.fromResponse(response.status, body ?? {});
			}
			return body;
		} catch (error) {
			lastError = error;
			if (
				error instanceof PubkeyError ||
				!isPubkeyConnectionError(error) ||
				attempt === CONNECTION_ATTEMPTS
			) {
				break;
			}
			await sleep(CONNECTION_RETRY_DELAY_MS);
		}
	}

	if (lastError instanceof PubkeyError) {
		throw lastError;
	}
	if (isPubkeyConnectionError(lastError)) {
		throw new PubkeyError(ERROR_CODES.provider_unavailable, UNREACHABLE_MESSAGE, {
			status: 0,
		});
	}
	throw lastError;
}

export function joinUrl(base, path) {
	return `${String(base).replace(/\/+$/, "")}${path}`;
}

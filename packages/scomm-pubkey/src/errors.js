import { ERROR_CODES } from "@scomm/pubkey-protocol";

export class PubkeyError extends Error {
	constructor(code, message, extras = {}) {
		super(message);
		this.name = "PubkeyError";
		this.code = code;
		Object.assign(this, extras);
	}

	static fromResponse(status, body) {
		const raw = body?.error || "server_error";
		const mapped = {
			invalid_signature: ERROR_CODES.server_signature_rejection,
			timestamp_out_of_window: ERROR_CODES.clock_skew,
			nonce_replayed: ERROR_CODES.replay_rejection,
			unsupported_protocol_version: ERROR_CODES.protocol_version_mismatch,
		};
		const code = mapped[raw] || raw;
		const err = new PubkeyError(
			code,
			body?.message || `Pubkey request failed (${status})`,
			{
				status,
				serverTime: body?.server_time,
				causeCode: raw,
			},
		);
		return err;
	}
}

export { ERROR_CODES };

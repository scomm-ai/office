import { importSPKI, jwtVerify } from "jose";
import { BillingSdkLog } from "../logging/sdk-logger.js";
import {
  type BillingTokenError,
  type BillingTokenErrorReason,
  userMessageForTokenError,
} from "../models/billing-token-error.js";
import {
  billingTokenPayloadFromJson,
  type BillingTokenPayload,
} from "../models/billing-token-payload.js";
import { decodeJwtAlg } from "../models/json-utils.js";

export type VerifyResult =
  | { ok: true; payload: BillingTokenPayload }
  | { ok: false; error: BillingTokenError };

export class TokenVerifier {
  constructor(private readonly publicKeyPem: string) {}

  async verifyAndDecode(signedToken: string): Promise<VerifyResult> {
    const trimmed = signedToken.trim();
    if (!trimmed) {
      return this.failure("malformed");
    }

    try {
      const key = await importSPKI(this.publicKeyPem, "ES256");
      const { payload } = await jwtVerify(trimmed, key, {
        algorithms: ["ES256"],
      });
      try {
        const billingPayload = billingTokenPayloadFromJson(payload as Record<string, unknown>);
        return { ok: true, payload: billingPayload };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return this.failure("missingClaims", detail);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/expir/i.test(message)) {
        return this.failure("expired");
      }
      const alg = decodeJwtAlg(trimmed);
      if (alg) {
        BillingSdkLog.warning(
          `Token signed with alg=${alg}; SDK expects ES256 (EC key). Key must match signer.`,
        );
      }
      if (/signature|JWSInvalid|compact/i.test(message)) {
        return this.failure("invalidSignature");
      }
      return this.failure("malformed");
    }
  }

  private failure(reason: BillingTokenErrorReason, detail?: string): VerifyResult {
    let message = userMessageForTokenError(reason);
    if (reason === "missingClaims" && detail) {
      message = `${message} ${detail}`;
    }
    BillingSdkLog.error("Token verification failed", `reason=${reason} — ${message}`);
    return { ok: false, error: { message, reason } };
  }
}

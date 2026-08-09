export type BillingTokenErrorReason =
  | "invalidSignature"
  | "expired"
  | "malformed"
  | "missingClaims"
  | "unknown";

export interface BillingTokenError {
  message: string;
  reason: BillingTokenErrorReason;
}

export function userMessageForTokenError(
  reason: BillingTokenErrorReason,
  fallback = "",
): string {
  switch (reason) {
    case "invalidSignature":
      return "Invalid token. It may have been copied incorrectly.";
    case "expired":
      return "This token has expired. Please sync or get a new token from the billing portal.";
    case "malformed":
      return "Invalid format. Please paste the full token from the billing portal.";
    case "missingClaims":
      return "Token is missing required data.";
    default:
      return fallback || "Invalid token. It may have been copied incorrectly.";
  }
}

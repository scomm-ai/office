import { getKey } from "./json-utils.js";

export interface PayingParty {
  id: string;
  identityProvider: string;
  identitySubject: string;
  billingEmail: string;
  organizationName?: string;
}

export function payingPartyFromJson(json: Record<string, unknown>): PayingParty {
  const id = getKey(json, "id");
  const billingEmail = getKey(json, "billing_email", "billingEmail");
  if (typeof id !== "string" || !id) {
    throw new Error("paying_party.id required.");
  }
  if (typeof billingEmail !== "string") {
    throw new Error("paying_party.billing_email required.");
  }
  const identityProvider = getKey(json, "identity_provider", "identityProvider");
  const identitySubject = getKey(json, "identity_subject", "identitySubject");
  const ssoIdLegacy = getKey(json, "sso_id", "ssoId");
  const provider =
    typeof identityProvider === "string" && identityProvider
      ? identityProvider
      : typeof ssoIdLegacy === "string" && ssoIdLegacy
        ? "legacy"
        : null;
  const subject =
    typeof identitySubject === "string" && identitySubject
      ? identitySubject
      : typeof ssoIdLegacy === "string"
        ? ssoIdLegacy
        : null;
  if (!provider || !subject) {
    throw new Error(
      "paying_party: identity_provider and identity_subject required (or legacy sso_id).",
    );
  }
  const org = getKey(json, "organization_name", "organizationName");
  return {
    id,
    identityProvider: provider,
    identitySubject: subject,
    billingEmail,
    ...(typeof org === "string" ? { organizationName: org } : {}),
  };
}

import { dateTimeFromUnixSeconds, getKey, parseIntValue } from "./json-utils.js";

export interface BillingSubscription {
  subscriptionId: string;
  planId: string;
  productId: string;
  planName: string;
  productName: string;
  subscriptionStatus: string;
  validUntil: Date;
  validFrom?: Date;
  billingInterval?: string;
  addonCode?: string;
  usingPartyIdentityProvider?: string;
  usingPartyIdentitySubject?: string;
  usingPartyEmail?: string;
  assignedUserPartyId?: string;
}

export function isSubscriptionActive(sub: BillingSubscription): boolean {
  const status = sub.subscriptionStatus.toLowerCase();
  return status === "active" || status === "trialing";
}

export function billingSubscriptionFromJson(json: Record<string, unknown>): BillingSubscription {
  const subscriptionId = getKey(json, "subscription_id", "subscriptionId");
  const planId = getKey(json, "plan_id", "planId");
  const productId = getKey(json, "product_id", "productId");
  const planName = getKey(json, "plan_name", "planName");
  const productName = getKey(json, "product_name", "productName");
  const status = getKey(json, "subscription_status", "subscriptionStatus");
  const validUntil = getKey(json, "valid_until", "validUntil");
  if (typeof subscriptionId !== "string") {
    throw new Error("subscriptions[].subscription_id required.");
  }
  if (typeof planId !== "string") {
    throw new Error("subscriptions[].plan_id required.");
  }
  if (typeof productId !== "string") {
    throw new Error("subscriptions[].product_id required.");
  }
  if (typeof planName !== "string") {
    throw new Error("subscriptions[].plan_name required.");
  }
  if (typeof productName !== "string") {
    throw new Error("subscriptions[].product_name required.");
  }
  if (typeof status !== "string") {
    throw new Error("subscriptions[].subscription_status required.");
  }
  const validUntilInt = parseIntValue(validUntil);
  if (validUntilInt === undefined) {
    throw new Error("subscriptions[].valid_until required (Unix timestamp).");
  }
  const validFromInt = parseIntValue(getKey(json, "valid_from", "validFrom"));
  const billingIntervalRaw = getKey(json, "billing_interval", "billingInterval");
  const addon = getKey(json, "addon_code", "addonCode");
  const usingProvider = getKey(json, "using_party_identity_provider", "usingPartyIdentityProvider");
  const usingSubject = getKey(json, "using_party_identity_subject", "usingPartyIdentitySubject");
  const usingEmail = getKey(json, "using_party_email", "usingPartyEmail");
  const assigned = getKey(json, "assigned_user_party_id", "assignedUserPartyId");

  return {
    subscriptionId,
    planId,
    productId,
    planName,
    productName,
    subscriptionStatus: status,
    validUntil: dateTimeFromUnixSeconds(validUntilInt),
    ...(validFromInt !== undefined ? { validFrom: dateTimeFromUnixSeconds(validFromInt) } : {}),
    ...(typeof billingIntervalRaw === "string" && billingIntervalRaw.trim()
      ? { billingInterval: billingIntervalRaw.trim() }
      : {}),
    ...(typeof addon === "string" && addon ? { addonCode: addon } : {}),
    ...(typeof usingProvider === "string" && usingProvider
      ? { usingPartyIdentityProvider: usingProvider }
      : {}),
    ...(typeof usingSubject === "string" && usingSubject
      ? { usingPartyIdentitySubject: usingSubject }
      : {}),
    ...(typeof usingEmail === "string" && usingEmail ? { usingPartyEmail: usingEmail } : {}),
    ...(typeof assigned === "string" && assigned ? { assignedUserPartyId: assigned } : {}),
  };
}

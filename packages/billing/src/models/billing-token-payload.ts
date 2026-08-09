import { billingSubscriptionFromJson, isSubscriptionActive, type BillingSubscription } from "./billing-subscription.js";
import { dateTimeFromUnixSeconds, getKey, parseIntValue } from "./json-utils.js";
import { payingPartyFromJson, type PayingParty } from "./paying-party.js";

const DEFAULT_EXPIRES_AT = new Date(Date.UTC(2099, 11, 31));

export interface BillingTokenPayload {
  payloadVersion: number;
  expiresAt: Date;
  issuedAt?: Date;
  issuer?: string;
  audience?: string;
  payingParty: PayingParty;
  subscriptions: BillingSubscription[];
}

export function billingTokenPayloadFromJson(json: Record<string, unknown>): BillingTokenPayload {
  const version = parseIntValue(getKey(json, "payload_version", "payloadVersion"));
  if (version === undefined) {
    throw new Error("payload_version (number) required.");
  }
  const exp = parseIntValue(json.exp);
  const expiresAt = exp !== undefined ? dateTimeFromUnixSeconds(exp) : DEFAULT_EXPIRES_AT;
  const payingPartyRaw = getKey(json, "paying_party", "payingParty");
  if (typeof payingPartyRaw !== "object" || payingPartyRaw === null) {
    throw new Error("paying_party object required.");
  }
  const payingParty = payingPartyFromJson(payingPartyRaw as Record<string, unknown>);
  const subscriptionsRaw = json.subscriptions;
  if (!Array.isArray(subscriptionsRaw)) {
    throw new Error("subscriptions array required.");
  }
  const subscriptions = subscriptionsRaw.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`subscriptions[${index}] must be an object.`);
    }
    return billingSubscriptionFromJson(item as Record<string, unknown>);
  });
  const iat = parseIntValue(json.iat);
  return {
    payloadVersion: version,
    expiresAt,
    payingParty,
    subscriptions,
    ...(iat !== undefined ? { issuedAt: dateTimeFromUnixSeconds(iat) } : {}),
    ...(typeof json.iss === "string" ? { issuer: json.iss } : {}),
    ...(typeof json.aud === "string" ? { audience: json.aud } : {}),
  };
}

export function payloadHasPlan(payload: BillingTokenPayload, planId: string): boolean {
  return payload.subscriptions.some((s) => s.planId === planId && isSubscriptionActive(s));
}

export function payloadHasProduct(payload: BillingTokenPayload, productId: string): boolean {
  return payload.subscriptions.some((s) => s.productId === productId && isSubscriptionActive(s));
}

export function payloadHasAddon(payload: BillingTokenPayload, addonCode: string): boolean {
  const target = addonCode.trim().toLowerCase();
  return payload.subscriptions.some(
    (s) => isSubscriptionActive(s) && s.addonCode?.toLowerCase() === target,
  );
}

export function payloadIsExpired(payload: BillingTokenPayload): boolean {
  return Date.now() > payload.expiresAt.getTime();
}

/** Well-known add-on codes aligned with secMail marketplace. */
export const BILLING_ADDON_AI_ASSISTANT = "ai_assistant";

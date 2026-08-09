import {
  BILLING_ADDON_AI_ASSISTANT,
  payloadHasAddon,
  type BillingTokenPayload,
} from "@scomm-office/billing";

export interface AiEntitlementPolicy {
  /** When true, missing entitlement blocks cloud/local premium AI. Default true. */
  requireAiAddon: boolean;
}

export function hasAiEntitlement(
  payload: BillingTokenPayload | null | undefined,
  policy: AiEntitlementPolicy = { requireAiAddon: true },
): boolean {
  if (!policy.requireAiAddon) {
    return true;
  }
  if (!payload) {
    return false;
  }
  return payloadHasAddon(payload, BILLING_ADDON_AI_ASSISTANT);
}

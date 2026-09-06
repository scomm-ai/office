/** Catalog code for premium AI (cloud BYOAI / local IDR). */
export const BILLING_ADDON_AI_ASSISTANT = "ai_assistant";

export interface AiEntitlementPolicy {
  /** When true, missing entitlement blocks cloud/local premium AI. Default true. */
  requireAiAddon: boolean;
}

/** Gate from `@2key/browser-sdk` entitlements — do not parse JWTs here. */
export interface AddonGate {
  hasAddon: (code: string) => boolean;
  hasOffering?: (code: string) => boolean;
}

/**
 * Fail-closed AI gate: require `ai_assistant` unless the policy turns that off.
 */
export function hasAiEntitlement(
  gate: AddonGate | null | undefined,
  policy: AiEntitlementPolicy = { requireAiAddon: true },
): boolean {
  if (!policy.requireAiAddon) {
    return true;
  }
  if (!gate) {
    return false;
  }
  return (
    gate.hasAddon(BILLING_ADDON_AI_ASSISTANT) ||
    Boolean(gate.hasOffering?.(BILLING_ADDON_AI_ASSISTANT))
  );
}

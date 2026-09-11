/** Catalog code for premium AI (cloud BYOAI / local IDR). */
export const BILLING_ADDON_AI_ASSISTANT = "ai_assistant";

export interface AiEntitlementPolicy {
  /** When true, missing entitlement blocks cloud/local premium AI. Default true. */
  requireAiAddon: boolean;
}

/** Product → feature → `{ count, …resources }` from SDK `normalizedEntitlements()`. */
export type LicenseNormalizedProducts = Record<
  string,
  Record<string, Record<string, number>>
>;

/** Gate JSON from `@2key/browser-sdk` — do not parse JWTs here. */
export interface AddonGate {
  products?: LicenseNormalizedProducts;
}

/**
 * SUM of `count` for [feature] across every product. Tenant-unaware.
 */
export function licenseFeatureCount(
  products: LicenseNormalizedProducts | undefined,
  feature: string,
): number {
  if (!products) return 0;
  const needle = feature.trim();
  if (!needle) return 0;
  let total = 0;
  for (const features of Object.values(products)) {
    const n = features[needle]?.count;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      total += n;
    }
  }
  return total;
}

/**
 * Fail-closed AI gate: require `ai_assistant` count >= 1 unless the policy turns that off.
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
  return licenseFeatureCount(gate.products, BILLING_ADDON_AI_ASSISTANT) >= 1;
}

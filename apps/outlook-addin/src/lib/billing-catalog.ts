import { catalogForHost, type OfferingCatalog } from "@2key/browser-sdk/billing";
import hosts from "./hosts.json";

/** Catalog code for premium AI (cloud BYOAI / local IDR). */
export const BILLING_ADDON_AI_ASSISTANT = "ai_assistant";

/** Catalog code for Outlook OpenPGP ECC (classical). Office-only SKU. */
export const BILLING_ADDON_PGP = "pgp";

/**
 * Catalog code for Outlook OpenPGP ECC+PQC. Shared with Email.
 * Catalog-ready only — do not show a PQC buy CTA until a PQC engine ships.
 */
export const BILLING_ADDON_PQC = "pqc";

/**
 * Product → feature → `{ count, …resources }` from SDK `normalizedEntitlements()`.
 */
export type LicenseNormalizedProducts = Record<
  string,
  Record<string, Record<string, number>>
>;

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
 * Fail-closed paid-function gate: `count >= 1` for [feature].
 */
export function licenseGrantsFeature(
  products: LicenseNormalizedProducts | undefined,
  feature: string,
): boolean {
  return licenseFeatureCount(products, feature) >= 1;
}

/**
 * Offerings this Outlook binary knows how to gate.
 * Baked from seed-repo `hosts.json` at build time (`hosts.office`).
 * Intersected with the verified license JWT by `@2key/browser-sdk`.
 */
export const SCOMM_OFFICE_CATALOG: OfferingCatalog = catalogForHost(hosts, "office");

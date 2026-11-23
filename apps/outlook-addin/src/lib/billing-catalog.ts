import { OfferingCatalog } from "@2key/browser-sdk/billing";
import catalogExport from "./billing-catalog-export.json";

/** Catalog code for premium AI (cloud BYOAI / local IDR). */
export const BILLING_ADDON_AI_ASSISTANT = "ai_assistant";

/** Catalog code for Outlook OpenPGP ECC (classical). Office-only SKU. */
export const BILLING_ADDON_PGP = "pgp";

/**
 * Catalog code for Outlook OpenPGP ECC+PQC. Shared with Email.
 * Catalog-ready only: do not show a PQC buy CTA until a PQC engine ships.
 */
export const BILLING_ADDON_PQC = "pqc";

/**
 * Offering codes this Outlook binary knows how to gate. Never list `linux`
 * or `accent_color`. `pqc` is here so a future engine can gate; until then
 * omit PQC upsell UI.
 */
export const OFFICE_ADDON_CODES: readonly string[] = [
  BILLING_ADDON_PGP,
  BILLING_ADDON_PQC,
  BILLING_ADDON_AI_ASSISTANT,
];

/**
 * Billing's public catalog export, bundled at build time; the add-in never
 * fetches it. Codes the license grants but this catalog does not know unlock
 * nothing. Regenerate from the billing repo:
 * `npm run billing-seed -- export --dir ../2key-scomm-seed-templates --out <this folder>/billing-catalog-export.json`
 *
 * Not narrowed to a host: the `pgp` offering has the `office` surface while
 * the shared add-ons have `scomm`, and both are gated here.
 */
export const SCOMM_OFFICE_CATALOG: OfferingCatalog = OfferingCatalog.fromJson(catalogExport);

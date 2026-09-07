import type { OfferingCatalog } from "@2key/browser-sdk/billing";

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
 * Offerings this Outlook binary knows how to gate.
 * Intersected with the verified license JWT by `@2key/browser-sdk`.
 * Not `@2key/catalog-scomm` (that's Workflows FSM).
 *
 * Never list `linux` or `accent_color`. `pqc` is in the catalog so a future
 * engine can gate; until then omit PQC upsell UI.
 *
 * `productIds` should match JWT `offerings[].product_id` (SecMail
 * `products.id` as a decimal string). `prod_mail` / `secmail` are SDK
 * fixture aliases, not live bigint ids.
 */
export const SCOMM_OFFICE_CATALOG: OfferingCatalog = {
  productIds: ["prod_mail", "secmail"],
  offeringCodes: [
    "pgp",
    "pqc",
    "ai_assistant",
    "scomm_connector",
    "scomm_connector_5",
  ],
  addonCodes: ["pgp", "pqc", "ai_assistant", "scomm_connector"],
};

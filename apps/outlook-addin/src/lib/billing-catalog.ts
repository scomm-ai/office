import type { OfferingCatalog } from "@2key/browser-sdk/billing";

/** Catalog code for premium AI (cloud BYOAI / local IDR). */
export const BILLING_ADDON_AI_ASSISTANT = "ai_assistant";

/**
 * Offerings this Outlook binary knows how to gate.
 * Intersected with the verified license JWT by `@2key/browser-sdk`.
 * Not `@2key/catalog-scomm` (that's Workflows FSM).
 */
export const SCOMM_OFFICE_CATALOG: OfferingCatalog = {
  productIds: ["prod_mail", "secmail"],
  offeringCodes: [
    "ai_assistant",
    "scomm_connector",
    "scomm_connector_5",
    "pgp",
    "linux",
  ],
  addonCodes: ["ai_assistant", "scomm_connector", "pgp", "linux"],
};

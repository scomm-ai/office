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
 * Offerings this Outlook binary knows how to gate.
 * Baked from seed-repo `hosts.json` at build time (`hosts.office`).
 * Intersected with the verified license JWT by `@2key/browser-sdk`.
 */
export const SCOMM_OFFICE_CATALOG: OfferingCatalog = catalogForHost(hosts, "office");

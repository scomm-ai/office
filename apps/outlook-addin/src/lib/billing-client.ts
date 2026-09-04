import {
  createBillingClient,
  type BillingClient,
} from "@2key/browser-sdk/billing";
import { SCOMM_OFFICE_CATALOG } from "./billing-catalog";
import { BILLING_PUBLIC_KEY_PEM } from "./billing-public-key";
import { officeBillingSessionStore } from "./office-session-store";

const STORAGE_PREFIX = "scomm-office";

/**
 * Host wiring for `@2key/browser-sdk`. Recreate when billing origin or portal URL changes.
 *
 * @param portalBaseUrl Settings billing portal URL — used by shop/portal helpers.
 */
export function createOfficeBillingClient(
  apiBaseUrl: string,
  portalBaseUrl?: string,
): BillingClient {
  const portal = portalBaseUrl?.trim();
  return createBillingClient(
    {
      apiBaseUrl,
      publicKeyPem: BILLING_PUBLIC_KEY_PEM,
      storagePrefix: STORAGE_PREFIX,
      catalog: SCOMM_OFFICE_CATALOG,
      ...(portal ? { portalBaseUrl: portal } : {}),
    },
    { store: officeBillingSessionStore(), accountKey: "default" },
  );
}

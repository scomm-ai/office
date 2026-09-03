import {
  createBillingClient,
  localStorageSessionStore,
  type BillingClient,
} from "@2key/browser-sdk/billing";
import { SCOMM_OFFICE_CATALOG } from "./billing-catalog";
import { BILLING_PUBLIC_KEY_PEM } from "./billing-public-key";

const STORAGE_PREFIX = "scomm-office";

/**
 * Host wiring for `@2key/browser-sdk`. Recreate when billing origin changes.
 */
export function createOfficeBillingClient(apiBaseUrl: string): BillingClient {
  return createBillingClient(
    {
      apiBaseUrl,
      publicKeyPem: BILLING_PUBLIC_KEY_PEM,
      storagePrefix: STORAGE_PREFIX,
      catalog: SCOMM_OFFICE_CATALOG,
    },
    { store: localStorageSessionStore(), accountKey: "default" },
  );
}

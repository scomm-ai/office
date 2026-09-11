import {
  BILLING_ADDON_PGP,
  licenseGrantsFeature,
  type LicenseNormalizedProducts,
} from "./billing-catalog";
import { createOfficeBillingClient } from "./billing-client";
import { loadSettingsFromStorage } from "./settings";

/** Shown when encrypt / sign / publish run without a verified `pgp` add-on. */
export const PGP_ADDON_REQUIRED_MESSAGE =
  'OpenPGP encrypt, sign, and key publish require the "pgp" add-on. Sync Account & Billing or open the billing portal.';

/** Gate JSON from `@2key/browser-sdk` `normalizedEntitlements()`. Do not parse JWTs here. */
export interface PgpAddonGate {
  products?: LicenseNormalizedProducts;
}

/**
 * Fail-closed: true only when the verified license lists `pgp` with count >= 1.
 * Decrypt and signature verify stay available without this add-on.
 */
export function hasPgpEntitlement(gate: PgpAddonGate | null | undefined): boolean {
  if (!gate) {
    return false;
  }
  try {
    return licenseGrantsFeature(gate.products, BILLING_ADDON_PGP);
  } catch {
    return false;
  }
}

/**
 * Local-only escape hatch so the "pgp" add-on paywall doesn't block testing
 * against a dev pubkey server with no real billing backend. Gated on
 * `import.meta.env.DEV` (false in a production build, regardless of this
 * flag) so it can never ship — set VITE_DEV_SKIP_PGP_ADDON=1 in an untracked
 * .env.local to enable it locally.
 */
function devSkipsPgpAddon(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_DEV_SKIP_PGP_ADDON === "1";
}

/**
 * Restore the cached license for the current billing origin and answer the `pgp` gate.
 * Empty origin (no Settings value) is not entitled. Restore/network failures fail closed.
 */
export async function loadPgpEntitlement(apiBaseUrl?: string): Promise<boolean> {
  if (devSkipsPgpAddon()) return true;
  const origin =
    apiBaseUrl !== undefined
      ? apiBaseUrl.trim()
      : loadSettingsFromStorage().billingOrigin?.trim() || "";
  if (!origin) {
    return false;
  }
  try {
    const billing = createOfficeBillingClient(origin);
    await billing.restore();
    return hasPgpEntitlement(billing.normalizedEntitlements());
  } catch {
    return false;
  }
}

/** Throw if the current session is not entitled to paid OpenPGP actions. */
export async function assertPgpAddon(apiBaseUrl?: string): Promise<void> {
  if (!(await loadPgpEntitlement(apiBaseUrl))) {
    throw new Error(PGP_ADDON_REQUIRED_MESSAGE);
  }
}

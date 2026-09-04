import { BILLING_ADDON_PGP } from "./billing-catalog";
import { createOfficeBillingClient } from "./billing-client";
import { loadSettingsFromStorage } from "./settings";

/** Shown when encrypt / sign / publish run without a verified `pgp` add-on. */
export const PGP_ADDON_REQUIRED_MESSAGE =
  'OpenPGP encrypt, sign, and key publish require the "pgp" add-on. Sync Account & Billing or open the billing portal.';

/** Gate shape from `@2key/browser-sdk` — do not parse JWTs here. */
export interface PgpAddonGate {
  hasAddon: (code: string) => boolean;
  hasOffering?: (code: string) => boolean;
}

/**
 * Fail-closed: true only when the verified license lists `pgp`.
 * Decrypt and signature verify stay available without this add-on.
 */
export function hasPgpEntitlement(gate: PgpAddonGate | null | undefined): boolean {
  if (!gate) {
    return false;
  }
  try {
    return gate.hasAddon(BILLING_ADDON_PGP) || Boolean(gate.hasOffering?.(BILLING_ADDON_PGP));
  } catch {
    return false;
  }
}

/**
 * Restore the cached license for the current billing origin and answer the `pgp` gate.
 * Empty origin (no Settings value) is not entitled. Restore/network failures fail closed.
 */
export async function loadPgpEntitlement(apiBaseUrl?: string): Promise<boolean> {
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
    return hasPgpEntitlement(billing);
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

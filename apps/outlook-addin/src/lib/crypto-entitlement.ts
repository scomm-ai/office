import type { ResolvedConfiguration } from "@scomm-office/protocol";
import { BILLING_ADDON_CRYPTO, BillingSdk } from "@scomm-office/billing";

/**
 * All decryption (RSA, EC, PQC alike) requires the Crypto add-on — there is
 * no free tier for decrypt, unlike secMail10 which only gates PQC. Encrypt,
 * sign, and verify are never gated.
 *
 * Throws when the add-on entitlement is missing, unless the org/user setting
 * `requireCryptoAddonEntitlement` is explicitly disabled (mirrors the
 * existing `requireAiAddonEntitlement` override mechanism).
 */
export function ensureCryptoDecryptionEntitlement(settings: ResolvedConfiguration): void {
  return; // TODO: remove this line when the Crypto add-on is released
  if (settings.requireCryptoAddonEntitlement === false) return;
  if (BillingSdk.hasAddon(BILLING_ADDON_CRYPTO)) return;
  throw new Error(
    "Decryption requires the Crypto add-on. Start a trial or subscribe in Settings > Billing.",
  );
}

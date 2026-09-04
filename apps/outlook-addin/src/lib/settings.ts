import type { ResolvedConfiguration } from "@scomm-office/protocol";

export const SETTINGS_STORAGE_KEY = "scomm-office.settings.v1";

const defaultPubkeyRead =
  import.meta.env.VITE_PUBKEY_READ_BASE_URL ??
  import.meta.env.VITE_PUBKEY_SERVER_URL ??
  "";

const defaultBillingOrigin = import.meta.env.VITE_BILLING_ORIGIN ?? "";

export const DEFAULT_SETTINGS: ResolvedConfiguration = {
  // Fixture-only; product paths ignore this when billing/pubkey envs are set.
  scommServerUrl: import.meta.env.VITE_SCOMM_SERVER_URL || undefined,
  pubkeyServerUrl: import.meta.env.VITE_PUBKEY_SERVER_URL || undefined,
  pubkeyReadBaseUrl: defaultPubkeyRead || undefined,
  pubkeyWriteBaseUrl: import.meta.env.VITE_PUBKEY_WRITE_BASE_URL || undefined,
  billingOrigin: defaultBillingOrigin || undefined,
  billingPortalUrl: import.meta.env.VITE_BILLING_PORTAL_URL || defaultBillingOrigin || undefined,
  idrTargetHost: import.meta.env.VITE_IDR_HOST ?? "",
  idrDefaultService: import.meta.env.VITE_IDR_SERVICE ?? "ollama",
  semanticAnalysisEnabled: true,
  complianceEnabled: true,
  experimentalEncryptionEnabled: false,
  diagnosticsEnabled: true,
  requireAiAddonEntitlement: true,
};

export function loadSettingsFromStorage(): ResolvedConfiguration {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<ResolvedConfiguration>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettingsToStorage(settings: ResolvedConfiguration): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function formatAddresses(
  addresses: Array<{ emailAddress: string; displayName?: string }> | undefined,
): string {
  if (!addresses?.length) {
    return "—";
  }
  return addresses
    .map((address) =>
      address.displayName ? `${address.displayName} <${address.emailAddress}>` : address.emailAddress,
    )
    .join(", ");
}

export function resolvePubkeyReadBaseUrl(settings: ResolvedConfiguration): string {
  return (
    settings.pubkeyReadBaseUrl ||
    settings.pubkeyServerUrl ||
    settings.scommServerUrl ||
    "https://pubkey.scomm.ai"
  );
}

export function resolvePubkeyWriteBaseUrl(settings: ResolvedConfiguration): string {
  return settings.pubkeyWriteBaseUrl || "https://pubkey.scomm.ai";
}

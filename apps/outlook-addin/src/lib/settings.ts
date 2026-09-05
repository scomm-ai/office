import type { ResolvedConfiguration } from "@scomm-office/protocol";

export const SETTINGS_STORAGE_KEY = "scomm-office.settings.v1";

/** Production directory when VITE_PUBKEY_* is unset. */
export const PRODUCTION_PUBKEY_READ_URL = "https://pubkey.scomm.ai";
export const PRODUCTION_PUBKEY_WRITE_URL = "https://api.pubkey.scomm.ai";

function envString(name: "VITE_PUBKEY_READ_BASE_URL" | "VITE_PUBKEY_WRITE_BASE_URL" | "VITE_PUBKEY_SERVER_URL"): string {
  const value =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: Record<string, string | undefined> }).env?.[name]
      : undefined;
  return value?.trim() || "";
}

/** Pubkey directory — task pane and OnMessageSend. Comes from `.env` only. */
export function envPubkeyReadBaseUrl(): string {
  return envString("VITE_PUBKEY_READ_BASE_URL") || envString("VITE_PUBKEY_SERVER_URL") || PRODUCTION_PUBKEY_READ_URL;
}

/** Pubkey mutate/enroll host — `.env` only. Local pubkey often uses the same origin as read. */
export function envPubkeyWriteBaseUrl(): string {
  return envString("VITE_PUBKEY_WRITE_BASE_URL") || envString("VITE_PUBKEY_SERVER_URL") || PRODUCTION_PUBKEY_WRITE_URL;
}

const defaultBillingOrigin = import.meta.env.VITE_BILLING_ORIGIN ?? "";

export const DEFAULT_SETTINGS: ResolvedConfiguration = {
  // Fixture-only; product paths ignore this when billing/pubkey envs are set.
  scommServerUrl: import.meta.env.VITE_SCOMM_SERVER_URL || undefined,
  pubkeyServerUrl: envPubkeyReadBaseUrl(),
  pubkeyReadBaseUrl: envPubkeyReadBaseUrl(),
  pubkeyWriteBaseUrl: envPubkeyWriteBaseUrl(),
  billingOrigin: defaultBillingOrigin || undefined,
  billingPortalUrl: import.meta.env.VITE_BILLING_PORTAL_URL || defaultBillingOrigin || undefined,
  idrTargetHost: import.meta.env.VITE_IDR_HOST ?? "",
  idrDefaultService: import.meta.env.VITE_IDR_SERVICE ?? "ollama",
  semanticAnalysisEnabled: true,
  complianceEnabled: true,
  experimentalEncryptionEnabled: false,
  diagnosticsEnabled: true,
  requireAiAddonEntitlement: true,
  requireCryptoAddonEntitlement: true,
};

export function loadSettingsFromStorage(): ResolvedConfiguration {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<ResolvedConfiguration>;
    const {
      pubkeyReadBaseUrl: _read,
      pubkeyWriteBaseUrl: _write,
      pubkeyServerUrl: _server,
      ...rest
    } = parsed;
    return {
      ...DEFAULT_SETTINGS,
      ...rest,
      pubkeyReadBaseUrl: envPubkeyReadBaseUrl(),
      pubkeyWriteBaseUrl: envPubkeyWriteBaseUrl(),
      pubkeyServerUrl: envPubkeyReadBaseUrl(),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettingsToStorage(settings: ResolvedConfiguration): void {
  const {
    pubkeyReadBaseUrl: _read,
    pubkeyWriteBaseUrl: _write,
    pubkeyServerUrl: _server,
    ...rest
  } = settings;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(rest));
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

/** Always `.env` / production fallback — Settings cannot override pubkey hosts. */
export function resolvePubkeyReadBaseUrl(_settings?: ResolvedConfiguration): string {
  return envPubkeyReadBaseUrl();
}

export function resolvePubkeyWriteBaseUrl(_settings?: ResolvedConfiguration): string {
  return envPubkeyWriteBaseUrl();
}

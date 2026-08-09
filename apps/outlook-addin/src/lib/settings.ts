import type { ResolvedConfiguration } from "@scomm-office/protocol";

export const SETTINGS_STORAGE_KEY = "scomm-office.settings.v1";

export const DEFAULT_SETTINGS: ResolvedConfiguration = {
  scommServerUrl: import.meta.env.VITE_SCOMM_SERVER_URL ?? "http://localhost:8787",
  pubkeyServerUrl: import.meta.env.VITE_PUBKEY_SERVER_URL ?? "http://localhost:8787",
  idrTargetHost: import.meta.env.VITE_IDR_HOST ?? "",
  idrDefaultService: import.meta.env.VITE_IDR_SERVICE ?? "ollama",
  semanticAnalysisEnabled: true,
  complianceEnabled: true,
  experimentalEncryptionEnabled: false,
  diagnosticsEnabled: true,
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

import type { ResolvedConfiguration } from "@scomm-office/protocol";

export const SETTINGS_STORAGE_KEY = "scomm-office.settings.v1";
export const ENV_HOST_SNAPSHOT_KEY = "scomm-office.settings.env-hosts.v1";

/** Same-origin prefixes used on localhost (see apps/outlook-addin/vite.config.ts). */
export const PUBKEY_READ_PROXY_PATH = "/pubkey-read";
export const PUBKEY_WRITE_PROXY_PATH = "/pubkey-write";

const ENV_HOST_SETTING_KEYS = [
  "scommServerUrl",
  "pubkeyServerUrl",
  "pubkeyReadBaseUrl",
  "pubkeyWriteBaseUrl",
  "billingOrigin",
  "billingPortalUrl",
] as const;

type EnvHostSettingKey = (typeof ENV_HOST_SETTING_KEYS)[number];

const defaultPubkeyRead =
  import.meta.env.VITE_PUBKEY_READ_BASE_URL ||
  import.meta.env.VITE_PUBKEY_SERVER_URL ||
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

export function envHostSnapshot(
  settings: Pick<ResolvedConfiguration, EnvHostSettingKey>,
): Record<EnvHostSettingKey, string> {
  return {
    scommServerUrl: settings.scommServerUrl ?? "",
    pubkeyServerUrl: settings.pubkeyServerUrl ?? "",
    pubkeyReadBaseUrl: settings.pubkeyReadBaseUrl ?? "",
    pubkeyWriteBaseUrl: settings.pubkeyWriteBaseUrl ?? "",
    billingOrigin: settings.billingOrigin ?? "",
    billingPortalUrl: settings.billingPortalUrl ?? "",
  };
}

/**
 * Overlay stored settings on env defaults. When a host URL in `.env` changes
 * (after Vite restart), that key is taken from env even if localStorage still
 * has the previous value.
 */
export function applyEnvHostUpdates(
  stored: Partial<ResolvedConfiguration> | null,
  envDefaults: ResolvedConfiguration,
  previousSnapshot: Record<string, string> | null,
): { settings: ResolvedConfiguration; snapshot: Record<EnvHostSettingKey, string> } {
  const snapshot = envHostSnapshot(envDefaults);
  if (!stored) {
    return { settings: { ...envDefaults }, snapshot };
  }
  const merged: ResolvedConfiguration = { ...envDefaults, ...stored };
  if (!previousSnapshot) {
    for (const key of ENV_HOST_SETTING_KEYS) {
      merged[key] = envDefaults[key];
    }
    return { settings: merged, snapshot };
  }
  for (const key of ENV_HOST_SETTING_KEYS) {
    if ((previousSnapshot[key] ?? "") !== snapshot[key]) {
      merged[key] = envDefaults[key];
    }
  }
  return { settings: merged, snapshot };
}

export function loadSettingsFromStorage(): ResolvedConfiguration {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<ResolvedConfiguration>) : null;
    let previousSnapshot: Record<string, string> | null = null;
    const previousRaw = localStorage.getItem(ENV_HOST_SNAPSHOT_KEY);
    if (previousRaw) {
      previousSnapshot = JSON.parse(previousRaw) as Record<string, string>;
    }
    const { settings, snapshot } = applyEnvHostUpdates(stored, DEFAULT_SETTINGS, previousSnapshot);
    localStorage.setItem(ENV_HOST_SNAPSHOT_KEY, JSON.stringify(snapshot));
    if (stored && JSON.stringify(stored) !== JSON.stringify(settings)) {
      saveSettingsToStorage(settings);
    }
    return settings;
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

/** Production pubkey origin used for both read and write. */
export const PRODUCTION_PUBKEY_ORIGIN = "https://pubkey.scomm.ai";

/**
 * True for localhost / loopback hosts, including IPv6 (`::1`) used by some WebViews.
 */
export function isLoopbackHostname(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1"
  );
}

/**
 * Production read and write share pubkey.scomm.ai. api.pubkey.scomm.ai is not in DNS.
 */
export function normalizePubkeyWriteBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "api.pubkey.scomm.ai") {
      return PRODUCTION_PUBKEY_ORIGIN;
    }
  } catch {
    return url;
  }
  return url.replace(/\/+$/, "") || PRODUCTION_PUBKEY_ORIGIN;
}

function configuredPubkeyReadBaseUrl(settings: ResolvedConfiguration): string {
  return (
    settings.pubkeyReadBaseUrl ||
    settings.pubkeyServerUrl ||
    settings.scommServerUrl ||
    PRODUCTION_PUBKEY_ORIGIN
  );
}

/**
 * Resolve the read API base. On localhost the Vite proxy avoids mixed content
 * (HTTPS task pane → HTTP pubkey) — traffic goes to `/pubkey-read`.
 */
export function resolvePubkeyReadBaseUrl(
  settings: ResolvedConfiguration,
  location: Pick<Location, "hostname" | "origin"> | undefined =
    typeof globalThis.location === "undefined" ? undefined : globalThis.location,
): string {
  const configured = configuredPubkeyReadBaseUrl(settings);
  if (location && isLoopbackHostname(location.hostname)) {
    return `${location.origin}${PUBKEY_READ_PROXY_PATH}`;
  }
  return configured;
}

/**
 * Write API base. On localhost the Vite sticky proxy keeps one keep-alive
 * socket so decrypt-challenge + encryption upload share an HTTP session.
 */
export function resolvePubkeyWriteBaseUrl(
  settings: ResolvedConfiguration,
  location: Pick<Location, "hostname" | "origin"> | undefined =
    typeof globalThis.location === "undefined" ? undefined : globalThis.location,
): string {
  const configured = normalizePubkeyWriteBaseUrl(
    settings.pubkeyWriteBaseUrl || PRODUCTION_PUBKEY_ORIGIN,
  );
  if (location && isLoopbackHostname(location.hostname)) {
    return `${location.origin}${PUBKEY_WRITE_PROXY_PATH}`;
  }
  return configured;
}

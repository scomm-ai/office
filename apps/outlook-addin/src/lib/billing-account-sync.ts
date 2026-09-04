import type { LicenseEntitlementsView } from "@2key/browser-sdk/billing";
import { TwoKeyError } from "@2key/browser-sdk/billing";
import { SCOMM_OFFICE_CATALOG } from "./billing-catalog";

/** Online = billing API (login required). Office = restore cached JWT only. */
export type LicenseSyncKind = "online" | "office";

export type ReplaceableLicenseDevice = {
  ski: string;
  friendlyName?: string;
  platform?: string;
};

export type DeviceLimitState = {
  message: string;
  maxDevices?: number;
  devices: ReplaceableLicenseDevice[];
};

/**
 * Billing SSO is separate from the Outlook mailbox. Online license sync and
 * device bind need a billing session; office sync does not.
 */
export function hasBillingAuth(input: {
  sessionToken?: string | null;
  accessToken?: string | null;
}): boolean {
  return Boolean(input.sessionToken?.trim() || input.accessToken?.trim());
}

export function onlineSyncBlockedReason(signedIn: boolean): string | null {
  if (signedIn) return null;
  return "Sign in to billing to sync online and register this device. Office sync can still restore a cached license.";
}

/**
 * Active catalog add-ons from a verified license. Never includes prices.
 */
export function activeAddonCodes(
  gate: Pick<LicenseEntitlementsView, "hasAddon" | "hasOffering"> | null | undefined,
  catalogAddonCodes: readonly string[] = SCOMM_OFFICE_CATALOG.addonCodes,
): string[] {
  if (!gate) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of catalogAddonCodes) {
    const key = code.trim();
    if (!key || seen.has(key)) continue;
    try {
      if (gate.hasAddon(key) || gate.hasOffering(key)) {
        seen.add(key);
        out.push(key);
      }
    } catch {
      /* fail closed for this code */
    }
  }
  return out;
}

export function parseDeviceLimitError(error: unknown): DeviceLimitState | null {
  if (!(error instanceof TwoKeyError) || error.code !== "conflict") {
    return null;
  }
  const details = asRecord(error.details);
  const devices: ReplaceableLicenseDevice[] = [];
  const rawDevices = details.devices;
  if (Array.isArray(rawDevices)) {
    for (const item of rawDevices) {
      const row = asRecord(item);
      const ski = stringField(row, "ski");
      if (!ski) continue;
      devices.push({
        ski,
        friendlyName: stringField(row, "friendlyName") || stringField(row, "friendly_name"),
        platform: stringField(row, "platform"),
      });
    }
  }
  const maxRaw = details.maxDevices ?? details.max_devices;
  const maxDevices =
    typeof maxRaw === "number" && Number.isFinite(maxRaw)
      ? maxRaw
      : typeof maxRaw === "string"
        ? Number(maxRaw) || undefined
        : undefined;
  return {
    message: error.message,
    maxDevices,
    devices,
  };
}

export function deviceBoundLabel(bound: boolean, ski: string | null): string {
  if (!ski) return "—";
  return bound ? `bound · ${shortSki(ski)}` : `local · ${shortSki(ski)} (not registered)`;
}

export function shortSki(ski: string): string {
  const t = ski.trim();
  if (t.length <= 14) return t;
  return `${t.slice(0, 10)}…`;
}

/**
 * Public device identity for portal paste (Settings → Devices).
 * Matches Dart `encodePublicJwkForPortal`.
 */
export function encodePublicJwkForPortal(
  publicJwk: Record<string, unknown>,
  friendlyName?: string,
): string {
  const name = friendlyName?.trim();
  const body = name ? { friendlyName: name, publicJwk } : publicJwk;
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** Same rules as billing `normalizeFriendlyName`: 1–15 of A–Z, 0–9, hyphen. */
export const DEVICE_FRIENDLY_NAME_PATTERN = /^[A-Za-z0-9-]{1,15}$/;

export function validateDeviceFriendlyName(raw: string | undefined): string | null {
  const name = raw?.trim() ?? "";
  if (!DEVICE_FRIENDLY_NAME_PATTERN.test(name)) {
    return "Device name must be 1–15 characters: A–Z, 0–9, and hyphens.";
  }
  return null;
}

/**
 * Open-portal URL: Settings `billingPortalUrl` wins over shop URL derived from the API origin.
 */
export function resolveBillingPortalOpenUrl(input: {
  portalUrl?: string | null;
  fallbackShopUrl: string;
}): string {
  const portal = input.portalUrl?.trim();
  if (portal) return portal;
  return input.fallbackShopUrl.trim();
}

const CLIPBOARD_TIMEOUT_MS = 1500;

/**
 * Copy text in Office WebViews. `navigator.clipboard` often exists but hangs
 * or rejects; fall back to selecting a field / execCommand.
 */
export async function copyTextToClipboard(
  text: string,
  field?: HTMLTextAreaElement | HTMLInputElement | null,
): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;

  const clip = globalThis.navigator?.clipboard;
  if (clip && typeof clip.writeText === "function") {
    try {
      await Promise.race([
        clip.writeText(value),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("clipboard-timeout")), CLIPBOARD_TIMEOUT_MS);
        }),
      ]);
      return true;
    } catch {
      /* fall through */
    }
  }

  if (field) {
    try {
      field.focus();
      field.select();
      if (typeof document !== "undefined" && document.execCommand("copy")) {
        return true;
      }
    } catch {
      /* fall through */
    }
  }

  if (typeof document === "undefined" || !document.body) {
    return false;
  }
  const temp = document.createElement("textarea");
  temp.value = value;
  temp.setAttribute("readonly", "");
  temp.style.position = "fixed";
  temp.style.left = "-9999px";
  document.body.appendChild(temp);
  temp.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    temp.remove();
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function stringField(row: Record<string, unknown>, key: string): string | undefined {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

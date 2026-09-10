import { isLocalProvider, type CloudAiProfile, type CloudAiProviderKind } from "@scomm-office/byoai";

export const BYOAI_PROFILES_KEY = "scomm-office.byoai.profiles.v1";

export function loadProfiles(): CloudAiProfile[] {
  try {
    const raw = localStorage.getItem(BYOAI_PROFILES_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as CloudAiProfile[];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: CloudAiProfile[]): void {
  localStorage.setItem(BYOAI_PROFILES_KEY, JSON.stringify(profiles));
}

export function isProfileReady(profile: CloudAiProfile): boolean {
  return profile.hasApiKey || isLocalProvider(profile.provider);
}

export function defaultProfile(profiles: CloudAiProfile[]): CloudAiProfile | null {
  return profiles.find((p) => p.isDefault && isProfileReady(p)) ?? profiles.find(isProfileReady) ?? null;
}

/**
 * Finds an already-saved profile that a candidate (provider + base URL +
 * model, case/whitespace-insensitive) would exactly duplicate. Used to stop
 * repeated "Add" clicks — or a slow double-click — from creating N identical
 * profiles: the caller selects the existing match instead of inserting a new one.
 */
export function findDuplicateProfile(
  profiles: CloudAiProfile[],
  candidate: { provider: CloudAiProviderKind; baseUrl: string; model: string },
): CloudAiProfile | null {
  const baseUrl = candidate.baseUrl.trim().toLowerCase();
  const model = candidate.model.trim().toLowerCase();
  return (
    profiles.find(
      (p) =>
        p.provider === candidate.provider &&
        p.baseUrl.trim().toLowerCase() === baseUrl &&
        p.model.trim().toLowerCase() === model,
    ) ?? null
  );
}

import { describe, expect, it, vi } from "vitest";

// @scomm-office/byoai's barrel pulls in @scomm-office/idr, whose browser-only
// transport touches HTMLElement at module load; stub it out for the node test env.
vi.mock("@scomm-office/idr", () => ({
  OllamaViaIdrProvider: class {
    generate(): never {
      throw new Error("not used in these tests");
    }
  },
}));
const { createCloudProfile } = await import("@scomm-office/byoai");
const { defaultProfile, findDuplicateProfile, isProfileReady } = await import("./byoai-profiles");
type CloudAiProfile = Awaited<ReturnType<typeof createCloudProfile>>;

function profile(patch: Partial<CloudAiProfile>): CloudAiProfile {
  return { ...createCloudProfile({}), ...patch };
}

describe("isProfileReady", () => {
  it("an external profile is ready only once it has a saved key", () => {
    expect(isProfileReady(profile({ provider: "openai", hasApiKey: false }))).toBe(false);
    expect(isProfileReady(profile({ provider: "openai", hasApiKey: true }))).toBe(true);
  });

  it("a local profile is ready even without a key", () => {
    expect(isProfileReady(profile({ provider: "ollama", hasApiKey: false }))).toBe(true);
    expect(isProfileReady(profile({ provider: "lmstudio", hasApiKey: false }))).toBe(true);
  });
});

describe("defaultProfile", () => {
  it("prefers the flagged default among ready profiles", () => {
    const notDefault = profile({ id: "a", provider: "ollama", isDefault: false });
    const isDefault = profile({ id: "b", provider: "ollama", isDefault: true });
    expect(defaultProfile([notDefault, isDefault])).toBe(isDefault);
  });

  it("falls back to any ready profile when no default is ready", () => {
    const unreadyDefault = profile({ id: "a", provider: "openai", hasApiKey: false, isDefault: true });
    const readyOther = profile({ id: "b", provider: "ollama", isDefault: false });
    expect(defaultProfile([unreadyDefault, readyOther])).toBe(readyOther);
  });

  it("returns null when nothing is ready", () => {
    const unready = profile({ provider: "openai", hasApiKey: false });
    expect(defaultProfile([unready])).toBeNull();
  });
});

describe("findDuplicateProfile", () => {
  const existing = profile({
    provider: "ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
  });

  it("matches on provider + base URL + model, ignoring case and whitespace", () => {
    const match = findDuplicateProfile([existing], {
      provider: "ollama",
      baseUrl: "  HTTP://localhost:11434/v1  ",
      model: "LLAMA3.1",
    });
    expect(match).toBe(existing);
  });

  it("does not match a different provider, URL, or model", () => {
    expect(
      findDuplicateProfile([existing], { provider: "lmstudio", baseUrl: existing.baseUrl, model: existing.model }),
    ).toBeNull();
    expect(
      findDuplicateProfile([existing], { provider: "ollama", baseUrl: "http://localhost:1234/v1", model: existing.model }),
    ).toBeNull();
    expect(
      findDuplicateProfile([existing], { provider: "ollama", baseUrl: existing.baseUrl, model: "mistral" }),
    ).toBeNull();
  });

  it("this is exactly the guard that stops repeated Add clicks from creating duplicates", () => {
    let profiles = [existing];
    for (let i = 0; i < 10; i++) {
      const candidate = { provider: "ollama" as const, baseUrl: existing.baseUrl, model: existing.model };
      const dupe = findDuplicateProfile(profiles, candidate);
      if (!dupe) {
        profiles = [...profiles, profile(candidate)];
      }
    }
    expect(profiles).toHaveLength(1);
  });
});

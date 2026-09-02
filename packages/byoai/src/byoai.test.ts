import { describe, expect, it } from "vitest";
import { createCloudProfile, displayNameForProvider } from "./cloud-client.js";
import { BILLING_ADDON_AI_ASSISTANT, hasAiEntitlement } from "./entitlements.js";

describe("createCloudProfile", () => {
  it("defaults openai base URL", () => {
    const profile = createCloudProfile({});
    expect(profile.provider).toBe("openai");
    expect(profile.baseUrl).toContain("api.openai.com");
    expect(profile.name).toBe(displayNameForProvider("openai"));
  });
});

describe("hasAiEntitlement", () => {
  it("requires ai_assistant add-on by default", () => {
    expect(hasAiEntitlement(null)).toBe(false);
    expect(
      hasAiEntitlement({
        hasAddon: (code) => code === BILLING_ADDON_AI_ASSISTANT,
      }),
    ).toBe(true);
    expect(
      hasAiEntitlement({
        hasAddon: () => false,
        hasOffering: (code) => code === BILLING_ADDON_AI_ASSISTANT,
      }),
    ).toBe(true);
  });
});

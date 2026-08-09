import { describe, expect, it } from "vitest";
import { BILLING_ADDON_AI_ASSISTANT, billingTokenPayloadFromJson } from "@scomm-office/billing";
import { createCloudProfile, displayNameForProvider } from "./cloud-client.js";
import { hasAiEntitlement } from "./entitlements.js";

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
    const payload = billingTokenPayloadFromJson({
      payload_version: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
      paying_party: {
        id: "pp",
        identity_provider: "google",
        identity_subject: "s",
        billing_email: "a@b.com",
      },
      subscriptions: [
        {
          subscription_id: "1",
          plan_id: "ai_assistant",
          product_id: "ai",
          plan_name: "AI",
          product_name: "AI",
          subscription_status: "active",
          valid_until: Math.floor(Date.now() / 1000) + 86400,
          addon_code: BILLING_ADDON_AI_ASSISTANT,
        },
      ],
    });
    expect(hasAiEntitlement(payload)).toBe(true);
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { BillingApiClient, normalizeBillingApiBaseUrl } from "./api/billing-api-client.js";
import { BillingSdk } from "./billing-sdk.js";
import {
  billingTokenPayloadFromJson,
  payloadHasAddon,
  BILLING_ADDON_AI_ASSISTANT,
} from "./models/billing-token-payload.js";
import { InMemoryBillingSessionStore } from "./session/billing-session-store.js";
import { BillingSession } from "./session/billing-session.js";

describe("normalizeBillingApiBaseUrl", () => {
  it("strips trailing api segments", () => {
    expect(normalizeBillingApiBaseUrl("https://billing.example.com/api/v1/")).toBe(
      "https://billing.example.com",
    );
    expect(normalizeBillingApiBaseUrl("https://billing.example.com/")).toBe(
      "https://billing.example.com",
    );
  });
});

describe("billingTokenPayloadFromJson", () => {
  it("parses entitlements", () => {
    const payload = billingTokenPayloadFromJson({
      payload_version: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
      paying_party: {
        id: "pp-1",
        identity_provider: "google",
        identity_subject: "sub-1",
        billing_email: "owner@example.com",
      },
      subscriptions: [
        {
          subscription_id: "sub-1",
          plan_id: "ai_assistant",
          product_id: "ai",
          plan_name: "AI Assistant",
          product_name: "AI",
          subscription_status: "active",
          valid_until: Math.floor(Date.now() / 1000) + 86400,
          addon_code: "ai_assistant",
        },
      ],
    });
    expect(payloadHasAddon(payload, BILLING_ADDON_AI_ASSISTANT)).toBe(true);
    expect(payloadHasAddon(payload, "linux")).toBe(false);
  });
});

describe("BillingApiClient", () => {
  it("handles 304 license sync", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, { status: 304, headers: { ETag: '"abc"' } });
    const client = new BillingApiClient("https://billing.example.com", fetchImpl);
    const result = await client.fetchLicense({
      authorizationToken: "tok",
      ifNoneMatch: "abc",
    });
    expect(result.kind).toBe("notModified");
  });

  it("parses signedToken on 200", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ data: { signedToken: "a.b.c" } }), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: '"etag1"' },
      });
    const client = new BillingApiClient("https://billing.example.com", fetchImpl);
    const result = await client.fetchLicense({ authorizationToken: "tok" });
    expect(result).toEqual({ kind: "success", signedToken: "a.b.c", etag: "etag1" });
  });
});

describe("BillingSession offline paste", () => {
  beforeEach(() => {
    BillingSdk.resetForTesting();
    BillingSdk.configure({ billingApiBaseUrl: "https://billing.example.com" });
  });

  it("rejects empty token", async () => {
    const session = new BillingSession(new InMemoryBillingSessionStore());
    const result = await session.verifyOfflineToken({ accountKey: "user", token: "  " });
    expect(result.kind).toBe("failure");
  });
});

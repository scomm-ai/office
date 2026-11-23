import { LicenseProcessor, type LicensePayload, type LicenseSubscription } from "@2key/browser-sdk/billing";
import { describe, expect, it } from "vitest";
import { OFFICE_ADDON_CODES, SCOMM_OFFICE_CATALOG } from "./billing-catalog";

const NOW = 1_800_000_000;

function subscription(
  id: string,
  plan: { code: string; isBundle: boolean },
  offerings: Record<string, number>,
  validUntilUnix = NOW + 86_400,
): LicenseSubscription {
  return {
    subscriptionId: id,
    payingPartyId: "7",
    product: { code: "scomm", name: "Scomm.AI" },
    plan: { code: plan.code, name: plan.code, isBundle: plan.isBundle },
    quantity: 1,
    status: "active",
    billingInterval: "annual",
    validFromUnix: NOW - 86_400,
    validUntilUnix,
    offerings,
    resources: {},
  };
}

function license(subscriptions: LicenseSubscription[]): LicensePayload {
  return {
    payloadVersion: 4,
    payingParty: { id: "7", billingEmail: "a@example.com", organizationName: "" },
    usingParty: { identityProvider: "better-auth", identitySubject: "u1" },
    devices: [],
    subscriptions,
  } as LicensePayload;
}

describe("OFFICE_ADDON_CODES", () => {
  it("gates Office SKUs and never lists linux or accent_color", () => {
    expect(OFFICE_ADDON_CODES).toEqual(["pgp", "pqc", "ai_assistant"]);
    expect(OFFICE_ADDON_CODES).not.toContain("linux");
    expect(OFFICE_ADDON_CODES).not.toContain("accent_color");
  });
});

describe("SCOMM_OFFICE_CATALOG", () => {
  it("knows every code the add-in gates", () => {
    for (const code of OFFICE_ADDON_CODES) {
      expect(SCOMM_OFFICE_CATALOG.knowsOffering(code)).toBe(true);
    }
  });

  it("grants an add-on bought directly or through a bundle", () => {
    const gate = new LicenseProcessor(
      license([
        subscription("1", { code: "basic_bundle", isBundle: true }, { desktop: 1, ai_assistant: 1, pqc: 1, accent_color: 1 }),
        subscription("2", { code: "outlook_pgp_ecc", isBundle: false }, { pgp: 1 }),
      ]),
      { catalog: SCOMM_OFFICE_CATALOG, clock: () => NOW },
    );
    expect(gate.holds("ai_assistant")).toBe(true);
    expect(gate.holds("pgp")).toBe(true);
    expect(gate.offeringCount("ai_assistant")).toBe(1);
  });

  it("fails closed for ended subscriptions and codes the catalog does not know", () => {
    const gate = new LicenseProcessor(
      license([
        subscription("1", { code: "ai_assistant", isBundle: false }, { ai_assistant: 1 }, NOW - 1),
        subscription("2", { code: "mystery", isBundle: false }, { scomm_connector: 1 }),
      ]),
      { catalog: SCOMM_OFFICE_CATALOG, clock: () => NOW },
    );
    expect(gate.holds("ai_assistant")).toBe(false);
    expect(gate.holds("scomm_connector")).toBe(false);
  });
});

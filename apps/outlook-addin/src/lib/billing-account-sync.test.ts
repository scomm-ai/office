import { describe, expect, it } from "vitest";
import {
  LicenseProcessor,
  type LicensePayload,
  type LicenseSubscription,
} from "@2key/browser-sdk/billing";
import {
  activeAddonCodes,
  deviceBoundLabel,
  encodePublicJwkForPortal,
  copyTextToClipboard,
  validateDeviceFriendlyName,
  resolveBillingPortalOpenUrl,
} from "./billing-account-sync";
import { SCOMM_OFFICE_CATALOG } from "./billing-catalog";

describe("activeAddonCodes", () => {
  it("lists catalog add-ons that the license grants, without prices", () => {
    expect(
      activeAddonCodes({ holds: (code) => code === "ai_assistant" || code === "pgp" }),
    ).toEqual(["pgp", "ai_assistant"]);
  });

  it("fails closed without a gate", () => {
    expect(activeAddonCodes(null)).toEqual([]);
  });

  it("lists pqc when entitled and never linux", () => {
    expect(
      activeAddonCodes({ holds: (code) => code === "pqc" || code === "linux" }),
    ).toEqual(["pqc"]);
  });
});

describe("office SDK catalog seats", () => {
  const NOW = 1_800_000_000;
  const seat = (offering: string, planCode: string): LicenseSubscription => ({
    subscriptionId: offering,
    payingPartyId: "pp",
    product: { code: "scomm", name: "Scomm" },
    plan: { code: planCode, name: planCode, isBundle: false },
    quantity: 1,
    status: "active",
    billingInterval: "annual",
    validFromUnix: NOW - 86_400,
    validUntilUnix: NOW + 86_400,
    offerings: { [offering]: 1 },
    resources: {},
  });

  it("LicenseProcessor drops codes the catalog does not know and keeps local AI", () => {
    const payload = {
      payloadVersion: 4,
      payingParty: { id: "pp", billingEmail: "a@b.com", organizationName: "" },
      usingParty: { identityProvider: "test-idp", identitySubject: "sub" },
      devices: [],
      subscriptions: [seat("mystery", "mystery"), seat("ai_assistant", "ai_assistant")],
    } as LicensePayload;
    const gate = new LicenseProcessor(payload, {
      catalog: SCOMM_OFFICE_CATALOG,
      clock: () => NOW,
    });
    expect(gate.holds("ai_assistant")).toBe(true);
    expect(gate.holds("mystery")).toBe(false);
    expect(activeAddonCodes(gate)).toEqual(["ai_assistant"]);
  });
});

describe("deviceBoundLabel", () => {
  it("distinguishes local vs registered", () => {
    expect(deviceBoundLabel(true, "abcdefghijklmnop")).toContain("bound");
    expect(deviceBoundLabel(false, "abcdefghijklmnop")).toContain("not registered");
    expect(deviceBoundLabel(false, null)).toBe("—");
  });
});

describe("encodePublicJwkForPortal", () => {
  it("wraps friendlyName + publicJwk for portal paste", () => {
    const json = encodePublicJwkForPortal(
      { kty: "OKP", crv: "Ed25519", x: "aa" },
      "Outlook",
    );
    expect(JSON.parse(json)).toEqual({
      friendlyName: "Outlook",
      publicJwk: { kty: "OKP", crv: "Ed25519", x: "aa" },
    });
  });
});

describe("validateDeviceFriendlyName", () => {
  it("accepts the billing name rules", () => {
    expect(validateDeviceFriendlyName("Outlook")).toBeNull();
    expect(validateDeviceFriendlyName("  laptop-1 ")).toBeNull();
  });

  it("rejects empty, spaces, and oversize names", () => {
    expect(validateDeviceFriendlyName("")).not.toBeNull();
    expect(validateDeviceFriendlyName("bad name")).not.toBeNull();
    expect(validateDeviceFriendlyName("a".repeat(16))).not.toBeNull();
  });
});

describe("copyTextToClipboard", () => {
  it("uses navigator.clipboard when it resolves", async () => {
    const writeText = async (value: string) => {
      expect(value).toBe("hello");
    };
    const previous = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } },
    });
    try {
      await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previous,
      });
    }
  });

  it("falls back to execCommand when clipboard rejects", async () => {
    const previousNav = globalThis.navigator;
    const previousDoc = globalThis.document;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        execCommand: (cmd: string) => cmd === "copy",
        createElement: () => ({
          value: "",
          setAttribute: () => undefined,
          style: {},
          select: () => undefined,
          remove: () => undefined,
        }),
        body: { appendChild: () => undefined },
      },
    });
    try {
      await expect(copyTextToClipboard("payload")).resolves.toBe(true);
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previousNav,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDoc,
      });
    }
  });
});

describe("resolveBillingPortalOpenUrl", () => {
  it("prefers the settings portal URL over the API-derived shop URL", () => {
    expect(
      resolveBillingPortalOpenUrl({
        portalUrl: "http://localhost:5174",
        fallbackShopUrl: "http://localhost:3000/shop",
      }),
    ).toBe("http://localhost:5174");
  });

  it("falls back to the shop URL when the portal URL is empty", () => {
    expect(
      resolveBillingPortalOpenUrl({
        portalUrl: "  ",
        fallbackShopUrl: "http://localhost:3000/shop",
      }),
    ).toBe("http://localhost:3000/shop");
  });
});

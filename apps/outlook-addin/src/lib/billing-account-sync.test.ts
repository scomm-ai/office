import { describe, expect, it } from "vitest";
import { licenseEntitlements, type BillingSubscription } from "@2key/browser-sdk/billing";
import {
  activeAddonCodes,
  deviceBoundLabel,
  encodePublicJwkForPortal,
  copyTextToClipboard,
  validateDeviceFriendlyName,
  resolveBillingPortalOpenUrl,
} from "./billing-account-sync";
import { SCOMM_OFFICE_CATALOG, licenseFeatureCount } from "./billing-catalog";

describe("activeAddonCodes", () => {
  it("lists catalog add-ons that the license grants, without prices", () => {
    expect(
      activeAddonCodes({
        Scomm: {
          ai_assistant: { count: 1 },
          pgp: { count: 1 },
        },
      }),
    ).toEqual(["pgp", "ai_assistant"]);
  });

  it("fails closed without a gate", () => {
    expect(activeAddonCodes(null)).toEqual([]);
  });

  it("lists pqc when entitled and never linux", () => {
    expect(
      activeAddonCodes({
        Scomm: {
          pqc: { count: 1 },
          linux: { count: 1 },
        },
      }),
    ).toEqual(["pqc"]);
  });
});

describe("office SDK catalog seats", () => {
  const seat = (addonCode: string, planName: string): BillingSubscription => ({
    subscriptionId: addonCode,
    planId: addonCode,
    productId: "Scomm",
    planName,
    productName: "Scomm",
    quantity: 1,
    subscriptionStatus: "active",
    validUntilUnix: 4102444800,
    addonCode,
    offerings: [
      {
        offeringId: addonCode,
        offeringCode: addonCode,
        productId: "Scomm",
        productName: "Scomm",
        units: 1,
        resources: { addon_code: addonCode },
      },
    ],
    devices: [],
  });

  it("licenseEntitlements hides linux seats and keeps local AI", () => {
    const e = licenseEntitlements(
      {
        payloadVersion: 3,
        payingParty: {
          id: "pp",
          identityProvider: "google",
          identitySubject: "sub",
          billingEmail: "a@b.com",
        },
        subscriptions: [
          seat("linux", "Linux Version"),
          seat("ai_assistant", "Local AI"),
        ],
      },
      1_700_000_000,
      SCOMM_OFFICE_CATALOG,
    );
    const snap = e.normalizedJson();
    expect(snap.products.Scomm?.linux).toBeUndefined();
    expect(licenseFeatureCount(snap.products, "ai_assistant")).toBeGreaterThanOrEqual(1);
    expect(e.subscriptions.map((s) => s.addonCode)).toEqual(["ai_assistant"]);
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

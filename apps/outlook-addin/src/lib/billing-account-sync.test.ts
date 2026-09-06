import { describe, expect, it } from "vitest";
import { TwoKeyError } from "@2key/browser-sdk/billing";
import {
  activeAddonCodes,
  deviceBoundLabel,
  encodePublicJwkForPortal,
  hasBillingAuth,
  onlineSyncBlockedReason,
  parseDeviceLimitError,
  copyTextToClipboard,
  validateDeviceFriendlyName,
  resolveBillingPortalOpenUrl,
} from "./billing-account-sync";

describe("hasBillingAuth", () => {
  it("is false without tokens", () => {
    expect(hasBillingAuth({})).toBe(false);
    expect(hasBillingAuth({ sessionToken: "  ", accessToken: "" })).toBe(false);
  });

  it("is true with a billing session or API token", () => {
    expect(hasBillingAuth({ sessionToken: "sess" })).toBe(true);
    expect(hasBillingAuth({ accessToken: "api" })).toBe(true);
  });
});

describe("onlineSyncBlockedReason", () => {
  it("blocks online sync when signed out", () => {
    expect(onlineSyncBlockedReason(false)).toMatch(/Sign in to billing/);
    expect(onlineSyncBlockedReason(true)).toBeNull();
  });
});

describe("activeAddonCodes", () => {
  it("lists catalog add-ons that the license grants, without prices", () => {
    expect(
      activeAddonCodes({
        hasAddon: (code) => code === "ai_assistant",
        hasOffering: (code) => code === "pgp",
      }),
    ).toEqual(["ai_assistant", "pgp"]);
  });

  it("fails closed without a gate", () => {
    expect(activeAddonCodes(null)).toEqual([]);
  });
});

describe("parseDeviceLimitError", () => {
  it("reads replaceable devices from a 409 payload", () => {
    const err = new TwoKeyError(
      "conflict",
      "Device limit reached (5).",
      "DEVICE_LIMIT_REACHED",
      {
        maxDevices: 5,
        devices: [{ ski: "abc", friendlyName: "laptop", platform: "web" }],
      },
    );
    expect(parseDeviceLimitError(err)).toEqual({
      message: "Device limit reached (5).",
      maxDevices: 5,
      devices: [{ ski: "abc", friendlyName: "laptop", platform: "web" }],
    });
  });

  it("ignores unrelated errors", () => {
    expect(parseDeviceLimitError(new Error("nope"))).toBeNull();
    expect(parseDeviceLimitError(new TwoKeyError("unauthorized", "no"))).toBeNull();
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

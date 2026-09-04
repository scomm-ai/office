import { describe, expect, it } from "vitest";
import { BILLING_ADDON_PGP } from "./billing-catalog";
import {
  PGP_ADDON_REQUIRED_MESSAGE,
  assertPgpAddon,
  hasPgpEntitlement,
  loadPgpEntitlement,
} from "./billing-pgp";

describe("hasPgpEntitlement", () => {
  it("fails closed without a gate", () => {
    expect(hasPgpEntitlement(null)).toBe(false);
    expect(hasPgpEntitlement(undefined)).toBe(false);
  });

  it("accepts addon or offering pgp", () => {
    expect(
      hasPgpEntitlement({
        hasAddon: (code) => code === BILLING_ADDON_PGP,
      }),
    ).toBe(true);
    expect(
      hasPgpEntitlement({
        hasAddon: () => false,
        hasOffering: (code) => code === BILLING_ADDON_PGP,
      }),
    ).toBe(true);
  });

  it("ignores other add-ons and thrown gates", () => {
    expect(
      hasPgpEntitlement({
        hasAddon: (code) => code === "ai_assistant",
      }),
    ).toBe(false);
    expect(
      hasPgpEntitlement({
        hasAddon: () => {
          throw new Error("no license");
        },
      }),
    ).toBe(false);
  });
});

describe("loadPgpEntitlement", () => {
  it("fails closed when billing origin is empty", async () => {
    expect(await loadPgpEntitlement("")).toBe(false);
    expect(await loadPgpEntitlement("   ")).toBe(false);
  });

  it("fails closed when restore has no license", async () => {
    expect(await loadPgpEntitlement("http://127.0.0.1:9")).toBe(false);
  });
});

describe("assertPgpAddon", () => {
  it("throws the shop message when origin is missing", async () => {
    await expect(assertPgpAddon("")).rejects.toThrow(PGP_ADDON_REQUIRED_MESSAGE);
  });
});

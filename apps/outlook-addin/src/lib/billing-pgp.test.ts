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

  it("accepts pgp count >= 1", () => {
    expect(
      hasPgpEntitlement({
        products: { Scomm: { [BILLING_ADDON_PGP]: { count: 1 } } },
      }),
    ).toBe(true);
  });

  it("ignores other features and empty products", () => {
    expect(
      hasPgpEntitlement({
        products: { Scomm: { ai_assistant: { count: 1 } } },
      }),
    ).toBe(false);
    expect(hasPgpEntitlement({ products: {} })).toBe(false);
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

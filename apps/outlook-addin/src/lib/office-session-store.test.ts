import { describe, expect, it, beforeEach } from "vitest";
import {
  createOfficeSessionStore,
  officeBillingSessionStore,
  resetOfficeBillingSessionStore,
} from "./office-session-store";

describe("createOfficeSessionStore", () => {
  beforeEach(() => {
    resetOfficeBillingSessionStore();
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* node */
    }
  });

  it("round-trips a license JWT through memory even without localStorage", async () => {
    const store = createOfficeSessionStore();
    await store.set("scomm-office:session:default", JSON.stringify({ licenseJwt: "jwt-1" }));
    const raw = await store.get("scomm-office:session:default");
    expect(JSON.parse(raw ?? "{}").licenseJwt).toBe("jwt-1");
  });

  it("shares one store across officeBillingSessionStore callers", async () => {
    const a = officeBillingSessionStore();
    await a.set("k", "v");
    const b = officeBillingSessionStore();
    expect(await b.get("k")).toBe("v");
  });
});

import { describe, expect, it } from "vitest";
import { SCOMM_OFFICE_CATALOG } from "./billing-catalog";
import hosts from "./hosts.json";

describe("SCOMM_OFFICE_CATALOG", () => {
  it("uses the baked office host slice and never lists linux or accent_color", () => {
    expect(SCOMM_OFFICE_CATALOG.productNames).toEqual(["Scomm"]);
    expect([...SCOMM_OFFICE_CATALOG.addonCodes]).toEqual([
      ...hosts.hosts.office.addonCodes,
    ]);
    expect([...SCOMM_OFFICE_CATALOG.offeringCodes]).toEqual([
      ...hosts.hosts.office.offeringCodes,
    ]);
    expect(SCOMM_OFFICE_CATALOG.addonCodes).not.toContain("linux");
    expect(SCOMM_OFFICE_CATALOG.offeringCodes).not.toContain("linux");
    expect(SCOMM_OFFICE_CATALOG.addonCodes).not.toContain("accent_color");
    expect(SCOMM_OFFICE_CATALOG.offeringCodes).not.toContain("scomm_connector_5");
  });
});

import { describe, expect, it } from "vitest";
import { SCOMM_OFFICE_CATALOG } from "./billing-catalog";

describe("SCOMM_OFFICE_CATALOG", () => {
  it("gates Office SKUs and never lists linux or accent_color", () => {
    expect(SCOMM_OFFICE_CATALOG.addonCodes).toEqual([
      "pgp",
      "pqc",
      "ai_assistant",
      "scomm_connector",
    ]);
    expect(SCOMM_OFFICE_CATALOG.offeringCodes).toEqual([
      "pgp",
      "pqc",
      "ai_assistant",
      "scomm_connector",
      "scomm_connector_5",
    ]);
    expect(SCOMM_OFFICE_CATALOG.addonCodes).not.toContain("linux");
    expect(SCOMM_OFFICE_CATALOG.offeringCodes).not.toContain("linux");
    expect(SCOMM_OFFICE_CATALOG.addonCodes).not.toContain("accent_color");
  });
});

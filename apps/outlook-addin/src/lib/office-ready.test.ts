import { describe, expect, it } from "vitest";
import { isOutlookMailboxSession } from "./office-ready";

describe("isOutlookMailboxSession", () => {
  it("is false when office.js loaded in a browser tab", () => {
    expect(
      isOutlookMailboxSession({ host: undefined }, { context: {} }),
    ).toBe(false);
  });

  it("is false when Outlook host has no mailbox (no mail item page)", () => {
    expect(
      isOutlookMailboxSession({ host: "Outlook" }, { HostType: { Outlook: "Outlook" }, context: {} }),
    ).toBe(false);
  });

  it("is true inside Outlook with a mailbox context", () => {
    expect(
      isOutlookMailboxSession(
        { host: "Outlook" },
        { HostType: { Outlook: "Outlook" }, context: { mailbox: { item: {} } } },
      ),
    ).toBe(true);
  });
});

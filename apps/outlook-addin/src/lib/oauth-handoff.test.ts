import { describe, expect, it } from "vitest";
import { isFreshOAuthHandoff } from "./oauth-handoff";

describe("isFreshOAuthHandoff", () => {
  it("accepts a payload written during this sign-in", () => {
    const openedAt = 1_000_000;
    const raw = JSON.stringify({ status: "success", ott: "tok", ts: openedAt + 50 });
    expect(isFreshOAuthHandoff(raw, openedAt, openedAt + 100)).toBe(true);
  });

  it("rejects stale leftover payloads", () => {
    const openedAt = 1_000_000;
    const raw = JSON.stringify({ status: "success", ott: "tok", ts: openedAt - 10_000 });
    expect(isFreshOAuthHandoff(raw, openedAt, openedAt)).toBe(false);
  });

  it("rejects payloads older than two minutes", () => {
    const openedAt = 1_000_000;
    const raw = JSON.stringify({ status: "success", ott: "tok", ts: openedAt });
    expect(isFreshOAuthHandoff(raw, openedAt, openedAt + 180_000)).toBe(false);
  });
});

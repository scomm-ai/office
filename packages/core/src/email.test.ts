import { describe, expect, it } from "vitest";
import { emailsLikelyEqual, normalizeEmailIdentity } from "./email.js";
import { LocalUidProvider } from "./uid.js";
import { UnsupportedFeatureError } from "./errors.js";

describe("normalizeEmailIdentity", () => {
  it("lowercases domain only", () => {
    const n = normalizeEmailIdentity("  Alice@Example.COM ");
    expect(n.localPart).toBe("Alice");
    expect(n.domain).toBe("example.com");
    expect(n.comparisonKey).toBe("Alice@example.com");
    expect(n.looseComparisonKey).toBe("alice@example.com");
    expect(n.original).toBe("Alice@Example.COM");
  });

  it("rejects invalid emails", () => {
    expect(() => normalizeEmailIdentity("not-an-email")).toThrow(/Invalid email/);
  });

  it("compares identities safely", () => {
    expect(emailsLikelyEqual("Bob@Example.com", "Bob@example.com")).toBe(true);
    expect(emailsLikelyEqual("Bob@Example.com", "bob@example.com")).toBe(false);
  });
});

describe("LocalUidProvider", () => {
  it("creates typed uids", async () => {
    const uid = await new LocalUidProvider().create("message");
    expect(uid.startsWith("scomm_message_")).toBe(true);
  });
});

describe("errors", () => {
  it("carries codes", () => {
    const e = new UnsupportedFeatureError("not ready");
    expect(e.code).toBe("unsupported_feature");
  });
});

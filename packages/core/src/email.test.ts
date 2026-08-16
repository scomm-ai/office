import { describe, expect, it } from "vitest";
import { emailsLikelyEqual, isValidEmail, normalizeEmail, normalizeEmailIdentity } from "./email.js";
import { LocalUidProvider } from "./uid.js";
import { UnsupportedFeatureError } from "./errors.js";

describe("normalizeEmail", () => {
  it("matches the pubkey SET/GET contract", () => {
    expect(normalizeEmail("  Alice.Smith+work@Example.COM  ")).toBe(
      "alice.smith@example.com",
    );
    expect(normalizeEmail("éuser@exámple.com")).toBe("éuser@exámple.com");
    expect(normalizeEmail("e\u0301user@exa\u0301mple.com")).toBe("éuser@exámple.com");
  });
});

describe("isValidEmail", () => {
  it("accepts typical mailboxes and rejects junk", () => {
    expect(isValidEmail("alice@example.com")).toBe(true);
    expect(isValidEmail("éuser@exámple.com")).toBe(true);
    expect(isValidEmail("alice@localhost")).toBe(false);
    expect(isValidEmail("ali..ce@example.com")).toBe(false);
    expect(isValidEmail("alice@127.0.0.1")).toBe(false);
  });
});

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

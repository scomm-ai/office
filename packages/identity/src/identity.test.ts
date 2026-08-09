import { describe, expect, it } from "vitest";
import {
  createEmailIdentity,
  createScommUidIdentity,
  identitiesEqual,
  identityComparisonKey,
  identityToProtocolIdentity,
  parseIdentity,
} from "./identity.js";

describe("ScommIdentity", () => {
  it("wraps normalizeEmailIdentity for email identities", () => {
    const id = createEmailIdentity("  Alice@Example.COM ");
    expect(id.type).toBe("email");
    expect(id.value).toBe("Alice@Example.COM");
    expect(id.normalized.domain).toBe("example.com");
    expect(id.normalized.comparisonKey).toBe("Alice@example.com");
  });

  it("creates scomm-uid identities", () => {
    const id = createScommUidIdentity("scomm_message_abc123");
    expect(id.type).toBe("scomm-uid");
    expect(identityComparisonKey(id)).toBe("scomm-uid:scomm_message_abc123");
  });

  it("compares email identities using normalized keys", () => {
    const a = createEmailIdentity("Bob@Example.com");
    const b = createEmailIdentity("Bob@example.com");
    expect(identitiesEqual(a, b)).toBe(true);
  });

  it("parses protocol identity types", () => {
    const id = parseIdentity("email", "carol@example.org");
    expect(id.type).toBe("email");
    expect(identityToProtocolIdentity(id)).toEqual({
      type: "email",
      value: "carol@example.org",
    });
  });
});

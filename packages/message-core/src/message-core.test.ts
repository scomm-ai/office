import { describe, expect, it } from "vitest";
import { canonicalizeAuthoredText, normalizeRecipients } from "./canonicalize.js";
import { captureComposeSnapshot, toLogicalMessage } from "./adapter.js";

describe("canonicalizeAuthoredText", () => {
  it("normalizes line endings and trailing whitespace", () => {
    expect(canonicalizeAuthoredText("Hello  \r\nWorld")).toBe("Hello\nWorld\n");
  });

  it("applies NFC normalization", () => {
    const composed = "e\u0301";
    const precomposed = "\u00e9";
    expect(canonicalizeAuthoredText(composed)).toBe(canonicalizeAuthoredText(precomposed));
  });
});

describe("normalizeRecipients", () => {
  it("sorts recipients deterministically", () => {
    const sorted = normalizeRecipients([
      { emailAddress: "bob@example.com" },
      { emailAddress: "Alice@Example.COM" },
    ]);
    expect(sorted.map((a) => a.emailAddress)).toEqual(["alice@example.com", "bob@example.com"]);
  });
});

describe("toLogicalMessage", () => {
  it("prefers plain text over HTML", () => {
    const msg = toLogicalMessage({
      bodyText: "Plain body",
      bodyHtml: "<p>HTML body</p>",
    });
    expect(msg.authoredText).toBe("Plain body\n");
  });

  it("captures compose snapshot with nonce", () => {
    const snap = captureComposeSnapshot({ bodyText: "Hi" });
    expect(snap.nonce).toBeTruthy();
    expect(snap.capturedAt).toBeTruthy();
  });
});

import { describe, expect, it } from "vitest";
import {
  buildSemanticManifest,
  compareHtmlToSignedText,
  hashAuthoredText,
  verifySemanticManifest,
} from "./semantic.js";

describe("semantic manifest", () => {
  it("hashes authored text deterministically", async () => {
    const h1 = await hashAuthoredText("Hello\n");
    const h2 = await hashAuthoredText("Hello\n");
    expect(h1).toBe(h2);
  });

  it("builds manifest without Bcc", async () => {
    const manifest = await buildSemanticManifest({
      message: {
        authoredText: "Transfer $1,000.\n",
        to: [{ emailAddress: "bob@example.com" }],
        bcc: [{ emailAddress: "secret@example.com" }],
        subject: "Payment",
      },
      senderEmail: "alice@example.com",
      signingKeyId: "a82c-991e",
      nonce: "test-nonce",
    });
    expect(manifest.to).toEqual(["bob@example.com"]);
    expect(manifest.cc).toEqual([]);
    expect(JSON.stringify(manifest)).not.toContain("secret@example.com");
  });

  it("detects HTML differing from signed text", () => {
    const result = compareHtmlToSignedText(
      "Transfer $1,000.\n",
      "<p>Transfer $10,000.</p>",
      (html) => html.replace(/<[^>]+>/g, ""),
    );
    expect(result).toBe("differs");
  });

  it("verifies matching manifest", async () => {
    const message = {
      authoredText: "Hello\n",
      subject: "Hi",
      from: { emailAddress: "alice@example.com" },
      to: [{ emailAddress: "bob@example.com" }],
    };
    const manifest = await buildSemanticManifest({
      message,
      senderEmail: "alice@example.com",
      signingKeyId: "abcd-1234",
      nonce: "n1",
    });
    const result = await verifySemanticManifest({
      manifest,
      message,
      signatureValid: true,
    });
    expect(result.state).toBe("verified");
    expect(result.htmlCorrespondence).toBe("unknown");
  });
});

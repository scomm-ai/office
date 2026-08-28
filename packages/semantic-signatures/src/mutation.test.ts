import { describe, expect, it } from "vitest";
import { canonicalizeAuthoredText } from "@scomm-office/message-core";
import { buildSemanticManifest, verifySemanticManifest } from "./semantic.js";

describe("MIME mutation survival (semantic)", () => {
  it("survives equivalent line-ending normalization", async () => {
    const message = {
      authoredText: "Hello\n",
      subject: "Test",
      from: { emailAddress: "alice@example.com" },
    };
    const manifest = await buildSemanticManifest({
      message,
      senderEmail: "alice@example.com",
      signingKeyId: "abcd-1234",
      nonce: "n1",
    });
    const mutated = {
      authoredText: canonicalizeAuthoredText("Hello\r\n"),
      subject: "Test",
      from: { emailAddress: "alice@example.com" },
    };
    const result = await verifySemanticManifest({
      manifest,
      message: mutated,
      signatureValid: true,
    });
    expect(result.state).toBe("verified");
  });

  it("detects subject change", async () => {
    const message = { authoredText: "Hello\n", subject: "Original" };
    const manifest = await buildSemanticManifest({
      message,
      senderEmail: "alice@example.com",
      signingKeyId: "abcd-1234",
      nonce: "n1",
    });
    const result = await verifySemanticManifest({
      manifest,
      message: { authoredText: "Hello\n", subject: "Tampered" },
      signatureValid: true,
    });
    expect(result.state).toBe("manifest-mismatch");
  });
});

describe("HTML mismatch", () => {
  it("reports valid semantic signature with differing HTML", async () => {
    const message = {
      authoredText: "Transfer $1,000.\n",
      html: "<p>Transfer $10,000.</p>",
      subject: "Pay",
      from: { emailAddress: "alice@example.com" },
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
      html: message.html,
    });
    expect(result.state).toBe("verified");
    expect(result.htmlCorrespondence).toBe("differs");
  });
});

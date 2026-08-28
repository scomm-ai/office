import { describe, expect, it } from "vitest";
import { MailSecurityService } from "./service.js";

describe("MailSecurityService", () => {
  it("classifies plain text MIME as none", () => {
    const service = new MailSecurityService();
    const mime = new TextEncoder().encode(
      "From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Hi\r\n\r\nHello",
    );

    expect(service.inspectMime(mime)).toEqual({
      protectionKind: "unsigned",
      mimeStructure: "unsigned",
    });
  });
});

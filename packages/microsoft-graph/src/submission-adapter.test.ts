import { describe, expect, it } from "vitest";
import { MicrosoftGraphError } from "@scomm-office/core";
import { CryptoFamily, type ProtectedMessage } from "@scomm-office/crypto";
import { MockMicrosoftGraph } from "./mock-graph.js";
import { GraphSubmissionAdapter } from "./submission-adapter.js";

function makeProtectedMessage(bodyText: string): ProtectedMessage {
  const eml = new TextEncoder().encode(
    `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="b"\r\n` +
      `MIME-Version: 1.0\r\n\r\n${bodyText}`,
  );
  return { family: CryptoFamily.OpenPGP, mode: "encrypt", mime: eml, eml };
}

describe("GraphSubmissionAdapter", () => {
  it("prepends the RFC 822 envelope and sends the exact protected MIME bytes", async () => {
    const graph = new MockMicrosoftGraph();
    const adapter = new GraphSubmissionAdapter(graph);
    const protectedMessage = makeProtectedMessage("-----BEGIN PGP MESSAGE-----\r\nabc\r\n-----END PGP MESSAGE-----");

    await adapter.submit(protectedMessage, {
      From: "alice@example.com",
      To: "bob@example.com",
      Subject: "Hello",
    });

    const [sent] = graph.getSentMimeMessages();
    const text = new TextDecoder("latin1").decode(sent);

    expect(text).toContain("From: alice@example.com\r\n");
    expect(text).toContain("To: bob@example.com\r\n");
    expect(text).toContain("Subject: Hello\r\n");
    expect(text).toContain('Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"');
    expect(text).toContain("-----BEGIN PGP MESSAGE-----\r\nabc\r\n-----END PGP MESSAGE-----");
    // Envelope headers come first, immediately followed by the SDK's content headers.
    expect(text.indexOf("From:")).toBeLessThan(text.indexOf("Content-Type:"));
  });

  it("fills in Date and Message-ID when missing", async () => {
    const graph = new MockMicrosoftGraph();
    const adapter = new GraphSubmissionAdapter(graph);

    await adapter.submit(makeProtectedMessage("body"), {
      From: "alice@example.com",
      To: "bob@example.com",
      Subject: "Hi",
    });

    const text = new TextDecoder("latin1").decode(graph.getSentMimeMessages()[0]!);
    expect(text).toMatch(/Date: .+\r\n/);
    expect(text).toMatch(/Message-ID: <.+>\r\n/);
  });

  it("does not overwrite caller-supplied Date or Message-ID", async () => {
    const graph = new MockMicrosoftGraph();
    const adapter = new GraphSubmissionAdapter(graph);

    await adapter.submit(makeProtectedMessage("body"), {
      From: "alice@example.com",
      To: "bob@example.com",
      Subject: "Hi",
      Date: "Wed, 01 Jan 2026 00:00:00 +0000",
      "Message-ID": "<fixed@scomm.ai>",
    });

    const text = new TextDecoder("latin1").decode(graph.getSentMimeMessages()[0]!);
    expect(text).toContain("Date: Wed, 01 Jan 2026 00:00:00 +0000\r\n");
    expect(text).toContain("Message-ID: <fixed@scomm.ai>\r\n");
  });

  it("rejects when required envelope headers are missing", async () => {
    const graph = new MockMicrosoftGraph();
    const adapter = new GraphSubmissionAdapter(graph);

    await expect(
      adapter.submit(makeProtectedMessage("body"), { From: "alice@example.com" }),
    ).rejects.toThrow(MicrosoftGraphError);
    expect(graph.getSentMimeMessages()).toHaveLength(0);
  });

  it("falls back to mime bytes when eml is absent", async () => {
    const graph = new MockMicrosoftGraph();
    const adapter = new GraphSubmissionAdapter(graph);
    const mime = new TextEncoder().encode("Content-Type: text/plain\r\n\r\nplain body");

    await adapter.submit(
      { family: CryptoFamily.OpenPGP, mode: "sign", mime },
      { From: "a@example.com", To: "b@example.com", Subject: "s" },
    );

    const text = new TextDecoder("latin1").decode(graph.getSentMimeMessages()[0]!);
    expect(text).toContain("plain body");
  });
});

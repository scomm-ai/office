import { describe, expect, it } from "vitest";
import { extractPgpMessage, extractPgpSignedMessage } from "@scomm-office/pubkeys";
import {
  armoredPayloadFromEml,
  pgpArmorAsComposeHtml,
  writeArmoredComposeBody,
} from "./pgp-armor-body";
import { MockMailHost } from "@scomm-office/office";

const MESSAGE = `-----BEGIN PGP MESSAGE-----

owGbwMvMwMEYqPTj7/nGQymMpaWJOamWBgaGBqy6CYlFmak5xYl5JYl5OYlAOUMj
=abcd
-----END PGP MESSAGE-----`;

describe("pgp armor compose body", () => {
  it("strips MIME headers and keeps only the armor block", () => {
    const eml = `Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${MESSAGE}\r\n`;
    expect(armoredPayloadFromEml(eml)).toContain("BEGIN PGP MESSAGE");
    expect(armoredPayloadFromEml(eml)).not.toContain("Content-Type");
  });

  it("round-trips HTML pre wrapper through extractPgpMessage", () => {
    const html = pgpArmorAsComposeHtml(MESSAGE);
    expect(html).toContain("<pre");
    expect(extractPgpMessage(html)).toContain("BEGIN PGP MESSAGE");
    expect(extractPgpSignedMessage(html)).toBeNull();
  });

  it("writes both html and plain armor onto the mail host", async () => {
    const host = new MockMailHost({ mode: "compose", bodyText: "hello" });
    await writeArmoredComposeBody(host, MESSAGE);
    const current = await host.getCurrentMessage();
    expect(current.bodyHtml).toContain("<pre");
    expect(extractPgpMessage(current.bodyHtml)).toContain("BEGIN PGP MESSAGE");
    expect(current.bodyText).toContain("BEGIN PGP MESSAGE");
  });
});

import { describe, expect, it } from "vitest";
import {
  bodyHasOpenPgpProtection,
  decodePublicMaterial,
  extractPgpMessage,
  extractPgpSignedMessage,
  htmlToPlainText,
  messagePlaintext,
} from "./pgp-mail.js";

describe("pgp-mail", () => {
  it("extracts an armored message from HTML compose bodies", () => {
    const armored = `-----BEGIN PGP MESSAGE-----\n\nwv8AAQ\n-----END PGP MESSAGE-----`;
    const html = `<div><pre>${armored.replaceAll("\n", "<br>")}</pre></div>`;
    expect(extractPgpMessage(html)).toContain("BEGIN PGP MESSAGE");
    expect(extractPgpMessage(html)).toContain("END PGP MESSAGE");
  });

  it("reassembles Outlook HTML that splits armor across spans and CR LF", () => {
    const html =
      `<html><body><div>-----BEGIN PGP MESS<span>AGE-----</span><br>\r\n` +
      `wv8AAQ<br>\r\n-----END PGP MESSAGE-----</div></body></html>`;
    const extracted = extractPgpMessage(html);
    expect(extracted).toContain("-----BEGIN PGP MESSAGE-----");
    expect(extracted).toContain("-----END PGP MESSAGE-----");
    expect(extracted).not.toContain("<span>");
  });

  it("prefers bodyText and strips HTML tags", () => {
    expect(htmlToPlainText("<p>hi<br>there</p>")).toContain("hi");
    expect(messagePlaintext({ bodyHtml: "<p>secret</p>" })).toContain("secret");
    expect(messagePlaintext({ bodyText: "plain", bodyHtml: "<p>html</p>" })).toBe("plain");
  });

  it("extracts a clearsigned OpenPGP message", () => {
    const signed =
      "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nhi\n-----BEGIN PGP SIGNATURE-----\n\nabc\n-----END PGP SIGNATURE-----";
    expect(extractPgpSignedMessage(signed)).toContain("BEGIN PGP SIGNED MESSAGE");
    expect(bodyHasOpenPgpProtection(signed)).toBe(true);
  });

  it("decodes base64url public material", () => {
    const bytes = decodePublicMaterial("dGVzdA");
    expect(new TextDecoder().decode(bytes)).toBe("test");
  });
});

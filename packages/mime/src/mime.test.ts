import { describe, expect, it } from "vitest";
import {
  buildMultipartEncrypted,
  buildMultipartSigned,
  detectMimeStructure,
  encodeQuotedPrintable,
  mimeToEml,
} from "./mime.js";
import { logicalMessageToMime } from "./logical-message.js";

describe("logicalMessageToMime", () => {
  it("builds multipart/alternative for plain+html", () => {
    const mime = logicalMessageToMime({
      authoredText: "Hello",
      html: "<p>Hello</p>",
    });
    const eml = new TextDecoder().decode(mimeToEml(mime));
    expect(eml).toContain("multipart/alternative");
    expect(eml).toContain("text/plain");
    expect(eml).toContain("text/html");
  });

  it("includes attachments in multipart/mixed", () => {
    const mime = logicalMessageToMime({
      authoredText: "See attached",
      attachments: [
        {
          filename: "report.pdf",
          mediaType: "application/pdf",
          size: 4,
          data: new Uint8Array([1, 2, 3, 4]),
        },
      ],
    });
    const eml = new TextDecoder().decode(mimeToEml(mime));
    expect(eml).toContain("multipart/mixed");
    expect(eml).toContain("report.pdf");
  });
});

describe("RFC 3156 structures", () => {
  it("builds multipart/signed with pgp-signature protocol", () => {
    const entity = new TextEncoder().encode(
      'Content-Type: text/plain\r\n\r\nHello\r\n',
    );
    const signed = buildMultipartSigned(entity, "-----BEGIN PGP SIGNATURE-----\nabc\n-----END PGP SIGNATURE-----");
    const eml = new TextDecoder().decode(mimeToEml(signed));
    expect(eml).toContain('protocol="application/pgp-signature"');
    expect(eml).toContain("application/pgp-signature");
    expect(detectMimeStructure(eml).kind).toBe("openpgp-signed");
  });

  it("builds multipart/encrypted with pgp-encrypted protocol", () => {
    const enc = buildMultipartEncrypted(new Uint8Array([0x99, 0x01, 0x02]));
    const eml = new TextDecoder().decode(mimeToEml(enc));
    expect(eml).toContain('protocol="application/pgp-encrypted"');
    expect(eml).toContain("application/pgp-encrypted");
    expect(eml).toContain("Version: 1");
    expect(detectMimeStructure(eml).kind).toBe("openpgp-encrypted");
  });
});

describe("encodeQuotedPrintable", () => {
  it("encodes non-ASCII bytes", () => {
    expect(encodeQuotedPrintable("café")).toContain("=C3");
  });
});

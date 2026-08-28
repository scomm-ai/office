import { describe, expect, it } from "vitest";
import { CryptoFamily } from "@scomm-office/crypto";
import { detectMimeStructure, mimeToEml } from "@scomm-office/mime";
import {
  OpenPgpCryptoProvider,
  generateOpenPgpKeyPair,
  publicKeyMaterialFromBytes,
} from "./openpgp-provider.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

describe("OpenPgpCryptoProvider RFC 3156", () => {
  it("signs with multipart/signed and verifies independently", async () => {
    const alice = await generateOpenPgpKeyPair("alice@example.com");
    const bob = await generateOpenPgpKeyPair("bob@example.com");
    const provider = new OpenPgpCryptoProvider();

    const message = {
      authoredText: "Hello, standards world!\n",
      html: "<p>Hello, standards world!</p>",
      subject: "Test",
      from: { emailAddress: "alice@example.com" },
      to: [{ emailAddress: "bob@example.com" }],
    };

    const protectedMsg = await provider.sign({
      message,
      recipientKeys: [],
      senderSigningKey: alice.handle,
    });

    const emlText = new TextDecoder("latin1").decode(protectedMsg.mime);
    expect(emlText).toContain('protocol="application/pgp-signature"');
    expect(emlText).toContain("application/pgp-signature");
    expect(detectMimeStructure(protectedMsg.mime).kind).toBe("openpgp-signed");

    const pub = publicKeyMaterialFromBytes(
      "alice@example.com",
      alice.publicKey,
      alice.fingerprint,
      { canSign: true, canEncrypt: true },
    );
    const verification = await provider.verify(protectedMsg.mime, [pub]);
    expect(verification.state).toBe("verified");
    expect(verification.family).toBe(CryptoFamily.OpenPGP);
  });

  it("encrypts with multipart/encrypted RFC 3156 structure", async () => {
    const alice = await generateOpenPgpKeyPair("alice@example.com");
    const bob = await generateOpenPgpKeyPair("bob@example.com");
    const provider = new OpenPgpCryptoProvider();

    const message = {
      authoredText: "Secret content\n",
      to: [{ emailAddress: "bob@example.com" }],
    };

    const bobPub = publicKeyMaterialFromBytes(
      "bob@example.com",
      bob.publicKey,
      bob.fingerprint,
      { canSign: true, canEncrypt: true },
    );

    const protectedMsg = await provider.encrypt({
      message,
      recipientKeys: [bobPub],
    });

    const emlText = new TextDecoder("latin1").decode(protectedMsg.mime);
    expect(emlText).toContain('protocol="application/pgp-encrypted"');
    expect(emlText).toContain("Version: 1");
    expect(detectMimeStructure(protectedMsg.mime).kind).toBe("openpgp-encrypted");

    const { plaintext } = await provider.decrypt(protectedMsg.mime, bob.handle);
    expect(new TextDecoder().decode(plaintext)).toContain("text/plain");
  });

  it("sign+encrypt then decrypt+verify", async () => {
    const alice = await generateOpenPgpKeyPair("alice@example.com");
    const bob = await generateOpenPgpKeyPair("bob@example.com");
    const provider = new OpenPgpCryptoProvider();

    const message = {
      authoredText: "Signed and encrypted\n",
      from: { emailAddress: "alice@example.com" },
      to: [{ emailAddress: "bob@example.com" }],
    };

    const bobPub = publicKeyMaterialFromBytes(
      "bob@example.com",
      bob.publicKey,
      bob.fingerprint,
      { canSign: true, canEncrypt: true },
    );
    const alicePub = publicKeyMaterialFromBytes(
      "alice@example.com",
      alice.publicKey,
      alice.fingerprint,
      { canSign: true, canEncrypt: true },
    );

    const protectedMsg = await provider.signAndEncrypt({
      message,
      recipientKeys: [bobPub],
      senderSigningKey: alice.handle,
    });

    const { plaintext } = await provider.decrypt(protectedMsg.mime, bob.handle);
    const verification = await provider.verify(plaintext, [alicePub]);
    expect(verification.state).toBe("verified");
  });

  it("writes fixture eml for interoperability", async () => {
    const alice = await generateOpenPgpKeyPair("alice@example.com");
    const provider = new OpenPgpCryptoProvider();
    const message = {
      authoredText: "Fixture message for external verification.\n",
      html: "<p>Fixture message for external verification.</p>",
      subject: "OpenPGP fixture",
      attachments: [
        {
          filename: "note.txt",
          mediaType: "text/plain",
          size: 5,
          data: new TextEncoder().encode("hello"),
        },
      ],
    };
    const protectedMsg = await provider.sign({
      message,
      recipientKeys: [],
      senderSigningKey: alice.handle,
    });
    const fixturesDir = join(import.meta.dirname, "..", "fixtures");
    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(join(fixturesDir, "openpgp-signed.eml"), Buffer.from(protectedMsg.mime));
    expect(protectedMsg.mime.length).toBeGreaterThan(100);
  });
});

import { describe, expect, it } from "vitest";
import { CryptoFamily } from "@scomm-office/crypto";
import {
  OpenPgpCryptoProvider,
  generateOpenPgpKeyPair,
  publicKeyMaterialFromBytes,
} from "./openpgp-provider.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

describe("OpenPgpCryptoProvider inline (GpgOL-style)", () => {
  it("signs as a single text/plain part with a cleartext signature", async () => {
    const alice = await generateOpenPgpKeyPair("alice@example.com");
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
    expect(emlText).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(emlText).not.toContain("multipart/signed");
    expect(emlText).not.toContain("attachment");
    expect(emlText).toContain("BEGIN PGP SIGNED MESSAGE");

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

  it("encrypts as a single text/plain part with no multipart wrapper", async () => {
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
    expect(emlText).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(emlText).not.toContain("multipart/encrypted");
    expect(emlText).not.toContain("application/octet-stream");
    expect(emlText).toContain("BEGIN PGP MESSAGE");

    const { plaintext } = await provider.decrypt(protectedMsg.mime, bob.handle);
    expect(new TextDecoder().decode(plaintext)).toContain("Secret content");
  });

  it("sign+encrypt then decrypt+verify in one inline armored block", async () => {
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

    const emlText = new TextDecoder("latin1").decode(protectedMsg.mime);
    expect(emlText).not.toContain("multipart/");

    const { message: decrypted, verification } = await provider.decryptAndVerify(
      protectedMsg.mime,
      bob.handle,
      [alicePub],
    );
    expect(decrypted.authoredText).toContain("Signed and encrypted");
    expect(verification.state).toBe("verified");
  });

  it("writes fixture eml for interoperability", async () => {
    const alice = await generateOpenPgpKeyPair("alice@example.com");
    const provider = new OpenPgpCryptoProvider();
    const message = {
      authoredText: "Fixture message for external verification.\n",
      html: "<p>Fixture message for external verification.</p>",
      subject: "OpenPGP fixture",
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

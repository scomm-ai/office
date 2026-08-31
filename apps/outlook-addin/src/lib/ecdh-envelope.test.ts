import { describe, expect, it } from "vitest";
import { extractScommEnvelopeCiphertext, isEcdhP256Algorithm } from "./ecdh-envelope";

describe("isEcdhP256Algorithm", () => {
  it("accepts ECDH P-256 suite names", () => {
    expect(isEcdhP256Algorithm("ECDH-P256")).toBe(true);
    expect(isEcdhP256Algorithm("smime-ecdh-p256")).toBe(true);
  });

  it("rejects OpenPGP algorithms", () => {
    expect(isEcdhP256Algorithm("openpgp-cv25519")).toBe(false);
  });
});

describe("extractScommEnvelopeCiphertext", () => {
  const envelope = '{"algorithmSuite":"scomm-v1-ecdh-p256-aes256gcm","ciphertext":"abc"}';

  it("reads the HTML pre wrapper", () => {
    expect(
      extractScommEnvelopeCiphertext(`<pre data-scomm-encrypted="true">${envelope}</pre>`, ""),
    ).toBe(envelope);
  });

  it("reads a trailing JSON body", () => {
    expect(extractScommEnvelopeCiphertext("", `hello\n${envelope}`)).toBe(envelope);
  });

  it("returns null when no envelope is present", () => {
    expect(extractScommEnvelopeCiphertext("<p>plain</p>", "plain")).toBeNull();
  });
});

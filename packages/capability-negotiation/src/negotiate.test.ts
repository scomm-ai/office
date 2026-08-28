import { describe, expect, it } from "vitest";
import { CryptoFamily } from "@scomm-office/crypto";
import { negotiateCryptoFamily } from "./negotiate.js";

describe("negotiateCryptoFamily", () => {
  it("selects OpenPGP when common among recipients", () => {
    const result = negotiateCryptoFamily(
      [CryptoFamily.OpenPGP, CryptoFamily.SMIME],
      [
        { identity: "bob@example.com", families: [CryptoFamily.OpenPGP], canSign: true, canEncrypt: true },
        { identity: "carol@example.com", families: [CryptoFamily.OpenPGP, CryptoFamily.SMIME], canSign: true, canEncrypt: true },
      ],
    );
    expect(result.selectedFamily).toBe(CryptoFamily.OpenPGP);
    expect(result.blocked).toBe(false);
  });

  it("blocks when encryption required but recipient lacks key", () => {
    const result = negotiateCryptoFamily(
      [CryptoFamily.OpenPGP],
      [{ identity: "carol@example.com", families: [CryptoFamily.OpenPGP], canSign: true, canEncrypt: false }],
      { requireEncryption: true, neverDowngradeEncryption: true },
    );
    expect(result.blocked).toBe(true);
    expect(result.missingEncryption).toContain("carol@example.com");
  });
});

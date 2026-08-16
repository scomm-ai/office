import { describe, expect, it } from "vitest";
import { UnsupportedFeatureError } from "@scomm-office/core";
import { ExperimentalMessageDecryptor, ExperimentalMessageEncryptor } from "./experimental.js";

describe("ExperimentalMessageEncryptor", () => {
  it("throws UnsupportedFeatureError — proprietary envelopes are not used", async () => {
    const encryptor = new ExperimentalMessageEncryptor();
    await expect(
      encryptor.encrypt({ body: "secret" }, [
        { identity: "a@b.com", keyId: "k1", publicKey: "pk", algorithm: "X25519" },
      ]),
    ).rejects.toThrow(UnsupportedFeatureError);
    await expect(
      encryptor.encrypt({ body: "secret" }, [
        { identity: "a@b.com", keyId: "k1", publicKey: "pk", algorithm: "X25519" },
      ]),
    ).rejects.toThrow("OpenPGP");
  });
});

describe("ExperimentalMessageDecryptor", () => {
  it("throws UnsupportedFeatureError — proprietary envelopes are not used", async () => {
    const decryptor = new ExperimentalMessageDecryptor();
    await expect(
      decryptor.decrypt({ envelopeVersion: 0, ciphertext: "x", recipients: [] }),
    ).rejects.toThrow(UnsupportedFeatureError);
  });
});

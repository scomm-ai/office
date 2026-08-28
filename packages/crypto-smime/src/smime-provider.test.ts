import { describe, expect, it } from "vitest";
import { createSmimeProvider } from "./smime-provider.js";
import { CryptoFamily } from "@scomm-office/crypto";

describe("SmimeCryptoProvider", () => {
  it("is fail-closed in JS hosts", async () => {
    const provider = createSmimeProvider();
    expect(provider.family).toBe(CryptoFamily.SMIME);
    await expect(provider.sign({} as never)).rejects.toThrow();
  });
});

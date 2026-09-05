import { describe, expect, it } from "vitest";
import {
  PRODUCTION_PUBKEY_READ_URL,
  PRODUCTION_PUBKEY_WRITE_URL,
  formatAddresses,
  resolvePubkeyReadBaseUrl,
  resolvePubkeyWriteBaseUrl,
} from "./settings";

describe("formatAddresses", () => {
  it("returns em dash when empty", () => {
    expect(formatAddresses(undefined)).toBe("—");
  });

  it("formats display names", () => {
    expect(formatAddresses([{ emailAddress: "a@b.com", displayName: "A" }])).toBe("A <a@b.com>");
  });
});

describe("pubkey base URLs", () => {
  it("ignores Settings and uses env or production fallback", () => {
    expect(resolvePubkeyReadBaseUrl({ pubkeyReadBaseUrl: "http://evil.example" } as never)).toMatch(
      /localhost:3000|pubkey\.scomm\.ai/,
    );
    expect(resolvePubkeyWriteBaseUrl({ pubkeyWriteBaseUrl: "http://evil.example" } as never)).toBeTruthy();
    expect(PRODUCTION_PUBKEY_READ_URL).toBe("https://pubkey.scomm.ai");
    expect(PRODUCTION_PUBKEY_WRITE_URL).toBe("https://api.pubkey.scomm.ai");
  });
});

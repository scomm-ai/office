import { describe, expect, it } from "vitest";
import { formatAddresses } from "./settings";

describe("formatAddresses", () => {
  it("returns em dash when empty", () => {
    expect(formatAddresses(undefined)).toBe("—");
  });

  it("formats display names", () => {
    expect(formatAddresses([{ emailAddress: "a@b.com", displayName: "A" }])).toBe("A <a@b.com>");
  });
});

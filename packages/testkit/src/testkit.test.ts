import { describe, expect, it } from "vitest";
import { formatMailAddress, getSampleMailAddress, loadFixture, listFixtures } from "./index.js";

describe("loadFixture", () => {
  it("loads all HTML fixtures", async () => {
    for (const name of listFixtures()) {
      const html = await loadFixture(name);
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain("<");
    }
  });

  it("loads simple fixture content", async () => {
    const html = await loadFixture("simple");
    expect(html).toContain("project update");
  });
});

describe("sampleMailAddresses", () => {
  it("formats named addresses", () => {
    const alice = getSampleMailAddress("alice");
    expect(formatMailAddress(alice)).toBe("Alice Example <alice@example.com>");
  });

  it("formats bare addresses", () => {
    const carol = getSampleMailAddress("carol");
    expect(formatMailAddress(carol)).toBe("carol@example.org");
  });
});

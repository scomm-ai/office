import { loadFixture } from "@scomm-office/testkit";
import { describe, expect, it } from "vitest";
import { canonicalizeSemanticDocument, sha256SemanticDocument } from "./canonicalize.js";
import { HeuristicSemanticExtractor, hasSegmentType } from "./heuristic-extractor.js";
import type { SemanticMailDocument } from "./models.js";

const extractor = new HeuristicSemanticExtractor();

async function extractFixture(name: Parameters<typeof loadFixture>[0]) {
  const html = await loadFixture(name);
  return extractor.extract({ document: { html } });
}

describe("HeuristicSemanticExtractor", () => {
  it("classifies simple fixture as authored", async () => {
    const result = await extractFixture("simple");
    expect(hasSegmentType(result.document.segments, "authored")).toBe(true);
  });

  it("detects quoted content in reply-with-quote fixture", async () => {
    const result = await extractFixture("reply-with-quote");
    expect(hasSegmentType(result.document.segments, "quoted")).toBe(true);
  });

  it("detects signature in signature fixture", async () => {
    const result = await extractFixture("signature");
    expect(hasSegmentType(result.document.segments, "signature")).toBe(true);
  });

  it("detects legalese in legal-disclaimer fixture", async () => {
    const result = await extractFixture("legal-disclaimer");
    expect(hasSegmentType(result.document.segments, "legalese")).toBe(true);
  });

  it("detects forwarded content in forward fixture", async () => {
    const result = await extractFixture("forward");
    expect(hasSegmentType(result.document.segments, "forwarded")).toBe(true);
  });
});

describe("canonicalizeSemanticDocument", () => {
  it("produces stable JSON regardless of key order", () => {
    const docA: SemanticMailDocument = {
      version: "1.0",
      segments: [],
      entities: [],
      actions: [],
      metadata: { z: 1, a: 2 },
    };
    const docB: SemanticMailDocument = {
      version: "1.0",
      metadata: { a: 2, z: 1 },
      actions: [],
      entities: [],
      segments: [],
    };

    expect(canonicalizeSemanticDocument(docA)).toBe(canonicalizeSemanticDocument(docB));
  });
});

describe("sha256SemanticDocument", () => {
  it("returns deterministic digest for the same document", async () => {
    const doc: SemanticMailDocument = {
      version: "1.0",
      segments: [
        {
          id: "seg_1",
          type: "authored",
          schemaVersion: "1.0",
          text: "hello",
        },
      ],
      entities: [],
      actions: [],
      metadata: {},
    };

    const first = await sha256SemanticDocument(doc);
    const second = await sha256SemanticDocument(doc);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});

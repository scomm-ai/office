import { describe, expect, it } from "vitest";
import { HeuristicSemanticExtractor } from "@scomm-office/semantics";
import { DeterministicPolicyEngine } from "@scomm-office/policy";
import { buildHeadersPreview, toPolicyDocument } from "./analysis.js";
import { fixtureHtml } from "../fixtures.js";

describe("dev-console analysis", () => {
  it("analyzes simple fixture and builds headers", async () => {
    const extractor = new HeuristicSemanticExtractor();
    const { document } = await extractor.extract({
      document: { html: fixtureHtml("simple") },
    });
    expect(document.segments.some((s) => s.type === "authored")).toBe(true);

    const evaluation = new DeterministicPolicyEngine().evaluate({
      document: toPolicyDocument(document),
      recipients: ["alice@example.com"],
      internalDomains: ["example.com"],
    });
    expect(evaluation.allowed).toBe(true);

    const headers = buildHeadersPreview("abc123", "scomm_message_test");
    expect(headers["X-SComm-Semantic-Digest"]).toBe("abc123");
  });

  it("detects quoted content in reply fixture", async () => {
    const { document } = await new HeuristicSemanticExtractor().extract({
      document: { html: fixtureHtml("reply-with-quote") },
    });
    expect(document.segments.some((s) => s.type === "quoted")).toBe(true);
  });
});

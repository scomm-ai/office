import { describe, expect, it } from "vitest";
import {
  DeterministicPolicyEngine,
  mapPolicyToSendDecision,
  type PolicyContext,
} from "./engine.js";
import type { SemanticMailDocument } from "./semantic-document.js";

function baseDocument(overrides: Partial<SemanticMailDocument> = {}): SemanticMailDocument {
  return {
    version: "1.0",
    segments: [{ type: "authored", content: "Hello team" }],
    entities: [],
    actions: [],
    metadata: {},
    ...overrides,
  };
}

function baseContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    document: baseDocument(),
    recipients: ["alice@example.com"],
    internalDomains: ["example.com"],
    ...overrides,
  };
}

describe("DeterministicPolicyEngine", () => {
  const engine = new DeterministicPolicyEngine();

  it("warns on external recipients", () => {
    const evaluation = engine.evaluate(
      baseContext({ recipients: ["alice@example.com", "bob@external.org"] }),
    );
    expect(evaluation.findings.some((f) => f.ruleId === "externalRecipientWarning")).toBe(true);
    expect(mapPolicyToSendDecision(evaluation).mode).toBe("warn");
  });

  it("does not warn when all recipients are internal", () => {
    const evaluation = engine.evaluate(
      baseContext({ recipients: ["alice@example.com", "bob@mail.example.com"] }),
    );
    expect(evaluation.findings.some((f) => f.ruleId === "externalRecipientWarning")).toBe(false);
  });

  it("warns when attachments are present", () => {
    const evaluation = engine.evaluate(baseContext({ attachmentCount: 2 }));
    const finding = evaluation.findings.find((f) => f.ruleId === "attachmentPresent");
    expect(finding?.action).toBe("warn");
  });

  it("blocks on keyword policy match", () => {
    const evaluation = engine.evaluate(
      baseContext({
        document: baseDocument({
          segments: [{ type: "authored", content: "This message is confidential" }],
        }),
        keywordPolicy: { keywords: ["confidential"], action: "block" },
      }),
    );
    expect(mapPolicyToSendDecision(evaluation).mode).toBe("block");
  });

  it("warns on keyword policy when configured to warn", () => {
    const evaluation = engine.evaluate(
      baseContext({
        document: baseDocument({
          segments: [{ type: "authored", content: "Please review urgently" }],
        }),
        keywordPolicy: { keywords: ["urgent"], action: "warn" },
      }),
    );
    expect(mapPolicyToSendDecision(evaluation).mode).toBe("warn");
  });

  it("blocks when classification is required but missing", () => {
    const evaluation = engine.evaluate(
      baseContext({
        classificationRequired: true,
        document: baseDocument({ classification: undefined }),
      }),
    );
    expect(mapPolicyToSendDecision(evaluation).mode).toBe("block");
  });

  it("allows when classification is present", () => {
    const evaluation = engine.evaluate(
      baseContext({
        classificationRequired: true,
        document: baseDocument({
          classification: { label: "internal", sensitivity: "internal" },
        }),
      }),
    );
    expect(mapPolicyToSendDecision(evaluation).mode).toBe("allow");
  });
});

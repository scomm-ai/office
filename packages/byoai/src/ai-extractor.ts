import type {
  SemanticExtractor,
  SemanticExtractionInput,
  SemanticExtractionResult,
  SemanticMailDocument,
} from "@scomm-office/semantics";
import type { ByoaiRouter } from "./router.js";

/**
 * AI-backed advisory semantic extract.
 * Must not drive privileged actions (openspec/security/ai-trust-boundary.md).
 */
export class ByoaiSemanticExtractor implements SemanticExtractor {
  constructor(private readonly router: ByoaiRouter) {}

  async extract(input: SemanticExtractionInput): Promise<SemanticExtractionResult> {
    const body = input.document.plainText ?? input.document.html ?? input.document.subject ?? "";
    const summary = await this.router.summarize(body);
    const document: SemanticMailDocument = {
      version: "1.0",
      segments: [
        {
          id: "ai_summary_1",
          type: "authored",
          schemaVersion: "1.0",
          text: summary,
          confidence: 0.5,
        },
      ],
      entities: [],
      actions: [],
      metadata: {
        source: "byoai",
        advisoryOnly: true,
        warning: "AI output is advisory only and must not trigger privileged actions.",
      },
    };
    return { document };
  }
}

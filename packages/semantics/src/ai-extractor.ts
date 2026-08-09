import { UnsupportedFeatureError } from "@scomm-office/core";
import type { SemanticExtractor, SemanticExtractionInput, SemanticExtractionResult } from "./extractor.js";

const OPEN_SPEC_LINK =
  "https://github.com/scomm-ai/office/blob/main/openspec/features/byoai.md";

export type AiGenerateFn = (prompt: string) => Promise<string>;

/**
 * Optional AI semantic extractor. Prefer `@scomm-office/byoai` `ByoaiSemanticExtractor`
 * for entitlement-gated Local/Cloud routes. This stub accepts an injected generator for tests.
 */
export class AiSemanticExtractor implements SemanticExtractor {
  constructor(private readonly generate?: AiGenerateFn) {}

  async extract(input: SemanticExtractionInput): Promise<SemanticExtractionResult> {
    if (!this.generate) {
      throw new UnsupportedFeatureError(
        `AI semantic extraction is not configured. Wire @scomm-office/byoai. See ${OPEN_SPEC_LINK}`,
      );
    }
    const body = input.document.plainText ?? input.document.html ?? "";
    const text = await this.generate(body);
    return {
      document: {
        version: "1.0",
        segments: [
          {
            id: "ai_1",
            type: "authored",
            schemaVersion: "1.0",
            text,
            confidence: 0.5,
          },
        ],
        entities: [],
        actions: [],
        metadata: { source: "ai-injector", advisoryOnly: true },
      },
    };
  }
}

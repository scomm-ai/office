import { UnsupportedFeatureError } from "@scomm-office/core";
import type { SemanticExtractor, SemanticExtractionInput, SemanticExtractionResult } from "./extractor.js";

const OPEN_SPEC_LINK =
  "https://github.com/scomm-ai/office/blob/main/openspec/architecture/004-semantic-engine.md";

export class AiSemanticExtractor implements SemanticExtractor {
  async extract(_input: SemanticExtractionInput): Promise<SemanticExtractionResult> {
    throw new UnsupportedFeatureError(
      `AI semantic extraction is not configured. See ${OPEN_SPEC_LINK}`,
    );
  }
}

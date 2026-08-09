import type { RawMailDocument, SemanticMailDocument } from "./models.js";

export interface SemanticExtractionInput {
  document: RawMailDocument;
}

export interface SemanticExtractionResult {
  document: SemanticMailDocument;
}

export interface SemanticExtractor {
  extract(input: SemanticExtractionInput): Promise<SemanticExtractionResult>;
}

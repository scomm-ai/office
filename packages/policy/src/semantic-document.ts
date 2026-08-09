/**
 * Minimal semantic document shape for policy evaluation.
 * Full model lives in @scomm-office/semantics — duplicated lightly here
 * until that package is available.
 */

export interface SemanticBodySegment {
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticEntity {
  type: string;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticAction {
  type: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticClassification {
  label: string;
  sensitivity?: "public" | "internal" | "confidential" | "restricted";
  metadata?: Record<string, unknown>;
}

export interface SemanticMailDocument {
  version: string;
  segments: SemanticBodySegment[];
  entities: SemanticEntity[];
  actions: SemanticAction[];
  classification?: SemanticClassification;
  metadata: Record<string, unknown>;
}

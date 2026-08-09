import type { SemanticMailDocument as SemanticsDocument } from "@scomm-office/semantics";
import type { SemanticMailDocument as PolicyDocument } from "@scomm-office/policy";

export function toPolicyDocument(document: SemanticsDocument): PolicyDocument {
  return {
    version: document.version,
    segments: document.segments.map((segment) => ({
      type: segment.type,
      content: segment.text ?? segment.html ?? "",
    })),
    entities: document.entities.map((entity) => ({
      type: entity.type,
      value: entity.value,
    })),
    actions: document.actions.map((action) => ({
      type: action.type,
      description: action.description,
    })),
    classification: document.classification?.label
      ? { label: document.classification.label }
      : undefined,
    metadata: document.metadata,
  };
}

export function buildHeadersPreview(digest: string, messageUid: string): Record<string, string> {
  return {
    "X-SComm-Version": "1",
    "X-SComm-Message-UID": messageUid,
    "X-SComm-Schema": "semantics/1.0",
    "X-SComm-Semantics": "heuristic",
    "X-SComm-Semantic-Digest": digest,
  };
}

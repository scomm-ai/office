import type { SemanticMailDocument as SemanticsDocument } from "@scomm-office/semantics";
import type { SemanticMailDocument as PolicyDocument } from "@scomm-office/policy";

export function toPolicyDocument(document: SemanticsDocument): PolicyDocument {
  return {
    version: document.version,
    segments: document.segments.map((segment) => ({
      type: segment.type,
      content: segment.text ?? segment.html ?? "",
      metadata: {
        id: segment.id,
        confidence: segment.confidence,
      },
    })),
    entities: document.entities.map((entity) => ({
      type: entity.type,
      value: entity.value,
      metadata: { id: entity.id, confidence: entity.confidence },
    })),
    actions: document.actions.map((action) => ({
      type: action.type,
      description: action.description,
      metadata: { id: action.id, confidence: action.confidence },
    })),
    classification: document.classification?.label
      ? {
          label: document.classification.label,
          sensitivity: undefined,
        }
      : undefined,
    metadata: document.metadata,
  };
}

export function collectRecipientEmails(
  message: {
    to?: Array<{ emailAddress: string }>;
    cc?: Array<{ emailAddress: string }>;
    bcc?: Array<{ emailAddress: string }>;
  },
  _currentUserEmail?: string,
): string[] {
  const emails = new Set<string>();
  for (const list of [message.to, message.cc, message.bcc]) {
    for (const address of list ?? []) {
      if (address.emailAddress) {
        emails.add(address.emailAddress);
      }
    }
  }
  return [...emails];
}

export function internalDomainsFromEmail(email: string | undefined): string[] {
  if (!email) {
    return [];
  }
  const at = email.lastIndexOf("@");
  if (at <= 0) {
    return [];
  }
  return [email.slice(at + 1).toLowerCase()];
}

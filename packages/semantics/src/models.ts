export interface MailAddress {
  displayName?: string;
  emailAddress: string;
}

export interface MailAttachmentDescriptor {
  id: string;
  name: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
}

export interface RawMailDocument {
  subject?: string;
  plainText?: string;
  html?: string;
  from?: MailAddress;
  to?: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  attachments?: MailAttachmentDescriptor[];
  headers?: Record<string, string>;
}

export interface BaseSegment {
  id: string;
  type: string;
  sourceRange?: { start: number; end: number };
  confidence?: number;
  text?: string;
  html?: string;
  schemaVersion: string;
}

export interface AuthoredSegment extends BaseSegment {
  type: "authored";
}

export interface SignatureSegment extends BaseSegment {
  type: "signature";
  person?: { name?: string; title?: string };
  organization?: { name?: string; department?: string };
  contacts?: { email?: string[]; phone?: string[]; website?: string[] };
  address?: string;
}

export interface LegaleseSegment extends BaseSegment {
  type: "legalese";
  policyId?: string;
  jurisdiction?: string[];
  confidentiality?: boolean;
  retentionNotice?: boolean;
  rawText?: string;
}

export interface QuotedSegment extends BaseSegment {
  type: "quoted";
  quotedFrom?: MailAddress;
  quotedAt?: string;
  depth?: number;
}

export interface ForwardedSegment extends BaseSegment {
  type: "forwarded";
  forwardedFrom?: MailAddress;
  forwardedAt?: string;
}

export interface AttachmentReferenceSegment extends BaseSegment {
  type: "attachment_reference";
  attachmentId?: string;
  attachmentName?: string;
}

export interface GreetingSegment extends BaseSegment {
  type: "greeting";
}

export interface ClosingSegment extends BaseSegment {
  type: "closing";
}

export interface ActionRequestSegment extends BaseSegment {
  type: "action_request";
}

export interface StructuredDataSegment extends BaseSegment {
  type: "structured_data";
  format?: string;
  payload?: unknown;
}

export interface UnknownSegment extends BaseSegment {
  type: "unknown";
  reason?: string;
}

export type SemanticBodySegment =
  | AuthoredSegment
  | SignatureSegment
  | LegaleseSegment
  | QuotedSegment
  | ForwardedSegment
  | AttachmentReferenceSegment
  | GreetingSegment
  | ClosingSegment
  | ActionRequestSegment
  | StructuredDataSegment
  | UnknownSegment;

export interface SemanticEntity {
  id: string;
  type: "email" | "url" | "phone" | "date" | "other";
  value: string;
  confidence?: number;
}

export interface SemanticAction {
  id: string;
  type: "request" | "approval" | "task" | "question" | "decision" | "meeting" | "other";
  description: string;
  assignees?: MailAddress[];
  dueAt?: string;
  status?: string;
  confidence?: number;
}

export interface SemanticClassification {
  code?: string;
  label?: string;
  confidence?: number;
}

export interface SemanticMailDocument {
  version: "1.0";
  segments: SemanticBodySegment[];
  entities: SemanticEntity[];
  actions: SemanticAction[];
  classification?: SemanticClassification;
  metadata: Record<string, unknown>;
}

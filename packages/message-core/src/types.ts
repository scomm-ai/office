/** Platform-agnostic mail address. */
export interface MailAddress {
  displayName?: string;
  emailAddress: string;
}

/** Decoded attachment bound to binary content, not MIME serialization. */
export interface LogicalAttachment {
  filename: string;
  mediaType: string;
  size: number;
  data: Uint8Array;
  contentId?: string;
  isInline?: boolean;
}

export type BodySegmentType = "authored" | "signature" | "legalese" | "quoted";

export interface BodySegment {
  type: BodySegmentType;
  text: string;
}

/**
 * Logical message — authoritative content for semantic signing and MIME construction.
 * MIME is a serialization; this is the semantic identity of the message.
 */
export interface LogicalMessage {
  subject?: string;
  from?: MailAddress;
  to?: MailAddress[];
  cc?: MailAddress[];
  /** Bcc is kept for compose snapshots but excluded from recipient-visible manifests. */
  bcc?: MailAddress[];
  /** Canonical plain-text authored body — authoritative for semantic signatures. */
  authoredText: string;
  /** HTML rendering — presentation, not authoritative. */
  html?: string;
  attachments?: LogicalAttachment[];
  /** Typed body segments for future per-segment signing policies. */
  segments?: BodySegment[];
  headers?: Record<string, string>;
  messageId?: string;
  timestamp?: string;
}

export interface ComposeSnapshot extends LogicalMessage {
  capturedAt: string;
  nonce: string;
}

import { canonicalizeAuthoredText } from "./canonicalize.js";
import type { ComposeSnapshot, LogicalAttachment, LogicalMessage, MailAddress } from "./types.js";

export interface ExternalMailMessage {
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  from?: MailAddress;
  to?: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  attachments?: Array<{
    id: string;
    name: string;
    contentType?: string;
    size?: number;
    isInline?: boolean;
    data?: Uint8Array;
  }>;
  headers?: Record<string, string>;
}

export function toLogicalMessage(source: ExternalMailMessage): LogicalMessage {
  const plain = source.bodyText?.trim()
    ? source.bodyText
    : source.bodyHtml
      ? htmlToPlainText(source.bodyHtml)
      : "";

  const attachments: LogicalAttachment[] | undefined = source.attachments
    ?.filter((a) => a.data != null)
    .map((a) => ({
      filename: a.name,
      mediaType: a.contentType ?? "application/octet-stream",
      size: a.data?.length ?? a.size ?? 0,
      data: a.data!,
      isInline: a.isInline,
    }));

  return {
    subject: source.subject,
    from: source.from,
    to: source.to,
    cc: source.cc,
    bcc: source.bcc,
    authoredText: canonicalizeAuthoredText(plain),
    html: source.bodyHtml,
    attachments: attachments?.length ? attachments : undefined,
    headers: source.headers,
  };
}

export function captureComposeSnapshot(source: ExternalMailMessage): ComposeSnapshot {
  return {
    ...toLogicalMessage(source),
    capturedAt: new Date().toISOString(),
    nonce: crypto.randomUUID(),
  };
}

/** Minimal HTML-to-text for compose snapshots when plain text is unavailable. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|pre|blockquote)>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

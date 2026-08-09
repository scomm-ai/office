import type { ComposeState, MailAttachment, MailMessage } from "./types.js";

export interface MailHost {
  getMode(): "read" | "compose";
  getCurrentMessage(): Promise<MailMessage>;
  getComposeState(): Promise<ComposeState>;
  setBody(body: { html?: string; text?: string }): Promise<void>;
  getHeaders(): Promise<Record<string, string>>;
  setHeaders(headers: Record<string, string>): Promise<void>;
  getAttachments(): Promise<MailAttachment[]>;
}

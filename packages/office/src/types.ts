export interface MailAddress {
  displayName?: string;
  emailAddress: string;
}

export interface MailAttachment {
  id: string;
  name: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
}

export interface MailMessage {
  id?: string;
  conversationId?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  from?: MailAddress;
  to?: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  attachments?: MailAttachment[];
  headers?: Record<string, string>;
  mode: "read" | "compose";
}

export interface ComposeState {
  subject?: string;
  to?: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  bodyText?: string;
  bodyHtml?: string;
}

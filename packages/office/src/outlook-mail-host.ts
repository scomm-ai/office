import { CapabilityUnavailableError } from "@scomm-office/core";
import type { OutlookCapabilities } from "./capabilities.js";
import type { MailHost } from "./mail-host.js";
import type { ComposeState, MailAddress, MailAttachment, MailMessage } from "./types.js";

type AsyncResult<T> = {
  value?: T;
  status: OfficeAsyncResultStatus | string;
  error?: { message?: string };
};

type OfficeRecipient = {
  displayName?: string;
  emailAddress?: string;
};

type OfficeAttachmentDetails = {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
};

type OfficeInternetHeaders = {
  getAsync(callback: (result: AsyncResult<Record<string, string>>) => void): void;
  setAsync(
    headers: Record<string, string>,
    callback: (result: AsyncResult<void>) => void,
  ): void;
};

type OfficeBody = {
  getAsync?(
    coercionType: OfficeCoercionType,
    callback: (result: AsyncResult<string>) => void,
  ): void;
  setAsync?(
    data: string,
    options: { coercionType: OfficeCoercionType },
    callback: (result: AsyncResult<void>) => void,
  ): void;
};

type OfficeAttachments = {
  getAsync(callback: (result: AsyncResult<OfficeAttachmentDetails[]>) => void): void;
};

type OfficeAsyncAccessor<T> = {
  getAsync(callback: (result: AsyncResult<T>) => void): void;
};

type OfficeMailboxItem = {
  itemType?: string;
  itemId?: string;
  conversationId?: string;
  saveAsync?: unknown;
  displayReplyForm?: unknown;
  addFileAttachmentFromBase64Async?(
    base64: string,
    name: string,
    options: { isInline?: boolean },
    callback: (result: AsyncResult<void>) => void,
  ): void;
  /** Read mode: string. Compose mode: async accessor. */
  subject?: string | OfficeAsyncAccessor<string>;
  internetHeaders?: OfficeInternetHeaders;
  body?: OfficeBody;
  attachments?: OfficeAttachments | OfficeAttachmentDetails[];
  /** Read mode: direct recipient. Compose mode: async accessor. */
  from?: OfficeRecipient | OfficeAsyncAccessor<OfficeRecipient>;
  /** Read mode: array. Compose mode: async accessor. */
  to?: OfficeRecipient[] | OfficeAsyncAccessor<OfficeRecipient[]>;
  cc?: OfficeRecipient[] | OfficeAsyncAccessor<OfficeRecipient[]>;
  bcc?: OfficeRecipient[] | OfficeAsyncAccessor<OfficeRecipient[]>;
  getAllInternetHeadersAsync?(
    callback: (result: AsyncResult<string>) => void,
  ): void;
};

type OfficeMailbox = {
  item?: OfficeMailboxItem | null;
  addHandlerAsync?(
    eventType: string,
    handler: () => void,
    callback?: (result: AsyncResult<void>) => void,
  ): void;
  removeHandlerAsync?(
    eventType: string,
    options?: { handler?: () => void },
    callback?: (result: AsyncResult<void>) => void,
  ): void;
};

type OfficeGlobal = {
  context?: {
    mailbox?: OfficeMailbox;
  };
  EventType?: {
    ItemChanged?: string;
  };
  AsyncResultStatus?: {
    Succeeded: string;
    Failed: string;
  };
  CoercionType?: {
    Text: OfficeCoercionType;
    Html: OfficeCoercionType;
  };
};

type OfficeCoercionType = "text" | "html";
type OfficeAsyncResultStatus = "succeeded" | "failed";

function promisify<T>(
  run: (callback: (result: AsyncResult<T>) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    run((result) => {
      if (String(result.status).toLowerCase() === "succeeded") {
        resolve(result.value as T);
        return;
      }
      reject(new Error(result.error?.message ?? "Office async call failed"));
    });
  });
}

function toMailAddress(recipient?: OfficeRecipient): MailAddress | undefined {
  if (!recipient?.emailAddress) {
    return undefined;
  }
  return {
    displayName: recipient.displayName,
    emailAddress: recipient.emailAddress,
  };
}

function toMailAddresses(recipients?: OfficeRecipient[]): MailAddress[] | undefined {
  if (!recipients?.length) {
    return undefined;
  }
  return recipients
    .map((recipient) => toMailAddress(recipient))
    .filter((address): address is MailAddress => address !== undefined);
}

function mapAttachmentDetails(details: OfficeAttachmentDetails[]): MailAttachment[] {
  return details
    .filter((attachment) => attachment.id && attachment.name)
    .map((attachment) => ({
      id: attachment.id!,
      name: attachment.name!,
      contentType: attachment.contentType,
      size: attachment.size,
      isInline: attachment.isInline,
    }));
}

function hasGetAsync(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "getAsync" in value);
}

function messageIdentity(item: OfficeMailboxItem, mode: "read" | "compose", bodyText?: string): string {
  if (item.itemId) {
    return item.itemId;
  }
  if (item.conversationId) {
    return `${mode}:${item.conversationId}`;
  }
  const subject = typeof item.subject === "string" ? item.subject : "";
  const preview = (bodyText ?? "").slice(0, 48);
  return `${mode}:${subject}:${preview.length}:${preview}`;
}

/** TEMP diagnostic — remove after Encrypt/Sign + Decrypt item-switch issues are confirmed fixed. */
function tempLog(scope: string, payload: Record<string, unknown>): void {
  console.info(`[scomm-temp:${scope}]`, payload);
}

function parseInternetHeadersBlock(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name) {
      headers[name] = value;
    }
  }
  return headers;
}

export class OutlookMailHost implements MailHost {
  private readonly office: OfficeGlobal;
  private readonly capabilities: OutlookCapabilities;

  constructor(office: OfficeGlobal, capabilities: OutlookCapabilities) {
    this.office = office;
    this.capabilities = capabilities;
  }

  private get item(): OfficeMailboxItem {
    const item = this.office.context?.mailbox?.item;
    if (!item) {
      throw new CapabilityUnavailableError("No active Outlook mailbox item");
    }
    return item;
  }

  getMode(): "read" | "compose" {
    const item = this.item;
    // Outlook uses itemType "message" for both read and compose. Prefer APIs that
    // only exist on one side so a late-ready compose item is not treated as read.
    if (typeof item.saveAsync === "function") {
      return "compose";
    }
    if (typeof item.displayReplyForm === "function") {
      return "read";
    }
    if (item.body?.setAsync) {
      return "compose";
    }
    if (hasGetAsync(item.subject) || hasGetAsync(item.to) || hasGetAsync(item.cc) || hasGetAsync(item.bcc)) {
      return "compose";
    }
    if (item.itemType === "messageCompose") {
      return "compose";
    }
    return "read";
  }

  /**
   * Outlook does not update mailbox.item until ItemChanged fires. Subscribe so
   * callers can reload the current message when the user switches mail.
   */
  subscribeItemChanged(handler: () => void): () => void {
    const mailbox = this.office.context?.mailbox;
    const eventType = this.office.EventType?.ItemChanged ?? "itemChanged";
    if (!mailbox?.addHandlerAsync) {
      tempLog("item-changed-subscribe", { ok: false, reason: "addHandlerAsync missing" });
      return () => undefined;
    }
    mailbox.addHandlerAsync(eventType, handler, (result) => {
      tempLog("item-changed-subscribe", {
        ok: String(result.status).toLowerCase() === "succeeded",
        status: String(result.status),
        error: result.error?.message,
        eventType,
      });
    });
    return () => {
      mailbox.removeHandlerAsync?.(eventType, { handler });
    };
  }

  async getCurrentMessage(): Promise<MailMessage> {
    const item = this.item;
    const mode = this.getMode();

    let headers: Record<string, string> = {};
    try {
      headers = await this.getHeaders();
    } catch {
      // Headers may be unavailable in compose mode on some hosts
    }

    const [bodyText, bodyHtml, attachments] = await Promise.all([
      this.readBody("text"),
      this.readBody("html"),
      this.getAttachments(),
    ]);

    const id = messageIdentity(item, mode, bodyText);
    tempLog("get-current-message", {
      id,
      mode,
      itemType: item.itemType ?? null,
      itemId: item.itemId ?? null,
      conversationId: item.conversationId ?? null,
      hasSaveAsync: typeof item.saveAsync === "function",
      hasDisplayReplyForm: typeof item.displayReplyForm === "function",
      hasBodySetAsync: Boolean(item.body?.setAsync),
      subjectIsAsync: hasGetAsync(item.subject),
      bodyTextLength: bodyText?.length ?? 0,
      bodyHtmlLength: bodyHtml?.length ?? 0,
    });

    if (mode === "compose") {
      const [subject, from, to, cc, bcc] = await Promise.all([
        this.readComposeSubject(),
        this.readComposeFrom(),
        this.readComposeRecipients(item.to),
        this.readComposeRecipients(item.cc),
        this.readComposeRecipients(item.bcc),
      ]);
      return { id, conversationId: item.conversationId, subject, from, to, cc, bcc, bodyText, bodyHtml, attachments, headers, mode };
    }

    return {
      id,
      conversationId: item.conversationId,
      subject: typeof item.subject === "string" ? item.subject : undefined,
      from: toMailAddress(item.from as OfficeRecipient | undefined),
      to: toMailAddresses(item.to as OfficeRecipient[] | undefined),
      cc: toMailAddresses(item.cc as OfficeRecipient[] | undefined),
      bcc: toMailAddresses(item.bcc as OfficeRecipient[] | undefined),
      bodyText,
      bodyHtml,
      attachments,
      headers,
      mode,
    };
  }

  private async readComposeSubject(): Promise<string | undefined> {
    const subject = this.item.subject;
    if (typeof subject === "string") return subject;
    if (subject && typeof (subject as OfficeAsyncAccessor<string>).getAsync === "function") {
      try {
        return await promisify<string>((cb) => (subject as OfficeAsyncAccessor<string>).getAsync(cb));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async readComposeFrom(): Promise<MailAddress | undefined> {
    const from = this.item.from;
    if (!from) return undefined;
    if ((from as OfficeRecipient).emailAddress) {
      return toMailAddress(from as OfficeRecipient);
    }
    if (typeof (from as OfficeAsyncAccessor<OfficeRecipient>).getAsync === "function") {
      try {
        const result = await promisify<OfficeRecipient>((cb) =>
          (from as OfficeAsyncAccessor<OfficeRecipient>).getAsync(cb),
        );
        return toMailAddress(result);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async readComposeRecipients(
    field?: OfficeRecipient[] | OfficeAsyncAccessor<OfficeRecipient[]>,
  ): Promise<MailAddress[] | undefined> {
    if (!field) return undefined;
    if (Array.isArray(field)) {
      return toMailAddresses(field);
    }
    if (typeof (field as OfficeAsyncAccessor<OfficeRecipient[]>).getAsync === "function") {
      try {
        const result = await promisify<OfficeRecipient[]>((cb) =>
          (field as OfficeAsyncAccessor<OfficeRecipient[]>).getAsync(cb),
        );
        return toMailAddresses(result);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  async getComposeState(): Promise<ComposeState> {
    if (this.getMode() !== "compose") {
      throw new CapabilityUnavailableError("Compose state is only available in compose mode");
    }

    const message = await this.getCurrentMessage();
    return {
      subject: message.subject,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      bodyText: message.bodyText,
      bodyHtml: message.bodyHtml,
    };
  }

  async setBody(body: { html?: string; text?: string }): Promise<void> {
    const itemBody = this.item.body;
    if (!itemBody?.setAsync) {
      throw new CapabilityUnavailableError("Outlook body API is unavailable");
    }

    const content = body.html ?? body.text;
    if (content === undefined) {
      return;
    }

    const coercionType: OfficeCoercionType = body.html !== undefined ? "html" : "text";
    const setAsync = itemBody.setAsync.bind(itemBody);
    await promisify<void>((callback) => {
      setAsync(content, { coercionType }, callback);
    });
  }

  async addFileAttachment(attachment: { name: string; base64: string; contentType?: string }): Promise<void> {
    const item = this.item as OfficeMailboxItem & {
      addFileAttachmentFromBase64Async?: OfficeMailboxItem["addFileAttachmentFromBase64Async"];
    };
    if (!item.addFileAttachmentFromBase64Async) {
      throw new CapabilityUnavailableError("File attachments require Mailbox 1.8+");
    }
    const add = item.addFileAttachmentFromBase64Async.bind(item);
    await promisify<void>((callback) => {
      add(attachment.base64, attachment.name, { isInline: false }, callback);
    });
  }

  /**
   * Read mode: prefers `getAllInternetHeadersAsync` when present (raw header block parsed
   * line-by-line). Falls back to `internetHeaders.getAsync` when Mailbox ≥ 1.8 exposes it.
   * Compose mode: uses `internetHeaders.getAsync` when capable.
   *
   * Limitation: raw header parsing is best-effort and may not preserve folded header values.
   */
  async getHeaders(): Promise<Record<string, string>> {
    const item = this.item;
    const mode = this.getMode();

    if (mode === "compose") {
      // In compose mode, internetHeaders.getAsync is not reliably available
      // and requires header names as first parameter. Return empty for now.
      return {};
    }

    if (item.getAllInternetHeadersAsync) {
      const raw = await promisify<string>((callback) => {
        item.getAllInternetHeadersAsync!(callback);
      });
      return parseInternetHeadersBlock(raw);
    }

    if (this.capabilities.internetHeaders && item.internetHeaders?.getAsync) {
      return promisify<Record<string, string>>((callback) => {
        item.internetHeaders!.getAsync(callback);
      });
    }

    throw new CapabilityUnavailableError(
      "Internet headers are unavailable in read mode on this host",
    );
  }

  async setHeaders(headers: Record<string, string>): Promise<void> {
    if (this.getMode() !== "compose") {
      throw new CapabilityUnavailableError("Internet headers can only be set in compose mode");
    }
    if (!this.capabilities.internetHeaders || !this.item.internetHeaders?.setAsync) {
      throw new CapabilityUnavailableError("Internet headers require Mailbox 1.8+");
    }

    await promisify<void>((callback) => {
      this.item.internetHeaders!.setAsync(headers, callback);
    });
  }

  async getAttachments(): Promise<MailAttachment[]> {
    const attachmentsApi = this.item.attachments;
    if (Array.isArray(attachmentsApi)) {
      return mapAttachmentDetails(attachmentsApi);
    }
    if (!attachmentsApi?.getAsync) {
      return [];
    }

    try {
      const details = await promisify<OfficeAttachmentDetails[]>((callback) => {
        attachmentsApi.getAsync(callback);
      });
      return mapAttachmentDetails(details);
    } catch {
      return [];
    }
  }

  private async readBody(coercionType: OfficeCoercionType): Promise<string | undefined> {
    const itemBody = this.item.body;
    if (!itemBody?.getAsync) {
      return undefined;
    }

    try {
      const getAsync = itemBody.getAsync.bind(itemBody);
      return await promisify<string>((callback) => {
        getAsync(coercionType, callback);
      });
    } catch {
      return undefined;
    }
  }
}

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
  getAsync(
    coercionType: OfficeCoercionType,
    callback: (result: AsyncResult<string>) => void,
  ): void;
  setAsync(
    data: string,
    options: { coercionType: OfficeCoercionType },
    callback: (result: AsyncResult<void>) => void,
  ): void;
};

type OfficeAttachments = {
  getAsync(callback: (result: AsyncResult<OfficeAttachmentDetails[]>) => void): void;
};

type OfficeMailboxItem = {
  itemType?: string;
  subject?: string;
  internetHeaders?: OfficeInternetHeaders;
  body?: OfficeBody;
  attachments?: OfficeAttachments;
  from?: OfficeRecipient;
  to?: OfficeRecipient[];
  cc?: OfficeRecipient[];
  bcc?: OfficeRecipient[];
  getAllInternetHeadersAsync?(
    callback: (result: AsyncResult<string>) => void,
  ): void;
};

type OfficeMailbox = {
  item?: OfficeMailboxItem | null;
};

type OfficeGlobal = {
  context?: {
    mailbox?: OfficeMailbox;
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
    const itemType = this.item.itemType;
    if (itemType === "messageCompose") {
      return "compose";
    }
    return "read";
  }

  async getCurrentMessage(): Promise<MailMessage> {
    const item = this.item;
    const mode = this.getMode();
    const [bodyText, bodyHtml, attachments, headers] = await Promise.all([
      this.readBody("text"),
      this.readBody("html"),
      this.getAttachments(),
      this.getHeaders(),
    ]);

    return {
      subject: item.subject,
      from: toMailAddress(item.from),
      to: toMailAddresses(item.to),
      cc: toMailAddresses(item.cc),
      bcc: toMailAddresses(item.bcc),
      bodyText,
      bodyHtml,
      attachments,
      headers,
      mode,
    };
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
    await promisify<void>((callback) => {
      itemBody.setAsync(content, { coercionType }, callback);
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
      if (!this.capabilities.internetHeaders || !item.internetHeaders?.getAsync) {
        throw new CapabilityUnavailableError(
          "Internet headers require Mailbox 1.8+ in compose mode",
        );
      }
      return promisify<Record<string, string>>((callback) => {
        item.internetHeaders!.getAsync(callback);
      });
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
    if (!attachmentsApi?.getAsync) {
      if (!this.capabilities.attachments) {
        throw new CapabilityUnavailableError("Attachments API is unavailable");
      }
      return [];
    }

    const details = await promisify<OfficeAttachmentDetails[]>((callback) => {
      attachmentsApi.getAsync(callback);
    });

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

  private async readBody(coercionType: OfficeCoercionType): Promise<string | undefined> {
    const itemBody = this.item.body;
    if (!itemBody?.getAsync) {
      return undefined;
    }

    try {
      return await promisify<string>((callback) => {
        itemBody.getAsync(coercionType, callback);
      });
    } catch {
      return undefined;
    }
  }
}

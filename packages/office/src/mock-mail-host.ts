import { loadFixture, type FixtureName } from "@scomm-office/testkit";
import type { MailHost } from "./mail-host.js";
import type { ComposeState, MailAttachment, MailMessage } from "./types.js";

export class MockMailHost implements MailHost {
  private message: MailMessage;

  constructor(message: Partial<MailMessage> = {}) {
    this.message = {
      mode: message.mode ?? "read",
      ...message,
      headers: { ...message.headers },
    };
  }

  static async fromFixture(
    name: FixtureName,
    overrides: Partial<MailMessage> = {},
  ): Promise<MockMailHost> {
    const bodyHtml = await loadFixture(name);
    return new MockMailHost({ bodyHtml, mode: "read", ...overrides });
  }

  getMode(): "read" | "compose" {
    return this.message.mode;
  }

  async getCurrentMessage(): Promise<MailMessage> {
    return {
      ...this.message,
      headers: { ...this.message.headers },
      to: this.message.to ? [...this.message.to] : undefined,
      cc: this.message.cc ? [...this.message.cc] : undefined,
      bcc: this.message.bcc ? [...this.message.bcc] : undefined,
      attachments: this.message.attachments ? [...this.message.attachments] : undefined,
    };
  }

  async getComposeState(): Promise<ComposeState> {
    return {
      subject: this.message.subject,
      to: this.message.to ? [...this.message.to] : undefined,
      cc: this.message.cc ? [...this.message.cc] : undefined,
      bcc: this.message.bcc ? [...this.message.bcc] : undefined,
      bodyText: this.message.bodyText,
      bodyHtml: this.message.bodyHtml,
    };
  }

  async setBody(body: { html?: string; text?: string }): Promise<void> {
    if (body.html !== undefined) {
      this.message.bodyHtml = body.html;
    }
    if (body.text !== undefined) {
      this.message.bodyText = body.text;
    }
  }

  async getHeaders(): Promise<Record<string, string>> {
    return { ...this.message.headers };
  }

  async setHeaders(headers: Record<string, string>): Promise<void> {
    this.message.headers = { ...this.message.headers, ...headers };
  }

  async getAttachments(): Promise<MailAttachment[]> {
    return this.message.attachments ? [...this.message.attachments] : [];
  }
}

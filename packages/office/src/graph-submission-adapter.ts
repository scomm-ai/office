import type { MessageSubmissionAdapter, ProtectedMessage } from "@scomm-office/crypto";

export interface GraphTokenProvider {
  getGraphToken(scopes: string[]): Promise<string>;
}

export interface GraphEnvelope {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
}

/**
 * Microsoft Graph submission adapter.
 *
 * Sends the RFC 3156 MIME directly via Graph's sendMail endpoint,
 * bypassing the Office.js body limitation.
 */
export class GraphSubmissionAdapter implements MessageSubmissionAdapter {
  constructor(
    private readonly tokenProvider: GraphTokenProvider,
    private readonly envelope: GraphEnvelope,
  ) {}

  async submit(protectedMessage: ProtectedMessage, _headers?: Record<string, string>): Promise<void> {
    const mimeBody = protectedMessage.eml ?? protectedMessage.mime;
    const mimeText = new TextDecoder("latin1").decode(mimeBody);

    // Prepend email envelope headers to the MIME body
    const headerLines = [
      `From: ${this.envelope.from}`,
      `To: ${this.envelope.to.join(", ")}`,
    ];
    if (this.envelope.cc && this.envelope.cc.length > 0) {
      headerLines.push(`Cc: ${this.envelope.cc.join(", ")}`);
    }
    headerLines.push(`Subject: ${this.envelope.subject}`);
    headerLines.push("MIME-Version: 1.0");

    const fullMime = headerLines.join("\r\n") + "\r\n" + mimeText;
    const base64Mime = btoa(unescape(encodeURIComponent(fullMime)));

    const token = await this.tokenProvider.getGraphToken(["Mail.Send"]);
    const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: base64Mime,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph sendMail failed (${response.status}): ${body}`);
    }
  }
}

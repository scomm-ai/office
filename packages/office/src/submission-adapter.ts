import type { MessageSubmissionAdapter, ProtectedMessage } from "@scomm-office/crypto";
import type { MailHost } from "./mail-host.js";

export interface OfficeSubmissionOptions {
  /** When true, sets armored/text body (Office.js cannot set arbitrary MIME trees). */
  fallbackToTextBody?: boolean;
}

/**
 * Microsoft Office.js submission adapter.
 *
 * Platform limitation: Office.js compose APIs cannot inject an arbitrary final MIME
 * tree. RFC 3156 MIME is generated correctly by the SDK; this adapter applies the
 * best available Office.js path and documents the gap for Graph/SMTP adapters.
 */
export class OfficeSubmissionAdapter implements MessageSubmissionAdapter {
  constructor(
    private readonly mailHost: MailHost,
    private readonly options: OfficeSubmissionOptions = { fallbackToTextBody: true },
  ) {}

  async submit(protectedMessage: ProtectedMessage, headers?: Record<string, string>): Promise<void> {
    if (headers && Object.keys(headers).length > 0) {
      await this.mailHost.setHeaders(headers);
    }

    const eml = protectedMessage.eml ?? protectedMessage.mime;
    const emlText = new TextDecoder("latin1").decode(eml);

    if (this.options.fallbackToTextBody) {
      await this.mailHost.setBody({ text: emlText });
      return;
    }

    throw new Error(
      "Office.js cannot submit arbitrary MIME structures. Use MicrosoftGraphSubmissionAdapter or enable fallbackToTextBody.",
    );
  }

  static limitationNote(): string {
    return (
      "Outlook compose via Office.js cannot replace the full MIME envelope. " +
      "The SDK emits standards-compliant RFC 3156 MIME; submission uses the best supported " +
      "Office.js path until Microsoft Graph or SMTP adapters are configured."
    );
  }
}

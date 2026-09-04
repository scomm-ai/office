import type { MessageSubmissionAdapter, ProtectedMessage } from "@scomm-office/crypto";
import { MicrosoftGraphError } from "@scomm-office/core";
import type { MicrosoftGraphClient } from "./types.js";

const CRLF = "\r\n";
const REQUIRED_ENVELOPE_HEADERS = ["From", "To", "Subject"];

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function generateMessageId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}.${Math.random().toString(16).slice(2)}`;
  return `<${random}@scomm.ai>`;
}

function buildEnvelopeHeaderBlock(headers: Record<string, string>): string {
  const missing = REQUIRED_ENVELOPE_HEADERS.filter((name) => !hasHeader(headers, name));
  if (missing.length > 0) {
    throw new MicrosoftGraphError(
      `GraphSubmissionAdapter.submit requires envelope headers: ${missing.join(", ")}`,
    );
  }

  const withDefaults = { ...headers };
  if (!hasHeader(withDefaults, "Date")) {
    withDefaults.Date = new Date().toUTCString();
  }
  if (!hasHeader(withDefaults, "Message-ID")) {
    withDefaults["Message-ID"] = generateMessageId();
  }

  return (
    Object.entries(withDefaults)
      .map(([name, value]) => `${name}: ${value}`)
      .join(CRLF) + CRLF
  );
}

/**
 * Sends protected (PGP/MIME or S/MIME) messages through Microsoft Graph instead of
 * relying on Office.js compose APIs to relay the final envelope.
 *
 * Office.js's `item.body.setAsync` can only replace body *content*; the message
 * Outlook actually transmits is assembled by the host afterward, so a correctly
 * generated `multipart/encrypted; protocol="application/pgp-encrypted"` structure
 * never reaches the wire (see `OfficeSubmissionAdapter` in `@scomm-office/office`).
 * Graph's "create draft from raw MIME, then send" flow accepts the exact bytes the
 * crypto SDK produces, so this adapter sends a brand-new message directly through
 * Graph rather than editing the open compose item.
 *
 * Because Graph parses the envelope (From/To/Subject/...) from the MIME headers
 * rather than from any currently-open compose item, `headers` must supply the full
 * RFC 822 envelope, not just custom add-in headers.
 */
export class GraphSubmissionAdapter implements MessageSubmissionAdapter {
  constructor(private readonly graph: MicrosoftGraphClient) {}

  async submit(protectedMessage: ProtectedMessage, headers: Record<string, string> = {}): Promise<void> {
    const contentBytes = protectedMessage.eml ?? protectedMessage.mime;
    const contentText = new TextDecoder("latin1").decode(contentBytes);
    const envelopeText = buildEnvelopeHeaderBlock(headers);
    const fullMessage = envelopeText + contentText;
    await this.graph.sendMimeMessage(new TextEncoder().encode(fullMessage));
  }
}

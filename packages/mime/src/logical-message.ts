import type { LogicalAttachment, LogicalMessage } from "@scomm-office/message-core";
import {
  buildAttachmentPart,
  buildMessageFromParts,
  buildMultipartAlternative,
  type MimeMessage,
  type MimePart,
} from "./mime.js";

/** Build the inner logical MIME entity from a LogicalMessage (before signing/encryption). */
export function logicalMessageToMime(message: LogicalMessage): MimeMessage {
  const alternative = buildMultipartAlternative(message.authoredText, message.html);
  const attachmentParts: MimePart[] = (message.attachments ?? []).map((att: LogicalAttachment) =>
    buildAttachmentPart(att.filename, att.mediaType, att.data),
  );
  return buildMessageFromParts(alternative, attachmentParts);
}

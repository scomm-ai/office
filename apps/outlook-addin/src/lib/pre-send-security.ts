import { captureComposeSnapshot } from "@scomm-office/message-core";
import { OfficeSubmissionAdapter } from "@scomm-office/office";
import { collectRecipientEmails } from "./semantic-policy.js";
import {
  defaultSecurityPolicy,
  getMailSecurityService,
  protectComposeSnapshot,
  type ComposeSecurityOptions,
} from "./mail-security-bridge.js";
import type { OfficePubkeySession } from "./pubkey-session.js";

export interface PreSendSecurityResult {
  allowed: boolean;
  errorMessage?: string;
  resolvedProtocol?: string;
  recipientCompatibility?: string;
}

export async function evaluatePreSendSecurity(
  session: OfficePubkeySession,
  mailHost: import("@scomm-office/office").MailHost,
  userEmail: string,
  options: ComposeSecurityOptions,
): Promise<PreSendSecurityResult> {
  const message = await mailHost.getCurrentMessage();
  const snapshot = captureComposeSnapshot({
    subject: message.subject,
    bodyText: message.bodyText,
    bodyHtml: message.bodyHtml,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    attachments: message.attachments?.map((a) => ({
      id: a.id,
      name: a.name,
      contentType: a.contentType,
      size: a.size,
      isInline: a.isInline,
    })),
    headers: message.headers,
  });

  if (!options.sign && !options.encrypt) {
    const emails = collectRecipientEmails(message);
    for (const email of emails) {
      try {
        const key = await session.client.getBestKey({ email, purpose: "encryption" });
        if (key) {
          return {
            allowed: false,
            errorMessage:
              `Recipient ${email} has a published encryption key. Enable Encrypt or remove the recipient.`,
          };
        }
      } catch {
        /* directory lookup failure — do not block send */
      }
    }
    return { allowed: true };
  }

  const result = await protectComposeSnapshot(session, snapshot, userEmail, options, defaultSecurityPolicy);
  if (!result.decision.allowed) {
    return {
      allowed: false,
      errorMessage: result.decision.blockedReason ?? "Security requirements cannot be met",
      resolvedProtocol: result.decision.negotiation.resolvedProtocol,
      recipientCompatibility: `${result.decision.negotiation.compatibleRecipients}/${result.decision.negotiation.totalRecipients} compatible`,
    };
  }

  if (result.protectedMessage) {
    const adapter = new OfficeSubmissionAdapter(mailHost);
    await adapter.submit(result.protectedMessage);
  }

  return {
    allowed: true,
    resolvedProtocol: result.decision.negotiation.resolvedProtocol,
    recipientCompatibility: `${result.decision.negotiation.compatibleRecipients}/${result.decision.negotiation.totalRecipients} compatible`,
  };
}

export function inspectReceivedMime(mimeBytes: Uint8Array) {
  return getMailSecurityService().inspectMime(mimeBytes);
}

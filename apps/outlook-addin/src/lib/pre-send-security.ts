import type { MailHost } from "@scomm-office/office";
import { collectRecipientEmails } from "./semantic-policy.js";
import { getMailSecurityService, type ComposeSecurityOptions } from "./mail-security-bridge.js";
import {
  encryptComposeBody,
  signComposeBody,
} from "./mail-crypto-actions.js";
import type { OfficePubkeySession } from "./pubkey-session.js";

export interface PreSendSecurityResult {
  allowed: boolean;
  errorMessage?: string;
  resolvedProtocol?: string;
  recipientCompatibility?: string;
}

/**
 * Outlook cannot submit RFC 3156 MIME via Office.js. Protect the body with armored
 * OpenPGP instead of pasting a MIME tree into the compose editor.
 */
export async function evaluatePreSendSecurity(
  session: OfficePubkeySession,
  mailHost: MailHost,
  userEmail: string,
  options: ComposeSecurityOptions,
): Promise<PreSendSecurityResult> {
  const message = await mailHost.getCurrentMessage();

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

  try {
    if (options.encrypt) {
      await encryptComposeBody({
        session,
        mailHost,
        userEmail,
        sign: options.sign,
      });
    } else {
      await signComposeBody({ session, mailHost });
    }
  } catch (err) {
    return {
      allowed: false,
      errorMessage: err instanceof Error ? err.message : "Security requirements cannot be met",
    };
  }

  return {
    allowed: true,
    resolvedProtocol: "openpgp-armored",
  };
}

export function inspectReceivedMime(mimeBytes: Uint8Array) {
  return getMailSecurityService().inspectMime(mimeBytes);
}

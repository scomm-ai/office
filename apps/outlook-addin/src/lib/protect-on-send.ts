import { captureComposeSnapshot, type MailAddress } from "@scomm-office/message-core";
import type { MailHost } from "@scomm-office/office";
import type { ProtectedMessage } from "@scomm-office/crypto";
import { collectRecipientEmails } from "./semantic-policy";
import {
  defaultSecurityPolicy,
  protectComposeSnapshot,
  type ComposeSecurityOptions,
} from "./mail-security-bridge";
import {
  encryptComposeBody,
  evaluateSendForToggles,
  itemIsProtected,
  lookupRecipientStatuses,
  signComposeBody,
} from "./mail-crypto-actions";
import { loadPgpEntitlement } from "./billing-pgp";
import type { OfficePubkeySession } from "./pubkey-session";
import type { ComposeProtectionToggles } from "./compose-security-state";

export type ProtectOnSendOutcome =
  | { outcome: "allow-native" }
  | { outcome: "block"; errorMessage: string }
  | { outcome: "graph-sent" }
  | { outcome: "body-protected" };

function formatAddress(addr: MailAddress): string {
  return addr.displayName
    ? `"${addr.displayName.replace(/"/g, '\\"')}" <${addr.emailAddress}>`
    : addr.emailAddress;
}

function formatAddressList(addrs: MailAddress[] | undefined): string | undefined {
  if (!addrs || addrs.length === 0) return undefined;
  return addrs.map(formatAddress).join(", ");
}

export function buildEnvelopeHeaders(
  snapshot: { from?: MailAddress; to?: MailAddress[]; cc?: MailAddress[]; bcc?: MailAddress[]; subject?: string },
  userEmail: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    From: formatAddress(snapshot.from ?? { emailAddress: userEmail }),
    To: formatAddressList(snapshot.to) ?? userEmail,
    Subject: snapshot.subject ?? "",
  };
  const cc = formatAddressList(snapshot.cc);
  if (cc) headers.Cc = cc;
  const bcc = formatAddressList(snapshot.bcc);
  if (bcc) headers.Bcc = bcc;
  return headers;
}

async function writeInlineProtection(options: {
  session: OfficePubkeySession;
  mailHost: MailHost;
  userEmail: string;
  toggles: ComposeProtectionToggles;
}): Promise<void> {
  if (options.toggles.encrypt) {
    await encryptComposeBody({
      session: options.session,
      mailHost: options.mailHost,
      userEmail: options.userEmail,
      sign: options.toggles.sign,
    });
    return;
  }
  await signComposeBody({ session: options.session, mailHost: options.mailHost });
}

export async function protectOnSend(options: {
  session: OfficePubkeySession;
  mailHost: MailHost;
  userEmail: string;
  toggles: ComposeProtectionToggles;
  protocol?: ComposeSecurityOptions["protocol"];
  graphSubmit?: (message: ProtectedMessage, headers: Record<string, string>) => Promise<void>;
}): Promise<ProtectOnSendOutcome> {
  const { session, mailHost, userEmail, toggles } = options;
  const current = await mailHost.getCurrentMessage();
  if (itemIsProtected(current.bodyText, current.bodyHtml)) {
    return { outcome: "allow-native" };
  }

  const emails = collectRecipientEmails(current);
  const recipients = await lookupRecipientStatuses(session, emails, { userEmail });
  const pgpEntitled = await loadPgpEntitlement();
  const gate = evaluateSendForToggles(
    toggles,
    current.bodyText ?? "",
    current.bodyHtml ?? "",
    recipients,
    pgpEntitled,
  );
  if (!gate.allow) {
    return { outcome: "block", errorMessage: gate.errorMessage ?? "Scomm.AI blocked this send." };
  }
  if (!gate.needsProtect) {
    return { outcome: "allow-native" };
  }

  if (options.graphSubmit && toggles.encrypt) {
    try {
      const snapshot = captureComposeSnapshot({
        subject: current.subject,
        bodyText: current.bodyText,
        bodyHtml: current.bodyHtml,
        from: current.from ?? { emailAddress: userEmail },
        to: current.to,
        cc: current.cc,
        bcc: current.bcc,
        headers: current.headers,
      });
      const result = await protectComposeSnapshot(
        session,
        snapshot,
        userEmail,
        {
          sign: toggles.sign,
          encrypt: toggles.encrypt,
          protocol: options.protocol ?? "automatic",
        },
        defaultSecurityPolicy,
      );
      if (!result.decision.allowed) {
        return {
          outcome: "block",
          errorMessage: result.decision.blockedReason ?? "Cannot apply protection",
        };
      }
      if (result.protectedMessage) {
        await options.graphSubmit(result.protectedMessage, buildEnvelopeHeaders(snapshot, userEmail));
        return { outcome: "graph-sent" };
      }
    } catch {
      // Silent Graph or SDK MIME failed — fall back to inline armor in the compose body.
    }
  }

  await writeInlineProtection({ session, mailHost, userEmail, toggles });
  return { outcome: "body-protected" };
}

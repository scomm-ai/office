import { CryptoFamily } from "@scomm-office/crypto";
import { useCallback, useEffect, useState } from "react";
import { OfficeSubmissionAdapter } from "@scomm-office/office";
import { captureComposeSnapshot } from "@scomm-office/message-core";
import { useHostContext } from "../../lib/host-context";
import {
  defaultSecurityPolicy,
  protectComposeSnapshot,
  type ComposeSecurityOptions,
} from "../../lib/mail-security-bridge";
import {
  loadComposeTogglesFromItem,
  saveComposeTogglesToItem,
} from "../../lib/compose-security-state";
import { lookupRecipientStatuses } from "../../lib/mail-crypto-actions";
import { assertPgpAddon, PGP_ADDON_REQUIRED_MESSAGE } from "../../lib/billing-pgp";
import type { RecipientDirectoryStatus } from "../../lib/directory-key";
import { restoreOfficeVault, type OfficePubkeySession } from "../../lib/pubkey-session";
import { resolvePubkeyReadBaseUrl } from "../../lib/settings";
import { collectRecipientEmails } from "../../lib/semantic-policy";

function composeItem(): Office.MessageCompose | undefined {
  if (typeof Office === "undefined") return undefined;
  try {
    return Office.context?.mailbox?.item as Office.MessageCompose | undefined;
  } catch {
    return undefined;
  }
}

export function useComposeSecurity(session: OfficePubkeySession | null, userEmail: string | undefined) {
  const { mailHost, message, refreshMessage } = useHostContext();
  const [sign, setSign] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [protocol, setProtocol] = useState<"automatic" | CryptoFamily>("automatic");
  const [status, setStatus] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recipients, setRecipients] = useState<RecipientDirectoryStatus[]>([]);

  useEffect(() => {
    void loadComposeTogglesFromItem(composeItem()).then((toggles) => {
      setSign(toggles.sign);
      setEncrypt(toggles.encrypt);
    });
  }, [message?.id]);

  useEffect(() => {
    if (!session || !message) {
      setRecipients([]);
      return;
    }
    const emails = collectRecipientEmails(message);
    if (emails.length === 0) {
      setRecipients([]);
      return;
    }
    let cancelled = false;
    void lookupRecipientStatuses(session, emails).then((rows) => {
      if (!cancelled) setRecipients(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [session, message]);

  const persistToggles = useCallback(async (next: { sign: boolean; encrypt: boolean }) => {
    await saveComposeTogglesToItem(composeItem(), next).catch(() => undefined);
  }, []);

  const applyProtection = useCallback(async () => {
    if (!session || !userEmail) return;
    setBusy(true);
    setStatus(null);
    setResolved(null);
    try {
      await assertPgpAddon();
      await restoreOfficeVault(session);
      await persistToggles({ sign, encrypt });
      const current = message ?? (await mailHost.getCurrentMessage());
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

      const options: ComposeSecurityOptions = { sign, encrypt, protocol };
      const result = await protectComposeSnapshot(session, snapshot, userEmail, options, defaultSecurityPolicy);

      if (!result.decision.allowed) {
        setStatus(result.decision.blockedReason ?? "Cannot apply protection");
        return;
      }

      if (result.protectedMessage) {
        const adapter = new OfficeSubmissionAdapter(mailHost);
        await adapter.submit(result.protectedMessage);
        await refreshMessage();
      }

      setResolved(result.decision.negotiation.resolvedProtocol);
      setStatus(
        `Applied ${result.decision.mode} via ${result.decision.family}. ` +
          `Recipients: ${result.decision.negotiation.compatibleRecipients}/${result.decision.negotiation.totalRecipients} compatible. ` +
          OfficeSubmissionAdapter.limitationNote(),
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [session, userEmail, message, mailHost, refreshMessage, sign, encrypt, protocol, persistToggles]);

  return {
    sign,
    setSign: (value: boolean) => {
      setSign(value);
      void persistToggles({ sign: value, encrypt });
    },
    encrypt,
    setEncrypt: (value: boolean) => {
      setEncrypt(value);
      void persistToggles({ sign, encrypt: value });
    },
    protocol,
    setProtocol,
    status,
    resolved,
    busy,
    applyProtection,
    recipients,
  };
}

export function ComposeSecurityControls(props: {
  session: OfficePubkeySession | null;
  userEmail: string | undefined;
  engineReady: boolean;
  composeMode: boolean;
  pgpEntitled: boolean;
}) {
  const security = useComposeSecurity(props.session, props.userEmail);
  const pubkeyBase = resolvePubkeyReadBaseUrl(useHostContext().settings);
  const paidReady = props.engineReady && props.pgpEntitled;
  const canUncheckSign = !props.pgpEntitled && security.sign;
  const canUncheckEncrypt = !props.pgpEntitled && security.encrypt;

  return (
    <section>
      <h2>Message protection</h2>
      <p className="note">
        Same actions as the Scomm.AI ribbon: Sign and Encrypt use classical OpenPGP from pubkey.scomm.ai.
        S/MIME stays in native Outlook. PQC is Scomm.AI mail only. Paid <code>pgp</code> add-on required
        to apply protection.
      </p>
      {!props.pgpEntitled ? <p className="note">{PGP_ADDON_REQUIRED_MESSAGE}</p> : null}
      <div className="actions" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label>
          <input
            type="checkbox"
            checked={security.sign}
            onChange={(e) => security.setSign(e.target.checked)}
            disabled={!props.composeMode || (!paidReady && !canUncheckSign)}
          />{" "}
          Sign
        </label>
        <label>
          <input
            type="checkbox"
            checked={security.encrypt}
            onChange={(e) => security.setEncrypt(e.target.checked)}
            disabled={!props.composeMode || (!paidReady && !canUncheckEncrypt)}
          />{" "}
          Encrypt
        </label>
        {security.recipients.length > 0 ? (
          <ul className="list-plain">
            {security.recipients.map((row) => (
              <li key={row.email}>
                <strong>{row.email}</strong>{" "}
                <span
                  className={`status ${row.addInCanEncrypt ? "ok" : row.status === "missing" ? "warn" : "muted"}`}
                >
                  {row.status === "found" ? row.family : row.status}
                </span>
                <div className="note">{row.hint}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">Add To/Cc/Bcc to look up keys on pubkey.scomm.ai.</p>
        )}
        <details>
          <summary>Advanced</summary>
          <label>
            Protocol{" "}
            <select
              value={security.protocol}
              onChange={(e) =>
                security.setProtocol(e.target.value as "automatic" | CryptoFamily)
              }
              disabled={!props.composeMode}
            >
              <option value="automatic">Automatic</option>
              <option value={CryptoFamily.OpenPGP}>OpenPGP</option>
              <option value={CryptoFamily.SMIME}>S/MIME (native Outlook)</option>
            </select>
          </label>
        </details>
        <button
          type="button"
          className="primary"
          disabled={
            security.busy ||
            !paidReady ||
            !props.composeMode ||
            (!security.sign && !security.encrypt)
          }
          onClick={() => void security.applyProtection()}
        >
          Apply protection
        </button>
      </div>
      {security.resolved ? (
        <p className="note">
          Resolved: {security.resolved} · Directory: {pubkeyBase || "—"}
        </p>
      ) : null}
      {security.status ? <p className="note">{security.status}</p> : null}
    </section>
  );
}

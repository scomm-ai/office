import { useCallback, useEffect, useState } from "react";
import { useHostContext } from "../../lib/host-context";
import {
  loadComposeTogglesFromItem,
  saveComposeTogglesToItem,
} from "../../lib/compose-security-state";
import {
  encryptComposeBody,
  lookupRecipientStatuses,
  signComposeBody,
} from "../../lib/mail-crypto-actions";
import { assertPgpAddon, PGP_ADDON_REQUIRED_MESSAGE } from "../../lib/billing-pgp";
import type { RecipientDirectoryStatus } from "../../lib/directory-key";
import { restoreOfficeVault, type OfficePubkeySession } from "../../lib/pubkey-session";
import { resolvePubkeyReadBaseUrl } from "../../lib/settings";
import { collectRecipientEmails } from "../../lib/semantic-policy";
import { Button } from "../ui/layout";

function composeItem(): Office.MessageCompose | undefined {
  if (typeof Office === "undefined") return undefined;
  try {
    return Office.context?.mailbox?.item as Office.MessageCompose | undefined;
  } catch {
    return undefined;
  }
}

export function useComposeSecurity(session: OfficePubkeySession | null, userEmail: string | undefined) {
  const { mailHost, message, refreshMessage, capabilities } = useHostContext();
  const [sign, setSign] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
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
      // Office.js cannot set RFC 3156 Content-Type. Never paste MIME trees into the body.
      const note = encrypt
        ? await encryptComposeBody({
            session,
            mailHost,
            userEmail,
            sign,
            capabilities,
          })
        : await signComposeBody({ session, mailHost });
      await refreshMessage();
      setResolved("openpgp-armored");
      setStatus(note);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [session, userEmail, mailHost, refreshMessage, sign, encrypt, persistToggles, capabilities]);

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
        Sign and Encrypt write armored OpenPGP into the Outlook body. Outlook cannot send a real
        RFC 3156 MIME envelope through Office.js, so Sign must not dump <code>multipart/signed</code>
        headers into the message. S/MIME stays in native Outlook. Paid <code>pgp</code> add-on required.
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
        <Button
          appearance="primary"
          size="small"
          disabled={
            security.busy ||
            !paidReady ||
            !props.composeMode ||
            (!security.sign && !security.encrypt)
          }
          onClick={() => void security.applyProtection()}
        >
          Apply protection
        </Button>
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

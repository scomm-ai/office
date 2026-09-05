import { CryptoFamily } from "@scomm-office/crypto";
import { useCallback, useEffect, useState } from "react";
import { useHostContext } from "../../lib/host-context";
import {
  loadComposeTogglesFromItem,
  saveComposeTogglesToItem,
} from "../../lib/compose-security-state";
import { lookupRecipientStatuses } from "../../lib/mail-crypto-actions";
import type { RecipientDirectoryStatus } from "../../lib/directory-key";
import type { OfficePubkeySession } from "../../lib/pubkey-session";
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
  const { message } = useHostContext();
  const [sign, setSign] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [protocol, setProtocol] = useState<"automatic" | CryptoFamily>("automatic");
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
    void lookupRecipientStatuses(session, emails, { userEmail }).then((rows) => {
      if (!cancelled) setRecipients(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [session, message, userEmail]);

  const persistToggles = useCallback(async (next: { sign: boolean; encrypt: boolean }) => {
    await saveComposeTogglesToItem(composeItem(), next).catch(() => undefined);
  }, []);

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
    recipients,
  };
}

export function ComposeSecurityControls(props: {
  session: OfficePubkeySession | null;
  userEmail: string | undefined;
  engineReady: boolean;
  composeMode: boolean;
}) {
  const security = useComposeSecurity(props.session, props.userEmail);
  const { settings, graphDiagnostics } = useHostContext();
  const pubkeyBase = resolvePubkeyReadBaseUrl(settings);

  return (
    <section>
      <h2>Message protection</h2>
      <p className="note">
        Enable Encrypt and/or Sign, then use Outlook’s Send. Scomm.AI protects the message at send
        time (Microsoft Graph MIME when signed in silently, otherwise inline OpenPGP in the body).
        Classical OpenPGP keys come from the pubkey directory (local by default). S/MIME stays in native Outlook.
      </p>
      <p className="note">
        Microsoft Graph send:{" "}
        {!graphDiagnostics.clientIdConfigured
          ? `not configured (${graphDiagnostics.error ?? "VITE_AZURE_CLIENT_ID not set"}) — Send will use inline OpenPGP in the compose body.`
          : graphDiagnostics.probedSuccessfully === true
            ? "connected — Send will try Graph first for a correct MIME envelope."
            : graphDiagnostics.probedSuccessfully === false
              ? `unavailable (${graphDiagnostics.error ?? "unknown reason"}) — Send will use inline OpenPGP in the compose body.`
              : "configured — Send uses silent Graph when a session exists, otherwise inline OpenPGP."}
      </p>
      <div className="actions" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label>
          <input
            type="checkbox"
            checked={security.sign}
            onChange={(e) => security.setSign(e.target.checked)}
            disabled={!props.composeMode || !props.engineReady}
          />{" "}
          Sign
        </label>
        <label>
          <input
            type="checkbox"
            checked={security.encrypt}
            onChange={(e) => security.setEncrypt(e.target.checked)}
            disabled={!props.composeMode || !props.engineReady}
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
          <p className="note">Add To/Cc/Bcc to look up keys on the pubkey directory.</p>
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
      </div>
      <p className="note">Directory: {pubkeyBase || "—"}</p>
    </section>
  );
}

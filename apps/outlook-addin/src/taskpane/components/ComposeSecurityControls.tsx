import { CryptoFamily } from "@scomm-office/crypto";
import { useCallback, useState } from "react";
import { OfficeSubmissionAdapter } from "@scomm-office/office";
import { captureComposeSnapshot } from "@scomm-office/message-core";
import { useHostContext } from "../../lib/host-context";
import {
  defaultSecurityPolicy,
  protectComposeSnapshot,
  type ComposeSecurityOptions,
} from "../../lib/mail-security-bridge";
import { restoreOfficeVault, type OfficePubkeySession } from "../../lib/pubkey-session";
import { resolvePubkeyReadBaseUrl } from "../../lib/settings";

export function useComposeSecurity(session: OfficePubkeySession | null, userEmail: string | undefined) {
  const { mailHost, message, refreshMessage, settings } = useHostContext();
  const [sign, setSign] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [protocol, setProtocol] = useState<"automatic" | CryptoFamily>("automatic");
  const [status, setStatus] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyProtection = useCallback(async () => {
    if (!session || !userEmail) return;
    setBusy(true);
    setStatus(null);
    setResolved(null);
    try {
      await restoreOfficeVault(session);
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
  }, [session, userEmail, message, mailHost, refreshMessage, sign, encrypt, protocol]);

  return {
    sign,
    setSign,
    encrypt,
    setEncrypt,
    protocol,
    setProtocol,
    status,
    resolved,
    busy,
    applyProtection,
  };
}

export function ComposeSecurityControls(props: {
  session: OfficePubkeySession | null;
  userEmail: string | undefined;
  engineReady: boolean;
  composeMode: boolean;
}) {
  const security = useComposeSecurity(props.session, props.userEmail);
  const pubkeyBase = resolvePubkeyReadBaseUrl(useHostContext().settings);

  return (
    <section>
      <h2>Message protection</h2>
      <p className="note">
        Standards-based OpenPGP/MIME (RFC 3156). S/MIME requires a native platform bridge.
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
              <option value={CryptoFamily.SMIME}>S/MIME</option>
            </select>
          </label>
        </details>
        <button
          type="button"
          className="primary"
          disabled={security.busy || !props.engineReady || !props.composeMode || (!security.sign && !security.encrypt)}
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

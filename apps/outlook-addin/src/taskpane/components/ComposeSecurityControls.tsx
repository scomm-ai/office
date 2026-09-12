import { CryptoFamily } from "@scomm-office/crypto";
import { useCallback, useEffect, useState } from "react";
import { Checkbox, Dropdown, Option, tokens } from "@fluentui/react-components";
import { Note, usePaneStyles } from "../ui/layout";
import { VaultBadge } from "../panels/vault/VaultBadge";
import { VaultHeading } from "../panels/vault/VaultHeading";
import { useVaultStyles } from "../panels/vault/styles";
import { useHostContext } from "../../lib/host-context";
import { loadComposeTogglesFromItem, saveComposeTogglesToItem } from "../../lib/compose-security-state";
import { lookupRecipientStatuses } from "../../lib/mail-crypto-actions";
import { PGP_ADDON_REQUIRED_MESSAGE } from "../../lib/billing-pgp";
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

const PROTOCOL_LABELS: Record<"automatic" | CryptoFamily, string> = {
  automatic: "Automatic",
  [CryptoFamily.OpenPGP]: "OpenPGP",
  [CryptoFamily.SMIME]: "S/MIME (native Outlook)",
};

export function ComposeSecurityControls(props: {
  session: OfficePubkeySession | null;
  userEmail: string | undefined;
  engineReady: boolean;
  composeMode: boolean;
  pgpEntitled: boolean;
}) {
  const security = useComposeSecurity(props.session, props.userEmail);
  const { settings, graphDiagnostics } = useHostContext();
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  const pubkeyBase = resolvePubkeyReadBaseUrl(settings);
  const paidReady = props.engineReady && props.pgpEntitled;
  const canUncheckSign = !props.pgpEntitled && security.sign;
  const canUncheckEncrypt = !props.pgpEntitled && security.encrypt;

  return (
    <section className={secStyles.screen}>
      <VaultHeading
        title="Message protection"
        description="Enable Encrypt and/or Sign, then use Outlook's Send. Classical OpenPGP keys come from the pubkey directory (local by default); S/MIME stays in native Outlook. Paid pgp add-on required."
      />
      <Note>
        Microsoft Graph send:{" "}
        {!graphDiagnostics.clientIdConfigured
          ? `not configured (${graphDiagnostics.error ?? "VITE_AZURE_CLIENT_ID not set"}) — Send will use inline OpenPGP in the compose body.`
          : graphDiagnostics.probedSuccessfully === true
            ? "connected — Send will try Graph first for a correct MIME envelope."
            : graphDiagnostics.probedSuccessfully === false
              ? `unavailable (${graphDiagnostics.error ?? "unknown reason"}) — Send will use inline OpenPGP in the compose body.`
              : "configured — Send uses silent Graph when a session exists, otherwise inline OpenPGP."}
      </Note>
      {!props.pgpEntitled ? <Note>{PGP_ADDON_REQUIRED_MESSAGE}</Note> : null}
      <div className={styles.stack}>
        <Checkbox
          label="Sign"
          checked={security.sign}
          onChange={(_, data) => security.setSign(Boolean(data.checked))}
          disabled={!props.engineReady || !props.composeMode || (!paidReady && !canUncheckSign)}
        />
        <Checkbox
          label="Encrypt"
          checked={security.encrypt}
          onChange={(_, data) => security.setEncrypt(Boolean(data.checked))}
          disabled={!props.engineReady || !props.composeMode || (!paidReady && !canUncheckEncrypt)}
        />
        {security.recipients.length > 0 ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {security.recipients.map((row) => {
              const tone = row.addInCanEncrypt ? "ok" : row.status === "missing" ? "warn" : "muted";
              const dotColor =
                tone === "ok"
                  ? tokens.colorPaletteGreenForeground1
                  : tone === "warn"
                    ? tokens.colorPaletteMarigoldForeground1
                    : tokens.colorNeutralForeground3;
              return (
                <li key={row.email} className={secStyles.toggleRow} style={{ alignItems: "flex-start" }}>
                  <span className={secStyles.statusDot} style={{ backgroundColor: dotColor, marginTop: "6px" }} />
                  <div className={secStyles.rowLabel} style={{ whiteSpace: "normal" }}>
                    <div style={{ fontWeight: tokens.fontWeightSemibold }}>{row.email}</div>
                    <Note>{row.hint}</Note>
                  </div>
                  <VaultBadge tone={tone}>{row.status === "found" ? row.family : row.status}</VaultBadge>
                </li>
              );
            })}
          </ul>
        ) : (
          <Note>Add To/Cc/Bcc to look up keys on the pubkey directory.</Note>
        )}
        <details>
          <summary>Advanced</summary>
          <div className={styles.fieldRow}>
            <Dropdown
              aria-label="Protocol"
              value={PROTOCOL_LABELS[security.protocol]}
              selectedOptions={[security.protocol]}
              disabled={!props.composeMode}
              onOptionSelect={(_, data) =>
                security.setProtocol(data.optionValue as "automatic" | CryptoFamily)
              }
            >
              <Option value="automatic">{PROTOCOL_LABELS.automatic}</Option>
              <Option value={CryptoFamily.OpenPGP}>{PROTOCOL_LABELS[CryptoFamily.OpenPGP]}</Option>
              <Option value={CryptoFamily.SMIME}>{PROTOCOL_LABELS[CryptoFamily.SMIME]}</Option>
            </Dropdown>
          </div>
        </details>
      </div>
      <Note>Directory: {pubkeyBase || "—"}</Note>
    </section>
  );
}

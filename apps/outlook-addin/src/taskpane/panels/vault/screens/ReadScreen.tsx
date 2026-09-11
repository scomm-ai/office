import { useCallback, useEffect, useRef, useState } from "react";
import { attachmentEncryptionNotice } from "@scomm-office/office";
import { extractPgpMessage, extractPgpSignedMessage } from "@scomm-office/pubkeys";
import { X_SCOMM_ENCRYPTION } from "@scomm-office/protocol";
import { useHostContext } from "../../../../lib/host-context";
import { decryptCurrentBody, verifyCurrentBody } from "../../../../lib/mail-crypto-actions";
import { PGP_ADDON_REQUIRED_MESSAGE } from "../../../../lib/billing-pgp";
import type { TaskPaneCryptoAction } from "../../../../lib/taskpane-launch";
import type { OfficePubkeySession } from "../../../../lib/pubkey-session";
import { Button, Note, PageTitle, StatusBadge, tokens, usePaneStyles } from "../../../ui/layout";
import type { UseVaultIdentityResult } from "../hooks/useVaultIdentity";
import { useVaultStyles } from "../styles";

/** Internet header names aren't guaranteed to preserve casing across hosts. */
function readHeaderValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

export function ReadScreen({
  session,
  identity,
  launchAction,
  onGoSetup,
}: {
  session: OfficePubkeySession | null;
  identity: UseVaultIdentityResult;
  launchAction: TaskPaneCryptoAction;
  onGoSetup: () => void;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  const { message, mailHost, capabilities, refreshMessage } = useHostContext();
  const [busy, setBusy] = useState(false);
  const [mailStatus, setMailStatus] = useState<string | null>(null);
  const [decryptedBody, setDecryptedBody] = useState<string | null>(null);
  const [autoDecryptLocked, setAutoDecryptLocked] = useState(false);
  const lastItemId = useRef<string | null>(null);
  const autoDecryptItemId = useRef<string | null>(null);
  const launchRan = useRef(false);

  const enrolled = identity.status === "verified";

  const handleDecrypt = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setMailStatus(null);
    setDecryptedBody(null);
    try {
      const result = await decryptCurrentBody({ session, mailHost });
      setDecryptedBody(result.plaintext);
      setMailStatus(result.note);
    } catch (err) {
      setMailStatus(`Decrypt failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [session, mailHost]);

  const handleVerify = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setMailStatus(null);
    try {
      setMailStatus(await verifyCurrentBody({ session, mailHost }));
    } catch (err) {
      setMailStatus(`Verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [session, mailHost]);

  useEffect(() => {
    void refreshMessage("security-read");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const nextId = message?.id ?? null;
    if (lastItemId.current && lastItemId.current !== nextId) {
      setDecryptedBody(null);
      setMailStatus(null);
    }
    lastItemId.current = nextId;
  }, [message?.id]);

  const encryptionHeaderPresent = Boolean(readHeaderValue(message?.headers, X_SCOMM_ENCRYPTION));
  const encryptedArmorPresent = Boolean(
    extractPgpMessage(message?.bodyText) ?? extractPgpMessage(message?.bodyHtml),
  );
  const signedArmorPresent = Boolean(
    extractPgpSignedMessage(message?.bodyText) ?? extractPgpSignedMessage(message?.bodyHtml),
  );
  const isEncryptedMessage = encryptionHeaderPresent || encryptedArmorPresent;
  const isSignedOnlyMessage = !isEncryptedMessage && signedArmorPresent;

  useEffect(() => {
    const nextId = message?.id ?? null;
    if (!nextId || !identity.engineReady) return;
    if (autoDecryptItemId.current === nextId) return;

    if (isEncryptedMessage) {
      if (session?.vault.unlocked) {
        autoDecryptItemId.current = nextId;
        setAutoDecryptLocked(false);
        void handleDecrypt();
      } else {
        autoDecryptItemId.current = nextId;
        setAutoDecryptLocked(true);
      }
    } else if (isSignedOnlyMessage) {
      autoDecryptItemId.current = nextId;
      setAutoDecryptLocked(false);
      void handleVerify();
    } else {
      autoDecryptItemId.current = nextId;
      setAutoDecryptLocked(false);
    }
  }, [message?.id, identity.engineReady, isEncryptedMessage, isSignedOnlyMessage, session, handleDecrypt, handleVerify]);

  useEffect(() => {
    if (launchRan.current || !launchAction || !identity.engineReady) return;
    launchRan.current = true;
    if (launchAction === "decrypt") void handleDecrypt();
    if (launchAction === "verify") void handleVerify();
  }, [launchAction, identity.engineReady, handleDecrypt, handleVerify]);

  const attachmentNotice = attachmentEncryptionNotice(capabilities);

  if (!enrolled) {
    return (
      <div className={styles.stack}>
        <PageTitle
          title="Set up your secure vault"
          description="You haven't set up encryption yet, so encrypted mail can't be opened here until you do."
        />
        <div className={styles.actions}>
          <Button appearance="primary" size="small" onClick={onGoSetup}>
            Set up your secure vault
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <div className={secStyles.row}>
        <span
          className={secStyles.statusDot}
          style={{ backgroundColor: decryptedBody ? tokens.colorPaletteGreenForeground1 : tokens.colorNeutralForeground3 }}
        />
        <PageTitle
          title={decryptedBody ? "Decrypted" : "Encrypted message"}
          description={
            decryptedBody
              ? "Only you can read this. It was encrypted to your key."
              : "Decrypt and verify stay in this pane so plaintext is not written back to the mailbox."
          }
        />
      </div>
      {!identity.pgpEntitled ? <Note>{PGP_ADDON_REQUIRED_MESSAGE}</Note> : null}
      {attachmentNotice ? <Note>{attachmentNotice}</Note> : null}
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy || !identity.engineReady} onClick={() => void handleDecrypt()}>
          Decrypt message
        </Button>
        <Button appearance="secondary" size="small" disabled={busy || !identity.engineReady} onClick={() => void handleVerify()}>
          Verify signature
        </Button>
      </div>
      {autoDecryptLocked && !decryptedBody ? (
        <Note>This message is encrypted — unlock your Vault to auto-decrypt it.</Note>
      ) : null}
      {mailStatus ? <Note>{mailStatus}</Note> : null}
      {decryptedBody ? (
        <div className={styles.stack}>
          <StatusBadge tone="ok">Decrypted here only — the message stays encrypted in your mailbox.</StatusBadge>
          <pre className={styles.code}>{decryptedBody}</pre>
        </div>
      ) : null}
    </div>
  );
}

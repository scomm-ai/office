import { useCallback, useEffect, useRef, useState } from "react";
import { attachmentEncryptionNotice } from "@scomm-office/office";
import { extractPgpMessage, extractPgpSignedMessage } from "@scomm-office/pubkeys";
import { X_SCOMM_ENCRYPTION } from "@scomm-office/protocol";
import { errorMessage } from "../../../../lib/error-message";
import { useHostContext } from "../../../../lib/host-context";
import { decryptCurrentBody, verifyCurrentBody } from "../../../../lib/mail-crypto-actions";
import type { TaskPaneCryptoAction } from "../../../../lib/taskpane-launch";
import type { OfficePubkeySession } from "../../../../lib/pubkey-session";
import type { UseVaultIdentityResult } from "./useVaultIdentity";

/** Internet header names aren't guaranteed to preserve casing across hosts. */
function readHeaderValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/**
 * Decrypt/verify state for the current message, lifted out of ReadScreen so
 * it can be shared: ReadScreen shows the read-only outcome (decrypted body,
 * or a plain "Encrypted message" state), while the manual Decrypt/Verify
 * controls and any failure text live in Settings > Overview. Both consume
 * the same instance (created once in VaultPanel) so decrypting from either
 * place updates both.
 */
export function useReadDecryption(
  session: OfficePubkeySession | null,
  identity: UseVaultIdentityResult,
  launchAction: TaskPaneCryptoAction,
) {
  const { message, mailHost, capabilities, refreshMessage } = useHostContext();
  const [busy, setBusy] = useState(false);
  const [mailStatus, setMailStatus] = useState<string | null>(null);
  const [decryptedBody, setDecryptedBody] = useState<string | null>(null);
  const [autoDecryptLocked, setAutoDecryptLocked] = useState(false);
  const lastItemId = useRef<string | null>(null);
  const autoDecryptItemId = useRef<string | null>(null);
  const launchRan = useRef(false);

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
      setMailStatus(`Decrypt failed: ${errorMessage(err)}`);
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
      setMailStatus(`Verify failed: ${errorMessage(err)}`);
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

  return {
    busy,
    mailStatus,
    decryptedBody,
    autoDecryptLocked,
    isEncryptedMessage,
    isSignedOnlyMessage,
    attachmentNotice,
    handleDecrypt,
    handleVerify,
  };
}

export type UseReadDecryptionResult = ReturnType<typeof useReadDecryption>;

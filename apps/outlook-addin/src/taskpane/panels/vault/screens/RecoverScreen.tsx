import { useState } from "react";
import { Button, Note, PageTitle, usePaneStyles } from "../../../ui/layout";
import { useVaultStyles } from "../styles";

/**
 * Recovery here is real email-OTP recovery (`beginIdentityRecovery` →
 * `replaceMasterSigningKey`), not a client-side recovery code — it issues a
 * brand-new identity key and does not restore keys/mail from before. The
 * "lost every device, no other path" case reuses the same call with a
 * stronger warning, since the backend has no separate destructive-reset API.
 */
export function RecoverScreen({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  const [confirmReset, setConfirmReset] = useState(false);
  const [understood, setUnderstood] = useState(false);

  if (!confirmReset) {
    return (
      <div className={styles.stack}>
        <PageTitle title="Recover your identity" />
        <Note>
          Recovery creates a new identity key and retires the previous one. It does not restore
          mail encrypted under your old key — that mail stays unreadable unless another device
          still has the old key.
        </Note>
        <div className={styles.actions}>
          <Button appearance="primary" size="small" disabled={busy} onClick={onConfirm}>
            Continue with recovery
          </Button>
          <Button appearance="secondary" size="small" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <Button appearance="transparent" size="small" disabled={busy} onClick={() => setConfirmReset(true)}>
          I don't have access to my email either
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <PageTitle
        title="You'll lose your old mail"
        description="Without email access, there is no way to recover this identity. Once you regain email access, recovery creates brand-new keys for this mailbox — encrypted messages you've already received will stay locked forever."
      />
      <div className={secStyles.dangerCard}>
        <span>This isn't reversible from here — email access is required to continue.</span>
      </div>
      <label className={styles.actions} style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />
        <span>I understand I'm giving up access to previously encrypted mail</span>
      </label>
      <Button appearance="primary" size="small" disabled={busy || !understood} onClick={onConfirm}>
        Continue with recovery
      </Button>
      <Button appearance="transparent" size="small" disabled={busy} onClick={() => setConfirmReset(false)}>
        Go back
      </Button>
    </div>
  );
}

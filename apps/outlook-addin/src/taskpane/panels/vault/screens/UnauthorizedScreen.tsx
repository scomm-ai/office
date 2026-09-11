import { Button, Note, PageTitle, tokens, usePaneStyles } from "../../../ui/layout";

/**
 * Case 2 of the two recovery paths: no recovery-code envelope exists on the
 * server for this identity, so the only way to bring the *existing* vault
 * onto this device is pairing with one that already has it. "I've lost my
 * recovery code too" is a low-emphasis fallback (not a co-equal option) —
 * it leads to email-OTP recovery, which creates a new identity rather than
 * restoring the old one.
 */
export function UnauthorizedScreen({
  busy,
  onTransfer,
  onRecover,
}: {
  busy: boolean;
  onTransfer: () => void;
  onRecover: () => void;
}) {
  const styles = usePaneStyles();
  return (
    <div className={styles.stack}>
      <PageTitle title="This mailbox already has an identity" />
      <Note>No recovery code is set up for it — approve this device from one you already have.</Note>
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy} onClick={onTransfer}>
          Recover from other devices
        </Button>
      </div>
      <Button
        appearance="transparent"
        size="small"
        disabled={busy}
        onClick={onRecover}
        style={{ alignSelf: "flex-start", color: tokens.colorNeutralForeground3, paddingLeft: 0 }}
      >
        I've lost my recovery code too
      </Button>
    </div>
  );
}

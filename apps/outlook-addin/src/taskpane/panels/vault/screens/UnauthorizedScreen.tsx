import { Button, Note, PageTitle, usePaneStyles } from "../../../ui/layout";

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
      <Note>To add this device normally, approve it from an existing device.</Note>
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy} onClick={onTransfer}>
          Approve from another device
        </Button>
        <Button appearance="secondary" size="small" disabled={busy} onClick={onRecover}>
          Recover identity
        </Button>
      </div>
    </div>
  );
}

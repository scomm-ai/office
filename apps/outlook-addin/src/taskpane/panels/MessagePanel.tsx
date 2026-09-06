import { Button, Note, PageTitle, StatusBadge, usePaneStyles } from "../ui/layout";
import { useHostContext } from "../../lib/host-context";
import { formatAddresses } from "../../lib/settings";

export function MessagePanel() {
  const styles = usePaneStyles();
  const { message, refreshMessage } = useHostContext();

  if (!message) {
    return <Note>No message loaded.</Note>;
  }

  return (
    <>
      <PageTitle title="Message" />
      <dl className={styles.metaGrid}>
        <dt className={styles.metaLabel}>Subject</dt>
        <dd>{message.subject ?? "—"}</dd>
        <dt className={styles.metaLabel}>From</dt>
        <dd>{formatAddresses(message.from ? [message.from] : undefined)}</dd>
        <dt className={styles.metaLabel}>To</dt>
        <dd>{formatAddresses(message.to)}</dd>
        <dt className={styles.metaLabel}>Mode</dt>
        <dd>
          <StatusBadge tone={message.mode === "compose" ? "warn" : "ok"}>{message.mode}</StatusBadge>
        </dd>
        <dt className={styles.metaLabel}>Attachments</dt>
        <dd>{message.attachments?.length ?? 0}</dd>
      </dl>
      <div className={styles.actions}>
        <Button appearance="secondary" size="small" onClick={() => void refreshMessage()}>
          Refresh
        </Button>
      </div>
    </>
  );
}

import { Button, PageTitle, StatusBadge, usePaneStyles } from "../../../ui/layout";

export function DoneScreen({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
}) {
  const styles = usePaneStyles();
  return (
    <div className={styles.stack}>
      <StatusBadge tone="ok">Done</StatusBadge>
      <PageTitle title={title} description={subtitle} />
      <div className={styles.actions}>
        <Button appearance="primary" size="small" onClick={onBack}>
          Back to mail
        </Button>
      </div>
    </div>
  );
}

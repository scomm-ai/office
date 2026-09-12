import { Button, usePaneStyles } from "../../../ui/layout";
import { VaultBadge } from "../VaultBadge";
import { VaultHeading } from "../VaultHeading";
import { useVaultStyles } from "../styles";

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
  const secStyles = useVaultStyles();
  return (
    <div className={secStyles.screen}>
      <div style={{ alignSelf: "flex-start" }}>
        <VaultBadge tone="ok">Done</VaultBadge>
      </div>
      <VaultHeading title={title} description={subtitle} />
      <div className={styles.stack}>
        <Button appearance="primary" size="large" className={secStyles.cta} onClick={onBack}>
          Back to mail
        </Button>
      </div>
    </div>
  );
}

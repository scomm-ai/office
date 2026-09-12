import { Text } from "@fluentui/react-components";
import { useVaultStyles } from "./styles";

/**
 * Vault-tab screen heading — a larger, higher-contrast title plus optional
 * supporting copy. Visual-only counterpart to the shared `PageTitle`, kept
 * local so its styling can't drift onto other task-pane tabs.
 */
export function VaultHeading({ title, description }: { title: string; description?: string }) {
  const styles = useVaultStyles();
  return (
    <div className={styles.heading}>
      <Text as="h2" block className={styles.headingTitle}>
        {title}
      </Text>
      {description ? (
        <Text block className={styles.headingDescription}>
          {description}
        </Text>
      ) : null}
    </div>
  );
}

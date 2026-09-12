import { useState } from "react";
import { Button, PageTitle, usePaneStyles } from "../../../ui/layout";
import { useVaultStyles } from "../styles";

/**
 * Reached only via "I've lost my recovery code too" (from either Case 1's
 * RecoveryCodeScreen or Case 2's UnauthorizedScreen). The only way forward
 * from here is a brand-new vault — one clear warning, one decision, not a
 * "continue with recovery" screen that just leads to another warning screen.
 */
export function ResetAttentionScreen({
  busy,
  onCreateNew,
  onGoBack,
}: {
  busy: boolean;
  onCreateNew: () => void;
  onGoBack: () => void;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  const [understood, setUnderstood] = useState(false);

  return (
    <div className={styles.stack}>
      <PageTitle
        title="You'll lose access to your old mail"
        description="Creating a new vault replaces your identity. Mail encrypted under your current keys becomes permanently unreadable — on this device and everywhere else. This cannot be undone."
      />
      <div className={secStyles.dangerCard}>
        <span>
          There is no way back from this once you continue. Make sure no other device and no
          recovery code can restore the old vault before you proceed.
        </span>
      </div>
      <label className={styles.actions} style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />
        <span>I understand I'm giving up access to previously encrypted mail</span>
      </label>
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy || !understood} onClick={onCreateNew}>
          Create new vault
        </Button>
        <Button appearance="secondary" size="small" disabled={busy} onClick={onGoBack}>
          Go back
        </Button>
      </div>
    </div>
  );
}

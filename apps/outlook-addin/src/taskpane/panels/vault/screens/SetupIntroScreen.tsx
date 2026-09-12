import { Button, Note, usePaneStyles } from "../../../ui/layout";
import { VaultHeading } from "../VaultHeading";
import { useVaultStyles } from "../styles";

export function SetupIntroScreen({
  userEmail,
  busy,
  onContinue,
  onHaveElsewhere,
  identityExists,
}: {
  userEmail: string | undefined;
  busy: boolean;
  onContinue: () => void;
  onHaveElsewhere: () => void;
  /** null while still checking — hide the "I already have an identity" option until we positively know it applies. */
  identityExists: boolean | null;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  return (
    <div className={secStyles.screen}>
      <VaultHeading
        title="Turn on encryption"
        description={
          userEmail
            ? `We'll create a private key for ${userEmail} and keep it in an encrypted vault only your devices can open.`
            : "We'll create a private key and keep it in an encrypted vault only your devices can open."
        }
      />
      <Note>Takes about a minute. Your existing mail is unaffected.</Note>
      <div className={styles.stack}>
        <Button appearance="primary" size="large" className={secStyles.cta} disabled={busy} onClick={onContinue}>
          Set up your secure vault
        </Button>
        {identityExists ? (
          <Button appearance="secondary" size="large" className={secStyles.cta} disabled={busy} onClick={onHaveElsewhere}>
            I already have an identity on another device
          </Button>
        ) : null}
      </div>
    </div>
  );
}

import { Button, Note, PageTitle, usePaneStyles } from "../../../ui/layout";

export function SetupIntroScreen({
  userEmail,
  busy,
  onContinue,
  onHaveElsewhere,
}: {
  userEmail: string | undefined;
  busy: boolean;
  onContinue: () => void;
  onHaveElsewhere: () => void;
}) {
  const styles = usePaneStyles();
  return (
    <div className={styles.stack}>
      <PageTitle
        title="Turn on encryption"
        description={
          userEmail
            ? `We'll create a private key for ${userEmail} and keep it in an encrypted vault only your devices can open.`
            : "We'll create a private key and keep it in an encrypted vault only your devices can open."
        }
      />
      <Note>Takes about a minute. Your existing mail is unaffected.</Note>
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy} onClick={onContinue}>
          Set up your secure vault
        </Button>
        <Button appearance="secondary" size="small" disabled={busy} onClick={onHaveElsewhere}>
          I already have an identity on another device
        </Button>
      </div>
    </div>
  );
}

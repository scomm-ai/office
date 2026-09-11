import { Button, Field, Input, Note, PageTitle, usePaneStyles } from "../../../ui/layout";
import { useVaultStyles } from "../styles";

export function OtpScreen({
  mode,
  userEmail,
  value,
  onChange,
  onSubmit,
  busy,
}: {
  mode: "enroll" | "recover";
  userEmail: string | undefined;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  const ready = value.replace(/[-\s]/g, "").length >= 11;
  return (
    <div className={styles.stack}>
      <PageTitle
        title="Enter the verification code"
        description={
          mode === "recover"
            ? `We emailed a code to ${userEmail ?? "your address"} to confirm it's really you before new keys are created.`
            : `Sent to ${userEmail ?? "your address"}. Paste the 11-character code to continue.`
        }
      />
      <Field label="Verification code">
        <Input
          maxLength={16}
          placeholder="11-character code"
          autoComplete="one-time-code"
          spellCheck={false}
          value={value}
          onChange={(_, data) => onChange(data.value)}
          className={secStyles.otpInput}
        />
      </Field>
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy || !ready} onClick={onSubmit}>
          Verify code
        </Button>
      </div>
      <Note>Didn't arrive? Check junk, or go back and resend.</Note>
    </div>
  );
}

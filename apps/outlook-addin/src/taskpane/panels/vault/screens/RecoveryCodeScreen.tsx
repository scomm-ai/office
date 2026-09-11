import { Button, Field, Input, Note, PageTitle, Textarea, tokens, usePaneStyles } from "../../../ui/layout";

/**
 * Case 1 of the two recovery paths: a recovery-code envelope exists on the
 * server for this identity, so the *existing* vault can be restored
 * directly (unlike email-OTP recovery, which mints a brand-new MSK and
 * cannot bring back old vault content). Matches secMail10's single-dialog
 * UX: one screen with both a "send code" action and the two fields needed
 * to redeem it.
 */
export function RecoveryCodeScreen({
  userEmail,
  otp,
  onOtpChange,
  onSendOtp,
  recoveryCode,
  onRecoveryCodeChange,
  onSubmit,
  busy,
  onLostCodeToo,
}: {
  userEmail: string | undefined;
  otp: string;
  onOtpChange: (value: string) => void;
  onSendOtp: () => void;
  recoveryCode: string;
  onRecoveryCodeChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  onLostCodeToo: () => void;
}) {
  const styles = usePaneStyles();
  const ready = otp.replace(/[-\s]/g, "").length >= 11 && recoveryCode.trim().length > 0;

  return (
    <div className={styles.stack}>
      <PageTitle
        title="Recover with your recovery code"
        description="This restores your existing vault, including everything encrypted under your current keys — unlike creating a new identity, which cannot bring old mail back."
      />
      <div className={styles.actions}>
        <Button appearance="secondary" size="small" disabled={busy} onClick={onSendOtp}>
          Send verification code
        </Button>
        <Note>Sent to {userEmail ?? "your address"} to confirm it's really you.</Note>
      </div>
      <Field label="Verification code">
        <Input
          maxLength={16}
          placeholder="11-character code"
          autoComplete="one-time-code"
          spellCheck={false}
          value={otp}
          onChange={(_, data) => onOtpChange(data.value)}
          style={{ fontFamily: tokens.fontFamilyMonospace }}
        />
      </Field>
      <Field label="Recovery code">
        <Textarea
          placeholder="The recovery code you saved when you set this up"
          spellCheck={false}
          value={recoveryCode}
          onChange={(_, data) => onRecoveryCodeChange(data.value)}
          rows={2}
          style={{ width: "100%", fontFamily: tokens.fontFamilyMonospace }}
        />
      </Field>
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy || !ready} onClick={onSubmit}>
          Recover vault
        </Button>
      </div>
      <Button
        appearance="transparent"
        size="small"
        disabled={busy}
        onClick={onLostCodeToo}
        style={{ alignSelf: "flex-start", color: tokens.colorNeutralForeground3, paddingLeft: 0 }}
      >
        I've lost my recovery code too
      </Button>
    </div>
  );
}

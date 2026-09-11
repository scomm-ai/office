import { useEffect, useRef, useState } from "react";
import { Note, usePaneStyles } from "../../../ui/layout";
import type { PgpKeyPurpose } from "../../../../lib/pubkey-session";
import type { UseVaultIdentityResult } from "../hooks/useVaultIdentity";
import { DoneScreen } from "./DoneScreen";
import { KeyPurposeScreen } from "./KeyPurposeScreen";
import { KeyTypeScreen } from "./KeyTypeScreen";
import { OtpScreen } from "./OtpScreen";
import { PairScreen } from "./PairScreen";
import { RecoverScreen } from "./RecoverScreen";
import { SetupIntroScreen } from "./SetupIntroScreen";
import { UnauthorizedScreen } from "./UnauthorizedScreen";

/**
 * Onboarding/recovery flow, driven directly by `useVaultIdentity`'s status —
 * that hook already is the state machine (idle → otp-sent → verified, or
 * unauthorized → transfer/recover), so this component just renders whichever
 * screen matches the current status instead of duplicating a second router.
 */
export function SetupFlowScreen({
  identity,
  userEmail,
  onDone,
}: {
  identity: UseVaultIdentityResult;
  userEmail: string | undefined;
  onDone: () => void;
}) {
  const styles = usePaneStyles();
  const [step, setStep] = useState<"intro" | "keytype" | "keypurpose">("intro");
  const [keyPurpose, setKeyPurpose] = useState<PgpKeyPurpose | null>(null);
  // null = not attempted / still publishing, true = succeeded, false = failed
  // (only false shows the "Publish again" retry link).
  const [publishOk, setPublishOk] = useState<boolean | null>(null);
  const publishAttempted = useRef(false);

  useEffect(() => {
    if (identity.status !== "idle") setStep("intro");
  }, [identity.status]);

  useEffect(() => {
    if (identity.status === "idle") {
      setKeyPurpose(null);
      setPublishOk(null);
      publishAttempted.current = false;
    }
  }, [identity.status]);

  // Setup isn't functionally complete until the chosen key purpose is
  // published — do it automatically once the identity itself is verified,
  // publishing only what the user selected (see KeyPurposeScreen), not both.
  useEffect(() => {
    if (identity.status !== "verified" || identity.busy) return;
    if (publishAttempted.current) return;
    publishAttempted.current = true;
    void identity.publishPgp(keyPurpose ? [keyPurpose] : undefined).then(setPublishOk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.status, identity.busy]);

  if (identity.status === "idle") {
    if (step === "keytype") {
      return (
        <KeyTypeScreen busy={identity.busy} onSelectOpenPgp={() => setStep("keypurpose")} />
      );
    }
    if (step === "keypurpose") {
      return (
        <KeyPurposeScreen
          busy={identity.busy}
          onSelect={(purpose) => {
            setKeyPurpose(purpose);
            void identity.requestOtp();
          }}
        />
      );
    }
    return (
      <div className={styles.stack}>
        <SetupIntroScreen
          userEmail={userEmail}
          busy={identity.busy}
          onContinue={() => setStep("keytype")}
          onHaveElsewhere={identity.goUnauthorized}
        />
        {identity.statusMessage ? <Note>{identity.statusMessage}</Note> : null}
      </div>
    );
  }

  if (identity.status === "unauthorized") {
    return (
      <div className={styles.stack}>
        <UnauthorizedScreen
          busy={identity.busy}
          onTransfer={() => void identity.beginTransfer()}
          onRecover={identity.goRecoverConfirm}
        />
        {identity.statusMessage ? <Note>{identity.statusMessage}</Note> : null}
      </div>
    );
  }

  if (identity.status === "otp-sent") {
    return (
      <div className={styles.stack}>
        <OtpScreen
          mode="enroll"
          userEmail={userEmail}
          value={identity.otpInput}
          onChange={identity.setOtpInput}
          onSubmit={() => void identity.verifyOtp()}
          busy={identity.busy}
        />
        {identity.statusMessage ? <Note>{identity.statusMessage}</Note> : null}
      </div>
    );
  }

  if (identity.status === "transfer") {
    return (
      <div className={styles.stack}>
        <PairScreen pairingCode={identity.pairingCode} />
        {identity.statusMessage ? <Note>{identity.statusMessage}</Note> : null}
      </div>
    );
  }

  if (identity.status === "recover") {
    return (
      <RecoverScreen
        busy={identity.busy}
        onConfirm={() => void identity.beginRecovery()}
        onCancel={identity.goUnauthorized}
      />
    );
  }

  if (identity.status === "recover-otp") {
    return (
      <div className={styles.stack}>
        <OtpScreen
          mode="recover"
          userEmail={userEmail}
          value={identity.otpInput}
          onChange={identity.setOtpInput}
          onSubmit={() => void identity.verifyRecovery()}
          busy={identity.busy}
        />
        {identity.statusMessage ? <Note>{identity.statusMessage}</Note> : null}
      </div>
    );
  }

  // verified
  const publishing = identity.busy && publishAttempted.current && publishOk === null;
  return (
    <div className={styles.stack}>
      <DoneScreen
        title={publishing ? "Almost done" : "Encryption is on"}
        subtitle={
          publishing
            ? "Publishing your key…"
            : keyPurpose
              ? `Your ${keyPurpose} key is published. New mail can use it right away.`
              : "New mail to this address can be encrypted, and you can read encrypted mail here."
        }
        onBack={onDone}
      />
      {publishOk === false ? (
        <Note>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void identity.publishPgp(keyPurpose ? [keyPurpose] : undefined).then(setPublishOk);
            }}
          >
            Publish again
          </a>
        </Note>
      ) : null}
      {identity.statusMessage ? <Note>{identity.statusMessage}</Note> : null}
    </div>
  );
}

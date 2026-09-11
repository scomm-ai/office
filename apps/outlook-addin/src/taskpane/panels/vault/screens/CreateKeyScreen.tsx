import { useState } from "react";
import { Note, usePaneStyles } from "../../../ui/layout";
import type { PgpKeyAlgorithm, PgpKeyPurpose } from "../../../../lib/pubkey-session";
import type { UseVaultIdentityResult } from "../hooks/useVaultIdentity";
import type { useVaultKeys } from "../hooks/useVaultKeys";
import { DoneScreen } from "./DoneScreen";
import { KeyPurposeScreen } from "./KeyPurposeScreen";
import { KeyTypeScreen } from "./KeyTypeScreen";

/**
 * "+ Create another key" from Settings → Keys, for an identity that's
 * already verified. Reuses the same KeyType/KeyPurpose screens as first-time
 * setup, but skips OTP entirely — the already-armed MSK signs the proof of
 * possession, no email verification needed to add a key.
 */
export function CreateKeyScreen({
  identity,
  keys,
  onDone,
}: {
  identity: UseVaultIdentityResult;
  keys: ReturnType<typeof useVaultKeys>;
  onDone: () => void;
}) {
  const styles = usePaneStyles();
  const [step, setStep] = useState<"keytype" | "keypurpose" | "publishing" | "done" | "error">("keytype");
  const [purpose, setPurpose] = useState<PgpKeyPurpose | null>(null);
  const [algorithm, setAlgorithm] = useState<PgpKeyAlgorithm>("openpgp-cv25519");

  const handleSelectPurpose = async (selected: PgpKeyPurpose) => {
    setPurpose(selected);
    setStep("publishing");
    const ok = await identity.publishPgp([selected], algorithm);
    keys.refreshTiles();
    setStep(ok ? "done" : "error");
  };

  if (step === "keytype") {
    return (
      <KeyTypeScreen
        busy={false}
        onSelectOpenPgp={() => {
          setAlgorithm("openpgp-cv25519");
          setStep("keypurpose");
        }}
        onSelectPqc={() => {
          setAlgorithm("openpgp-pqc");
          setStep("keypurpose");
        }}
      />
    );
  }

  if (step === "keypurpose") {
    return <KeyPurposeScreen busy={false} onSelect={(p) => void handleSelectPurpose(p)} />;
  }

  if (step === "publishing") {
    return (
      <div className={styles.stack}>
        <DoneScreen title="Creating your key" subtitle="This only takes a moment…" onBack={onDone} />
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className={styles.stack}>
        <DoneScreen
          title="Couldn't create that key"
          subtitle="Something went wrong publishing it to the directory. You can try again from Settings → Keys."
          onBack={onDone}
        />
        {identity.statusMessage ? <Note>{identity.statusMessage}</Note> : null}
      </div>
    );
  }

  return (
    <DoneScreen
      title="Key created"
      subtitle={
        purpose
          ? `Your ${purpose} key is published and ready to use.`
          : "Your key is published and ready to use."
      }
      onBack={onDone}
    />
  );
}

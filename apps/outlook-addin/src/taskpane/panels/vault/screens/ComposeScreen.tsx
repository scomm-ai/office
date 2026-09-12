import { useState } from "react";
import { ComposeSecurityControls } from "../../../components/ComposeSecurityControls";
import { Button, Note, usePaneStyles } from "../../../ui/layout";
import type { OfficePubkeySession } from "../../../../lib/pubkey-session";
import type { UseVaultIdentityResult } from "../hooks/useVaultIdentity";
import { VaultHeading } from "../VaultHeading";
import { useVaultStyles } from "../styles";

export function ComposeScreen({
  session,
  identity,
  userEmail,
  onGoSetup,
}: {
  session: OfficePubkeySession | null;
  identity: UseVaultIdentityResult;
  userEmail: string | undefined;
  onGoSetup: () => void;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  const enrolled = identity.status === "verified";
  const [skipped, setSkipped] = useState(false);

  if (!enrolled && !skipped) {
    return (
      <div className={secStyles.screen}>
        <VaultHeading
          title="Set up your secure vault"
          description="Turn on encryption so this message — and future ones — can only be read by your recipient."
        />
        <div className={styles.stack}>
          <Button appearance="primary" size="large" className={secStyles.cta} onClick={onGoSetup}>
            Set up your secure vault
          </Button>
          <Button appearance="secondary" size="large" className={secStyles.cta} onClick={() => setSkipped(true)}>
            Not now
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={secStyles.screen}>
      {!enrolled && skipped ? (
        <Note>
          You haven't set up your vault, so recipients won't be able to decrypt anything you send
          until you do.{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); onGoSetup(); }}>
            Set up now
          </a>
        </Note>
      ) : null}
      <ComposeSecurityControls
        session={session}
        userEmail={userEmail}
        engineReady={identity.engineReady}
        composeMode
        pgpEntitled={identity.pgpEntitled}
      />
    </div>
  );
}

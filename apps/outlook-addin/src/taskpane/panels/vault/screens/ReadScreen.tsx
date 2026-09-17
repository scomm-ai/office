import { Button, Note, tokens, usePaneStyles } from "../../../ui/layout";
import type { UseVaultIdentityResult } from "../hooks/useVaultIdentity";
import type { UseReadDecryptionResult } from "../hooks/useReadDecryption";
import { VaultHeading } from "../VaultHeading";
import { useVaultStyles } from "../styles";

export function ReadScreen({
  identity,
  decryption,
  onGoSetup,
}: {
  identity: UseVaultIdentityResult;
  decryption: UseReadDecryptionResult;
  onGoSetup: () => void;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  const enrolled = identity.status === "verified";
  const { decryptedBody, isEncryptedMessage, isSignedOnlyMessage } = decryption;

  if (!enrolled) {
    return (
      <div className={secStyles.screen}>
        <VaultHeading
          title="Set up your secure vault"
          description="You haven't set up encryption yet, so encrypted mail can't be opened here until you do."
        />
        <div className={styles.stack}>
          <Button appearance="primary" size="large" className={secStyles.cta} onClick={onGoSetup}>
            Set up your secure vault
          </Button>
        </div>
      </div>
    );
  }

  // Configured, but this particular message carries no OpenPGP armor at all -
  // show the plain state instead of an "Encrypted message" heading with
  // Decrypt/Verify buttons that would just error on a message that was never
  // protected in the first place.
  if (!isEncryptedMessage && !isSignedOnlyMessage) {
    return (
      <div className={secStyles.screen}>
        <div className={secStyles.row}>
          <span className={secStyles.statusDot} style={{ backgroundColor: tokens.colorNeutralForeground3 }} />
          <VaultHeading
            title="Not encrypted"
            description="This message wasn't protected with Scomm.AI. There's nothing to decrypt or verify here."
          />
        </div>
      </div>
    );
  }

  // Manual Decrypt/Verify controls and any failure text live in Settings >
  // Overview now - this screen only shows the read-only outcome (the
  // decrypted plaintext once available, from auto-decrypt or a manual
  // attempt made from Settings).
  return (
    <div className={secStyles.screen}>
      <div className={secStyles.row}>
        <span
          className={secStyles.statusDot}
          style={{ backgroundColor: decryptedBody ? tokens.colorPaletteGreenForeground1 : tokens.colorNeutralForeground3 }}
        />
        <VaultHeading
          title={decryptedBody ? "Decrypted" : "Encrypted message"}
          description={
            decryptedBody
              ? "Only you can read this. It was encrypted to your key."
              : "Open Settings to decrypt or verify this message."
          }
        />
      </div>
      {decryptedBody ? (
        <div className={styles.stack}>
          <Note>Decrypted here only — the message stays encrypted in your mailbox.</Note>
          <pre className={styles.code}>{decryptedBody}</pre>
        </div>
      ) : null}
    </div>
  );
}

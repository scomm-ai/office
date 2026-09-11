import { Note, PageTitle, usePaneStyles } from "../../../ui/layout";
import { useVaultStyles } from "../styles";
import type { PgpKeyPurpose } from "../../../../lib/pubkey-session";

export function KeyPurposeScreen({
  busy,
  onSelect,
}: {
  busy: boolean;
  onSelect: (purpose: PgpKeyPurpose) => void;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  return (
    <div className={styles.stack}>
      <PageTitle
        title="What's this key for?"
        description="Your vault can hold both. Create one now, and add the other later from Settings → Keys."
      />
      <div
        className={secStyles.optionCard}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        onClick={() => !busy && onSelect("encryption")}
        onKeyDown={(e) => {
          if (!busy && (e.key === "Enter" || e.key === " ")) onSelect("encryption");
        }}
      >
        <strong>Encryption key</strong>
        <Note>Lets others send you mail only you can read.</Note>
      </div>
      <div
        className={secStyles.optionCard}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        onClick={() => !busy && onSelect("signing")}
        onKeyDown={(e) => {
          if (!busy && (e.key === "Enter" || e.key === " ")) onSelect("signing");
        }}
      >
        <strong>Signing key</strong>
        <Note>Proves mail you send really came from you.</Note>
      </div>
    </div>
  );
}

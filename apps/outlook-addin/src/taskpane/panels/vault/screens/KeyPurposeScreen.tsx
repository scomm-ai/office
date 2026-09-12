import { Note } from "../../../ui/layout";
import { VaultHeading } from "../VaultHeading";
import { useVaultStyles } from "../styles";
import type { PgpKeyPurpose } from "../../../../lib/pubkey-session";

export function KeyPurposeScreen({
  busy,
  onSelect,
}: {
  busy: boolean;
  onSelect: (purpose: PgpKeyPurpose) => void;
}) {
  const secStyles = useVaultStyles();
  return (
    <div className={secStyles.screen}>
      <VaultHeading
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
        <span className={secStyles.optionCardTitle}>Encryption key</span>
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
        <span className={secStyles.optionCardTitle}>Signing key</span>
        <Note>Proves mail you send really came from you.</Note>
      </div>
    </div>
  );
}

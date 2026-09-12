import { Note } from "../../../ui/layout";
import { VaultHeading } from "../VaultHeading";
import { useVaultStyles } from "../styles";
import { mergeClasses } from "@fluentui/react-components";

export function KeyTypeScreen({ busy, onSelectOpenPgp }: { busy: boolean; onSelectOpenPgp: () => void }) {
  const secStyles = useVaultStyles();
  return (
    <div className={secStyles.screen}>
      <VaultHeading
        title="Choose your key type"
        description="Either option creates a signing key (proves mail is from you) and an encryption key (lets others send you private mail)."
      />
      <div
        className={secStyles.optionCard}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        onClick={() => !busy && onSelectOpenPgp()}
        onKeyDown={(e) => {
          if (!busy && (e.key === "Enter" || e.key === " ")) onSelectOpenPgp();
        }}
      >
        <span className={secStyles.optionCardTitle}>OpenPGP</span>
        <Note>Signing key + encryption key. Works with any OpenPGP-compatible mail client.</Note>
      </div>
      <div className={mergeClasses(secStyles.optionCard, secStyles.optionCardDisabled)} aria-disabled="true">
        <span className={secStyles.optionCardTitle}>OpenPGP PQC</span>
        <Note>Post-quantum signing and encryption keys. Coming soon — not yet supported.</Note>
      </div>
      <Note>You can change this later in Settings → Keys.</Note>
    </div>
  );
}

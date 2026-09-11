import { Note, PageTitle, usePaneStyles } from "../../../ui/layout";
import { useVaultStyles } from "../styles";
import { mergeClasses } from "@fluentui/react-components";

export function KeyTypeScreen({ busy, onSelectOpenPgp }: { busy: boolean; onSelectOpenPgp: () => void }) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  return (
    <div className={styles.stack}>
      <PageTitle
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
        <strong>OpenPGP</strong>
        <Note>Signing key + encryption key. Works with any OpenPGP-compatible mail client.</Note>
      </div>
      <div className={mergeClasses(secStyles.optionCard, secStyles.optionCardDisabled)} aria-disabled="true">
        <strong>OpenPGP PQC</strong>
        <Note>Post-quantum signing and encryption keys. Coming soon — not yet supported.</Note>
      </div>
      <Note>You can change this later in Settings → Keys.</Note>
    </div>
  );
}

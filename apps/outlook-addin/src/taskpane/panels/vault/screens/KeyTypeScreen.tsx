import { Note } from "../../../ui/layout";
import { VaultHeading } from "../VaultHeading";
import { OptionCard } from "../OptionCard";
import { useVaultStyles } from "../styles";

export function KeyTypeScreen({
  busy,
  onSelectOpenPgp,
  onSelectPqc,
}: {
  busy: boolean;
  onSelectOpenPgp: () => void;
  onSelectPqc: () => void;
}) {
  const secStyles = useVaultStyles();
  return (
    <div className={secStyles.screen}>
      <VaultHeading
        title="Choose your key type"
        description="Either option creates a signing key (proves mail is from you) and an encryption key (lets others send you private mail)."
      />
      <OptionCard
        title="OpenPGP"
        description="Signing key + encryption key. Works with any OpenPGP-compatible mail client."
        busy={busy}
        onSelect={onSelectOpenPgp}
      />
      <OptionCard
        title="OpenPGP PQC"
        description="Post-quantum signing and encryption keys (ML-DSA-65 + Ed25519, ML-KEM-768 + X25519). Only readable by PQC-aware OpenPGP clients."
        busy={busy}
        onSelect={onSelectPqc}
      />
      <Note>You can change this later in Settings → Keys.</Note>
    </div>
  );
}

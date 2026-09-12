import type { KeyboardEvent } from "react";
import { Note } from "../../../ui/layout";
import { VaultHeading } from "../VaultHeading";
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
  const optionProps = (onSelect: () => void) => ({
    className: secStyles.optionCard,
    role: "button" as const,
    tabIndex: busy ? -1 : 0,
    "aria-disabled": busy,
    onClick: () => !busy && onSelect(),
    onKeyDown: (e: KeyboardEvent) => {
      if (!busy && (e.key === "Enter" || e.key === " ")) onSelect();
    },
  });
  return (
    <div className={secStyles.screen}>
      <VaultHeading
        title="Choose your key type"
        description="Either option creates a signing key (proves mail is from you) and an encryption key (lets others send you private mail)."
      />
      <div {...optionProps(onSelectOpenPgp)}>
        <span className={secStyles.optionCardTitle}>OpenPGP</span>
        <Note>Signing key + encryption key. Works with any OpenPGP-compatible mail client.</Note>
      </div>
      <div {...optionProps(onSelectPqc)}>
        <span className={secStyles.optionCardTitle}>OpenPGP PQC</span>
        <Note>
          Post-quantum signing and encryption keys (ML-DSA-65 + Ed25519, ML-KEM-768 + X25519). Only
          readable by PQC-aware OpenPGP clients.
        </Note>
      </div>
      <Note>You can change this later in Settings → Keys.</Note>
    </div>
  );
}

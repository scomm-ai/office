import { VaultHeading } from "../VaultHeading";
import { OptionCard } from "../OptionCard";
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
      <OptionCard
        title="Encryption key"
        description="Lets others send you mail only you can read."
        busy={busy}
        onSelect={() => onSelect("encryption")}
      />
      <OptionCard
        title="Signing key"
        description="Proves mail you send really came from you."
        busy={busy}
        onSelect={() => onSelect("signing")}
      />
    </div>
  );
}

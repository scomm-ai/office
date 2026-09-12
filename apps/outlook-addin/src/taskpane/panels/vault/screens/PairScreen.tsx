import { Note, Textarea, tokens } from "../../../ui/layout";
import { VaultHeading } from "../VaultHeading";
import { useVaultStyles } from "../styles";

export function PairScreen({ pairingCode }: { pairingCode: string }) {
  const secStyles = useVaultStyles();
  return (
    <div className={secStyles.screen}>
      <VaultHeading
        title="Approve this device"
        description="Paste this pairing code into the Vault tab on a device you've already set up, under Settings → Devices → Approve a new device."
      />
      <Textarea
        readOnly
        value={pairingCode}
        rows={4}
        style={{ width: "100%", fontFamily: tokens.fontFamilyMonospace }}
      />
      <Note>Waiting for approval — this page updates automatically once approved.</Note>
    </div>
  );
}

import { Note, PageTitle, Textarea, usePaneStyles } from "../../../ui/layout";

export function PairScreen({ pairingCode }: { pairingCode: string }) {
  const styles = usePaneStyles();
  return (
    <div className={styles.stack}>
      <PageTitle
        title="Approve this device"
        description="Paste this pairing code into the Vault tab on a device you've already set up, under Settings → Devices → Approve a new device."
      />
      <Textarea readOnly value={pairingCode} rows={4} style={{ width: "100%" }} />
      <Note>Waiting for approval — this page updates automatically once approved.</Note>
    </div>
  );
}

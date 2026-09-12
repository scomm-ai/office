import { Button, Field, Input, Note, usePaneStyles } from "../../../ui/layout";
import { VaultHeading } from "../VaultHeading";
import { useVaultStyles } from "../styles";
import type { useVaultDevices } from "../hooks/useVaultDevices";

export function ApproveDeviceScreen({ devices }: { devices: ReturnType<typeof useVaultDevices> }) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  return (
    <div className={secStyles.screen}>
      <VaultHeading
        title="Approve a new device"
        description="Enter the pairing code shown on the other device. Approving syncs your vault there, so it can read your encrypted mail too."
      />
      <Field label="Pairing code">
        <Input
          value={devices.approveCode}
          onChange={(_, data) => devices.setApproveCode(data.value)}
          disabled={devices.approving}
          className={secStyles.otpInput}
          placeholder="Paste code"
        />
      </Field>
      <div className={styles.stack}>
        <Button
          appearance="primary"
          size="large"
          className={secStyles.cta}
          disabled={devices.approving || !devices.approveCode.trim()}
          onClick={() => void devices.approve()}
        >
          {devices.approving ? "Approving…" : "Approve device"}
        </Button>
      </div>
      <Note>Only approve a code you asked for. An approved device can read all your encrypted mail.</Note>
      {devices.note ? <Note>{devices.note}</Note> : null}
    </div>
  );
}

import { useEffect } from "react";
import { Button, Note, usePaneStyles } from "../../../ui/layout";
import { useVaultStyles } from "../styles";
import type { useVaultDevices } from "../hooks/useVaultDevices";

export function SettingsDevicesTab({
  devices,
  onApproveDevice,
}: {
  devices: ReturnType<typeof useVaultDevices>;
  onApproveDevice: () => void;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();

  useEffect(() => {
    void devices.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={secStyles.screen}>
      <div>
        {devices.devices.length === 0 ? (
          <Note>{devices.busy ? "Loading devices…" : "No authorized devices found."}</Note>
        ) : (
          devices.devices.map((device) => (
            <div key={device.deviceId} className={secStyles.toggleRow}>
              <div className={secStyles.rowLabel}>
                <div style={{ fontWeight: 600 }}>{device.name}</div>
                <Note>{device.active ? "Active" : "Revoked"}</Note>
              </div>
              <Button
                appearance="secondary"
                size="medium"
                className={secStyles.actionButton}
                disabled={devices.busy || !device.active}
                onClick={() => void devices.remove(device.deviceId)}
              >
                Remove
              </Button>
            </div>
          ))
        )}
      </div>
      <div className={styles.actions}>
        <Button appearance="secondary" size="medium" className={secStyles.actionButton} onClick={onApproveDevice}>
          Approve a new device
        </Button>
        <Button appearance="transparent" size="small" disabled={devices.busy} onClick={() => void devices.refresh()}>
          Refresh
        </Button>
      </div>
      <Note>Removing a device stops it from opening new mail after its next sync.</Note>
      {devices.note ? <Note>{devices.note}</Note> : null}
    </div>
  );
}

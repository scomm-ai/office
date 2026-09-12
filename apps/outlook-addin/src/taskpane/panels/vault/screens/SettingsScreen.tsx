import { useState } from "react";
import { useVaultStyles } from "../styles";
import type { UseVaultIdentityResult } from "../hooks/useVaultIdentity";
import type { useVaultDevices } from "../hooks/useVaultDevices";
import type { useVaultKeys } from "../hooks/useVaultKeys";
import type { useVaultBackup } from "../hooks/useVaultBackup";
import { SettingsDevicesTab } from "./SettingsDevicesTab";
import { SettingsKeysTab } from "./SettingsKeysTab";
import { SettingsStatusTab } from "./SettingsStatusTab";
import { tokens } from "@fluentui/react-components";

type SettingsTab = "status" | "devices" | "keys";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "status", label: "Status" },
  { id: "devices", label: "Devices" },
  { id: "keys", label: "Keys" },
];

export function SettingsScreen({
  identity,
  devices,
  keys,
  backup,
  directoryLabel,
  pubkeyBase,
  onApproveDevice,
  onCreateKey,
}: {
  identity: UseVaultIdentityResult;
  devices: ReturnType<typeof useVaultDevices>;
  keys: ReturnType<typeof useVaultKeys>;
  backup: ReturnType<typeof useVaultBackup>;
  directoryLabel: string;
  pubkeyBase: string;
  onApproveDevice: () => void;
  onCreateKey: () => void;
}) {
  const secStyles = useVaultStyles();
  const [tab, setTab] = useState<SettingsTab>("status");

  return (
    <div className={secStyles.screen}>
      <div className={secStyles.settingsTabs}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: `${tokens.spacingVerticalM} 2px`,
              marginBottom: "-1px",
              fontSize: tokens.fontSizeBase300,
              fontWeight: tokens.fontWeightSemibold,
              color: tab === entry.id ? tokens.colorNeutralForeground1 : tokens.colorNeutralForeground3,
              borderBottom: tab === entry.id ? `2px solid ${tokens.colorBrandStroke1}` : "2px solid transparent",
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "status" ? (
        <SettingsStatusTab
          identity={identity}
          directoryLabel={directoryLabel}
          pubkeyBase={pubkeyBase}
        />
      ) : null}
      {tab === "devices" ? <SettingsDevicesTab devices={devices} onApproveDevice={onApproveDevice} /> : null}
      {tab === "keys" ? <SettingsKeysTab keys={keys} backup={backup} onCreateKey={onCreateKey} /> : null}
    </div>
  );
}

import { Switch } from "@fluentui/react-components";
import type { ResolvedConfiguration } from "@scomm-office/protocol";
import { PageTitle, usePaneStyles } from "../ui/layout";
import { useHostContext } from "../../lib/host-context";

type BoolSetting = Extract<
  keyof ResolvedConfiguration,
  "semanticAnalysisEnabled" | "complianceEnabled" | "diagnosticsEnabled"
>;

const BOOL_SETTINGS: Array<{ key: BoolSetting; label: string }> = [
  { key: "semanticAnalysisEnabled", label: "Semantic analysis" },
  { key: "complianceEnabled", label: "Compliance checks" },
  { key: "diagnosticsEnabled", label: "Diagnostics panel" },
];

export function SettingsPanel() {
  const styles = usePaneStyles();
  const { settings, updateSettings } = useHostContext();

  return (
    <>
      <PageTitle title="Settings" />
      <div className={styles.stack}>
        {BOOL_SETTINGS.map(({ key, label }) => (
          <Switch
            key={key}
            label={label}
            checked={Boolean(settings[key])}
            onChange={(_, data) =>
              updateSettings({ [key]: data.checked } as Partial<ResolvedConfiguration>)
            }
          />
        ))}
      </div>
    </>
  );
}

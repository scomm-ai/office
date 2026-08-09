import type { ResolvedConfiguration } from "@scomm-office/protocol";
import { useHostContext } from "../../lib/host-context";

type BoolSetting = Extract<
  keyof ResolvedConfiguration,
  | "semanticAnalysisEnabled"
  | "complianceEnabled"
  | "experimentalEncryptionEnabled"
  | "diagnosticsEnabled"
>;

const BOOL_SETTINGS: Array<{ key: BoolSetting; label: string }> = [
  { key: "semanticAnalysisEnabled", label: "Semantic analysis" },
  { key: "complianceEnabled", label: "Compliance checks" },
  { key: "experimentalEncryptionEnabled", label: "Experimental encryption (info only)" },
  { key: "diagnosticsEnabled", label: "Diagnostics panel" },
];

export function SettingsPanel() {
  const { settings, updateSettings } = useHostContext();

  return (
    <section>
      <h2>Settings</h2>
      <p className="note">Stored in MemoryUserSettingsStore with localStorage persistence.</p>

      <div className="field">
        <label htmlFor="scomm-server">SComm server URL</label>
        <input
          id="scomm-server"
          type="url"
          value={settings.scommServerUrl ?? ""}
          onChange={(event) => updateSettings({ scommServerUrl: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="pubkey-server">Pubkey URL</label>
        <input
          id="pubkey-server"
          type="url"
          value={settings.pubkeyServerUrl ?? settings.scommServerUrl ?? ""}
          onChange={(event) => updateSettings({ pubkeyServerUrl: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="settings-idr-host">IDR host</label>
        <input
          id="settings-idr-host"
          type="text"
          value={settings.idrTargetHost ?? ""}
          onChange={(event) => updateSettings({ idrTargetHost: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="settings-idr-service">IDR service</label>
        <input
          id="settings-idr-service"
          type="text"
          value={settings.idrDefaultService ?? "ollama"}
          onChange={(event) => updateSettings({ idrDefaultService: event.target.value })}
        />
      </div>

      {BOOL_SETTINGS.map(({ key, label }) => (
        <div className="field-row" key={key}>
          <input
            id={key}
            type="checkbox"
            checked={Boolean(settings[key])}
            onChange={(event) => updateSettings({ [key]: event.target.checked } as Partial<ResolvedConfiguration>)}
          />
          <label htmlFor={key}>{label}</label>
        </div>
      ))}
    </section>
  );
}

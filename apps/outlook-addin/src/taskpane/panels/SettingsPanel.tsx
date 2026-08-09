import type { ResolvedConfiguration } from "@scomm-office/protocol";
import { useHostContext } from "../../lib/host-context";

type BoolSetting = Extract<
  keyof ResolvedConfiguration,
  | "semanticAnalysisEnabled"
  | "complianceEnabled"
  | "experimentalEncryptionEnabled"
  | "diagnosticsEnabled"
  | "requireAiAddonEntitlement"
>;

const BOOL_SETTINGS: Array<{ key: BoolSetting; label: string }> = [
  { key: "semanticAnalysisEnabled", label: "Semantic analysis" },
  { key: "complianceEnabled", label: "Compliance checks" },
  { key: "experimentalEncryptionEnabled", label: "Experimental encryption (info only)" },
  { key: "diagnosticsEnabled", label: "Diagnostics panel" },
  { key: "requireAiAddonEntitlement", label: "Require AI add-on entitlement" },
];

export function SettingsPanel() {
  const { settings, updateSettings } = useHostContext();

  return (
    <section>
      <h2>Settings</h2>
      <p className="note">
        Product paths use billing + pubkey hosts (no Office server). Fixture Fastify URL is optional.
      </p>

      <div className="field">
        <label htmlFor="billing-origin">Billing origin</label>
        <input
          id="billing-origin"
          type="url"
          placeholder="https://billing.example.com"
          value={settings.billingOrigin ?? ""}
          onChange={(event) => updateSettings({ billingOrigin: event.target.value || undefined })}
        />
      </div>
      <div className="field">
        <label htmlFor="billing-portal">Billing portal URL</label>
        <input
          id="billing-portal"
          type="url"
          placeholder="defaults to billing origin"
          value={settings.billingPortalUrl ?? ""}
          onChange={(event) => updateSettings({ billingPortalUrl: event.target.value || undefined })}
        />
      </div>
      <div className="field">
        <label htmlFor="pubkey-read">Pubkey read base URL</label>
        <input
          id="pubkey-read"
          type="url"
          placeholder="https://pubkey.example.com"
          value={settings.pubkeyReadBaseUrl ?? settings.pubkeyServerUrl ?? ""}
          onChange={(event) => updateSettings({ pubkeyReadBaseUrl: event.target.value || undefined })}
        />
      </div>
      <div className="field">
        <label htmlFor="pubkey-write">Pubkey write base URL</label>
        <input
          id="pubkey-write"
          type="url"
          placeholder="https://api.pubkey.example.com"
          value={settings.pubkeyWriteBaseUrl ?? ""}
          onChange={(event) => updateSettings({ pubkeyWriteBaseUrl: event.target.value || undefined })}
        />
      </div>
      <div className="field">
        <label htmlFor="scomm-server">Fixture server URL (optional)</label>
        <input
          id="scomm-server"
          type="url"
          placeholder="http://localhost:8787 — fixture only"
          value={settings.scommServerUrl ?? ""}
          onChange={(event) => updateSettings({ scommServerUrl: event.target.value || undefined })}
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
            onChange={(event) =>
              updateSettings({ [key]: event.target.checked } as Partial<ResolvedConfiguration>)
            }
          />
          <label htmlFor={key}>{label}</label>
        </div>
      ))}
    </section>
  );
}

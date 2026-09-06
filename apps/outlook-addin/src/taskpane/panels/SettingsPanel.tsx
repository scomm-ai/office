import { Switch } from "@fluentui/react-components";
import type { ResolvedConfiguration } from "@scomm-office/protocol";
import { Field, Input, Note, PageTitle, usePaneStyles } from "../ui/layout";
import { useHostContext } from "../../lib/host-context";
import { DEFAULT_SETTINGS } from "../../lib/settings";

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
  { key: "experimentalEncryptionEnabled", label: "Experimental ECDH envelope (Security pane)" },
  { key: "diagnosticsEnabled", label: "Diagnostics panel" },
  { key: "requireAiAddonEntitlement", label: "Require AI add-on entitlement" },
];

export function SettingsPanel() {
  const styles = usePaneStyles();
  const { settings, updateSettings } = useHostContext();

  return (
    <>
      <PageTitle
        title="Settings"
        description="Product paths use billing + pubkey hosts (no Office server). Fixture Fastify URL is optional."
      />
      <Note>
        Outlook sign-in requires an HTTPS billing origin. http://localhost:3000 cannot open the
        Office dialog (error 12005). Use https://billing.scomm.ai or serve billing over TLS.
      </Note>
      <Note>
        After changing VITE_PUBKEY_READ_BASE_URL or VITE_PUBKEY_WRITE_BASE_URL, restart the add-in
        Vite server. On localhost the pane calls /pubkey-read and /pubkey-write (HTTPS cannot talk
        to http://localhost:3030 directly); those proxies use the .env URLs.
      </Note>
      <Field label="Billing origin">
        <Input
          type="url"
          placeholder={DEFAULT_SETTINGS.billingOrigin ?? "https://billing.scomm.ai"}
          value={settings.billingOrigin ?? ""}
          onChange={(_, data) => updateSettings({ billingOrigin: data.value || undefined })}
        />
      </Field>
      <Field label="Billing portal URL">
        <Input
          type="url"
          placeholder="used by Open billing portal"
          value={settings.billingPortalUrl ?? ""}
          onChange={(_, data) => updateSettings({ billingPortalUrl: data.value || undefined })}
        />
      </Field>
      <Field label="Pubkey read base URL">
        <Input
          type="url"
          placeholder="https://pubkey.example.com"
          value={settings.pubkeyReadBaseUrl ?? settings.pubkeyServerUrl ?? ""}
          onChange={(_, data) => updateSettings({ pubkeyReadBaseUrl: data.value || undefined })}
        />
      </Field>
      <Field label="Pubkey write base URL">
        <Input
          type="url"
          placeholder="https://pubkey.scomm.ai"
          value={settings.pubkeyWriteBaseUrl ?? ""}
          onChange={(_, data) => updateSettings({ pubkeyWriteBaseUrl: data.value || undefined })}
        />
      </Field>
      <Field label="Fixture server URL (optional)">
        <Input
          type="url"
          placeholder="http://localhost:8787 — fixture only"
          value={settings.scommServerUrl ?? ""}
          onChange={(_, data) => updateSettings({ scommServerUrl: data.value || undefined })}
        />
      </Field>
      <Field label="IDR host">
        <Input
          value={settings.idrTargetHost ?? ""}
          onChange={(_, data) => updateSettings({ idrTargetHost: data.value })}
        />
      </Field>
      <Field label="IDR service">
        <Input
          value={settings.idrDefaultService ?? "ollama"}
          onChange={(_, data) => updateSettings({ idrDefaultService: data.value })}
        />
      </Field>
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

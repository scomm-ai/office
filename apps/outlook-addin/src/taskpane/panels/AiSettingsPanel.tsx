import { useEffect, useMemo, useState } from "react";
import {
  createCloudProfile,
  displayNameForProvider,
  LocalStorageCloudAiKeyStore,
  CloudAiClient,
  type CloudAiProfile,
  type CloudAiProviderKind,
} from "@scomm-office/byoai";
import { BILLING_ADDON_AI_ASSISTANT } from "../../lib/billing-catalog";
import { createOfficeBillingClient } from "../../lib/billing-client";
import { useHostContext } from "../../lib/host-context";
import { Dropdown, Option, Switch } from "@fluentui/react-components";
import { Button, Field, Input, Note, PageTitle, usePaneStyles } from "../ui/layout";

const BYOAI_PROFILES_KEY = "scomm-office.byoai.profiles.v1";
const ACCOUNT_KEY = "default";

function loadProfiles(): CloudAiProfile[] {
  try {
    const raw = localStorage.getItem(BYOAI_PROFILES_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as CloudAiProfile[];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: CloudAiProfile[]): void {
  localStorage.setItem(BYOAI_PROFILES_KEY, JSON.stringify(profiles));
}

export function AiSettingsPanel() {
  const styles = usePaneStyles();
  const { settings, updateSettings } = useHostContext();
  const [profiles, setProfiles] = useState<CloudAiProfile[]>(() => loadProfiles());
  const [draftApiKey, setDraftApiKey] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(profiles[0]?.id ?? null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entitled, setEntitled] = useState(false);

  const keyStore = useMemo(() => new LocalStorageCloudAiKeyStore(), []);
  const cloudClient = useMemo(() => new CloudAiClient(keyStore), [keyStore]);
  const billingOrigin = settings.billingOrigin?.trim() ?? "";
  const billing = useMemo(
    () => (billingOrigin ? createOfficeBillingClient(billingOrigin) : null),
    [billingOrigin],
  );

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const requireEntitlement = settings.requireAiAddonEntitlement !== false;

  useEffect(() => {
    if (!billing) {
      setEntitled(false);
      return;
    }
    void billing.restore(ACCOUNT_KEY).then(() => {
      try {
        const e = billing.entitlements();
        setEntitled(
          e.hasAddon(BILLING_ADDON_AI_ASSISTANT) || e.hasOffering(BILLING_ADDON_AI_ASSISTANT),
        );
      } catch {
        setEntitled(false);
      }
    });
  }, [billing]);

  const persist = (next: CloudAiProfile[]) => {
    setProfiles(next);
    saveProfiles(next);
  };

  const addProfile = (provider: CloudAiProviderKind) => {
    const profile = createCloudProfile({
      provider,
      isDefault: profiles.length === 0,
    });
    const next = [...profiles, profile];
    persist(next);
    setSelectedId(profile.id);
  };

  const updateSelected = (patch: Partial<CloudAiProfile>) => {
    if (!selected) {
      return;
    }
    const next = profiles.map((p) => (p.id === selected.id ? { ...p, ...patch } : p));
    if (patch.isDefault) {
      for (const p of next) {
        p.isDefault = p.id === selected.id;
      }
    }
    persist(next);
  };

  const saveKey = async () => {
    if (!selected || !draftApiKey.trim()) {
      return;
    }
    await keyStore.writeApiKey(selected.id, draftApiKey.trim());
    updateSelected({ hasApiKey: true });
    setDraftApiKey("");
    setStatus("API key saved locally in this WebView only.");
  };

  const testCloud = async () => {
    if (!selected) {
      return;
    }
    if (requireEntitlement && !entitled) {
      setStatus(`Requires billing add-on "${BILLING_ADDON_AI_ASSISTANT}". Sync Account & Billing first.`);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      if (billing) {
        await billing.restore(ACCOUNT_KEY);
      }
      const ok = await cloudClient.testConnection(selected, draftApiKey || undefined);
      setStatus(ok ? "Cloud provider reachable." : "Could not connect (check key / URL).");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle
        title="AI — Local (IDR) & Cloud (BYOAI)"
        description="Local AI uses the third-party IDR browser SDK (see AI / IDR). Cloud BYOAI sends requests from this WebView to your provider with your API key — keys never go to an Office server."
      />
      <Switch
        label="Require AI add-on entitlement"
        checked={requireEntitlement}
        onChange={(_, data) => updateSettings({ requireAiAddonEntitlement: data.checked })}
      />
      <Note>Entitlement status: {entitled ? "ai_assistant active" : "not entitled (or not synced)"}</Note>

      <PageTitle title="Local (IDR / Ollama)" description="Connect and list models on the AI / IDR panel." />
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

      <PageTitle title="Cloud (BYOAI)" />
      <div className={styles.actions}>
        <Button appearance="secondary" size="small" onClick={() => addProfile("openai")}>
          Add OpenAI
        </Button>
        <Button appearance="secondary" size="small" onClick={() => addProfile("openai_compatible")}>
          Add custom compatible
        </Button>
      </div>

      {profiles.length === 0 ? (
        <Note>No cloud providers yet.</Note>
      ) : (
        <ul className={styles.list}>
          {profiles.map((profile) => (
            <li key={profile.id}>
              <Button
                appearance={profile.id === selectedId ? "primary" : "secondary"}
                size="small"
                onClick={() => setSelectedId(profile.id)}
              >
                {profile.name}
                {profile.isDefault ? " (default)" : ""}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <>
          <Field label="Provider">
            <Dropdown
              value={displayNameForProvider(selected.provider)}
              selectedOptions={[selected.provider]}
              onOptionSelect={(_, data) => {
                const provider = (data.optionValue ?? selected.provider) as CloudAiProviderKind;
                updateSelected({
                  provider,
                  name: displayNameForProvider(provider),
                  baseUrl: selected.baseUrl || undefined,
                });
              }}
            >
              <Option value="openai">OpenAI</Option>
              <Option value="openai_compatible">Custom</Option>
            </Dropdown>
          </Field>
          <Field label="Base URL">
            <Input
              type="url"
              value={selected.baseUrl}
              onChange={(_, data) => updateSelected({ baseUrl: data.value })}
            />
          </Field>
          <Field label="Model">
            <Input value={selected.model} onChange={(_, data) => updateSelected({ model: data.value })} />
          </Field>
          <Field label="API key">
            <Input
              type="password"
              placeholder={selected.hasApiKey ? "(saved — enter to replace)" : "sk-…"}
              value={draftApiKey}
              onChange={(_, data) => setDraftApiKey(data.value)}
            />
          </Field>
          <div className={styles.actions}>
            <Button appearance="secondary" size="small" disabled={busy} onClick={() => void saveKey()}>
              Save key
            </Button>
            <Button appearance="primary" size="small" disabled={busy} onClick={() => void testCloud()}>
              Test connection
            </Button>
            <Button appearance="secondary" size="small" onClick={() => updateSelected({ isDefault: true })}>
              Use as default
            </Button>
          </div>
        </>
      ) : null}

      {status ? <Note>{status}</Note> : null}
    </>
  );
}

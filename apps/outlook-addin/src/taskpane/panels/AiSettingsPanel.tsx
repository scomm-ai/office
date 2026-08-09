import { useMemo, useState } from "react";
import {
  createCloudProfile,
  displayNameForProvider,
  LocalStorageCloudAiKeyStore,
  CloudAiClient,
  type CloudAiProfile,
  type CloudAiProviderKind,
} from "@scomm-office/byoai";
import {
  BILLING_ADDON_AI_ASSISTANT,
  BillingSdk,
  LocalStorageBillingSessionStore,
  BillingSession,
} from "@scomm-office/billing";
import { useHostContext } from "../../lib/host-context";

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
  const { settings, updateSettings } = useHostContext();
  const [profiles, setProfiles] = useState<CloudAiProfile[]>(() => loadProfiles());
  const [draftApiKey, setDraftApiKey] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(profiles[0]?.id ?? null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const keyStore = useMemo(() => new LocalStorageCloudAiKeyStore(), []);
  const cloudClient = useMemo(() => new CloudAiClient(keyStore), [keyStore]);
  const billingSession = useMemo(
    () => new BillingSession(new LocalStorageBillingSessionStore()),
    [],
  );

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const entitled = BillingSdk.hasAddon(BILLING_ADDON_AI_ASSISTANT);
  const requireEntitlement = settings.requireAiAddonEntitlement !== false;

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
      await billingSession.initForAccount(ACCOUNT_KEY);
      const ok = await cloudClient.testConnection(selected, draftApiKey || undefined);
      setStatus(ok ? "Cloud provider reachable." : "Could not connect (check key / URL).");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>AI — Local (IDR) & Cloud (BYOAI)</h2>
      <p className="note">
        Local AI uses the third-party IDR browser SDK (see AI / IDR). Cloud BYOAI sends requests from
        this WebView to your provider with your API key — keys never go to an Office server.
      </p>

      <div className="field-row">
        <input
          id="require-ai-addon"
          type="checkbox"
          checked={requireEntitlement}
          onChange={(event) =>
            updateSettings({ requireAiAddonEntitlement: event.target.checked })
          }
        />
        <label htmlFor="require-ai-addon">Require AI add-on entitlement</label>
      </div>
      <p className="note">
        Entitlement status: {entitled ? "ai_assistant active" : "not entitled (or not synced)"}
      </p>

      <section>
        <h2>Local (IDR / Ollama)</h2>
        <div className="field">
          <label htmlFor="ai-idr-host">IDR host</label>
          <input
            id="ai-idr-host"
            type="text"
            value={settings.idrTargetHost ?? ""}
            onChange={(event) => updateSettings({ idrTargetHost: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="ai-idr-service">IDR service</label>
          <input
            id="ai-idr-service"
            type="text"
            value={settings.idrDefaultService ?? "ollama"}
            onChange={(event) => updateSettings({ idrDefaultService: event.target.value })}
          />
        </div>
        <p className="note">Connect and list models on the AI / IDR panel.</p>
      </section>

      <section>
        <h2>Cloud (BYOAI)</h2>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => addProfile("openai")}>
            Add OpenAI
          </button>
          <button type="button" className="secondary" onClick={() => addProfile("openai_compatible")}>
            Add custom compatible
          </button>
        </div>

        {profiles.length === 0 ? (
          <p className="empty">No cloud providers yet.</p>
        ) : (
          <ul className="list-plain">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <button
                  type="button"
                  className={profile.id === selectedId ? "primary" : "secondary"}
                  onClick={() => setSelectedId(profile.id)}
                >
                  {profile.name}
                  {profile.isDefault ? " (default)" : ""}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected ? (
          <>
            <div className="field">
              <label htmlFor="cloud-provider">Provider</label>
              <select
                id="cloud-provider"
                value={selected.provider}
                onChange={(event) => {
                  const provider = event.target.value as CloudAiProviderKind;
                  updateSelected({
                    provider,
                    name: displayNameForProvider(provider),
                    baseUrl: selected.baseUrl || undefined,
                  });
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="openai_compatible">Custom</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cloud-base">Base URL</label>
              <input
                id="cloud-base"
                type="url"
                value={selected.baseUrl}
                onChange={(event) => updateSelected({ baseUrl: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="cloud-model">Model</label>
              <input
                id="cloud-model"
                type="text"
                value={selected.model}
                onChange={(event) => updateSelected({ model: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="cloud-key">API key</label>
              <input
                id="cloud-key"
                type="password"
                placeholder={selected.hasApiKey ? "(saved — enter to replace)" : "sk-…"}
                value={draftApiKey}
                onChange={(event) => setDraftApiKey(event.target.value)}
              />
            </div>
            <div className="actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => void saveKey()}>
                Save key
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void testCloud()}>
                Test connection
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => updateSelected({ isDefault: true })}
              >
                Use as default
              </button>
            </div>
          </>
        ) : null}
      </section>

      {status ? <p className="note">{status}</p> : null}
    </section>
  );
}

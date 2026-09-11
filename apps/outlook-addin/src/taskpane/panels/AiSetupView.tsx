import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCloudProfile,
  defaultBaseUrlForProvider,
  displayNameForProvider,
  isLocalProvider,
  LocalStorageCloudAiKeyStore,
  CloudAiClient,
  type CloudAiProfile,
  type CloudAiProviderKind,
} from "@scomm-office/byoai";
import { BILLING_ADDON_AI_ASSISTANT, licenseGrantsFeature } from "../../lib/billing-catalog";
import { createOfficeBillingClient } from "../../lib/billing-client";
import { useHostContext } from "../../lib/host-context";
import { Dropdown, Option, OptionGroup } from "@fluentui/react-components";
import { Button, Field, Input, Note, PageTitle, Text, usePaneStyles } from "../ui/layout";
import { findDuplicateProfile, isProfileReady, loadProfiles, saveProfiles } from "../../lib/byoai-profiles";
import { useAppToast } from "../ui/toast";

const LOCAL_CONNECT_HINT =
  "Could not connect. Make sure the local server is running, the base URL is correct, and (for LM Studio) CORS is enabled in its Local Server settings.";

const ACCOUNT_KEY = "default";
const LOCAL_PROVIDERS: readonly ["ollama", "lmstudio"] = ["ollama", "lmstudio"];
const PROBE_TIMEOUT_MS = 1200;

type LocalProviderKind = (typeof LOCAL_PROVIDERS)[number];

interface DetectionState {
  probing: boolean;
  running: boolean;
  models: string[];
}

interface Draft {
  provider: CloudAiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  detectedModels: string[];
}

function defaultModelForProvider(provider: CloudAiProviderKind): string {
  switch (provider) {
    case "ollama":
      return "llama3.1";
    case "lmstudio":
      return "local-model";
    default:
      return "gpt-4o-mini";
  }
}

export function AiSetupView({ onReady }: { onReady: (profiles: CloudAiProfile[]) => void }) {
  const styles = usePaneStyles();
  const toast = useAppToast();
  const { settings } = useHostContext();
  const [profiles, setProfiles] = useState<CloudAiProfile[]>(() => loadProfiles());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editDraftApiKey, setEditDraftApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [entitled, setEntitled] = useState(false);
  const [detection, setDetection] = useState<Record<LocalProviderKind, DetectionState>>({
    ollama: { probing: true, running: false, models: [] },
    lmstudio: { probing: true, running: false, models: [] },
  });
  const [pickerValue, setPickerValue] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fetchingDraftModels, setFetchingDraftModels] = useState(false);
  const [editModels, setEditModels] = useState<string[]>([]);
  const [fetchingEditModels, setFetchingEditModels] = useState(false);
  const addInFlightRef = useRef(false);

  const keyStore = useMemo(() => new LocalStorageCloudAiKeyStore(), []);
  const cloudClient = useMemo(() => new CloudAiClient(keyStore), [keyStore]);
  const billingOrigin = settings.billingOrigin?.trim() ?? "";
  const billing = useMemo(
    () => (billingOrigin ? createOfficeBillingClient(billingOrigin) : null),
    [billingOrigin],
  );

  const selected = profiles.find((p) => p.id === selectedId) ?? null;
  const selectedIsLocal = selected ? isLocalProvider(selected.provider) : false;
  const requireEntitlement = settings.requireAiAddonEntitlement !== false;
  const externalProfiles = profiles.filter((p) => !isLocalProvider(p.provider));
  const localProfiles = profiles.filter((p) => isLocalProvider(p.provider));

  useEffect(() => {
    if (!billing) {
      setEntitled(false);
      return;
    }
    void billing.restore(ACCOUNT_KEY).then(() => {
      try {
        const snap = billing.normalizedEntitlements();
        setEntitled(licenseGrantsFeature(snap.products, BILLING_ADDON_AI_ASSISTANT));
      } catch {
        setEntitled(false);
      }
    });
  }, [billing]);

  // Best-effort probe for a locally running Ollama / LM Studio server so the
  // picker can surface it as "already running" instead of making the user
  // guess. Silent on failure — most people won't have either running.
  useEffect(() => {
    let cancelled = false;
    for (const provider of LOCAL_PROVIDERS) {
      const probeProfile: CloudAiProfile = {
        id: `probe-${provider}`,
        name: "",
        provider,
        baseUrl: defaultBaseUrlForProvider(provider),
        model: "",
        hasApiKey: false,
        isDefault: false,
      };
      cloudClient
        .listModels(probeProfile, { timeoutMs: PROBE_TIMEOUT_MS })
        .then((models) => {
          if (!cancelled) {
            setDetection((prev) => ({ ...prev, [provider]: { probing: false, running: true, models } }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDetection((prev) => ({ ...prev, [provider]: { probing: false, running: false, models: [] } }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
    // Probe once on mount only — cloudClient is stable across renders (useMemo).
  }, []);

  const persist = (next: CloudAiProfile[]) => {
    setProfiles(next);
    saveProfiles(next);
  };

  const pickProvider = (value: string) => {
    setPickerValue(value);
    if (value.startsWith("detected:")) {
      const provider = value.slice("detected:".length) as LocalProviderKind;
      const models = detection[provider]?.models ?? [];
      setDraft({
        provider,
        baseUrl: defaultBaseUrlForProvider(provider),
        model: models[0] ?? defaultModelForProvider(provider),
        apiKey: "",
        detectedModels: models,
      });
      return;
    }
    const provider = value as CloudAiProviderKind;
    const models = isLocalProvider(provider) ? detection[provider as LocalProviderKind]?.models ?? [] : [];
    setDraft({
      provider,
      baseUrl: defaultBaseUrlForProvider(provider),
      model: models[0] ?? defaultModelForProvider(provider),
      apiKey: "",
      detectedModels: models,
    });
  };

  const cancelDraft = () => {
    setDraft(null);
    setPickerValue("");
  };

  /**
   * Works for any OpenAI-compatible provider (OpenAI, Groq, OpenRouter, a
   * self-hosted proxy, etc.) since they all serve the same `/models` shape —
   * nothing here is provider-specific.
   */
  const fetchDraftModels = async () => {
    if (!draft || !draft.baseUrl.trim()) {
      return;
    }
    setFetchingDraftModels(true);
    try {
      const probeProfile: CloudAiProfile = {
        id: "draft-probe",
        name: "",
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        model: draft.model,
        hasApiKey: false,
        isDefault: false,
      };
      const models = await cloudClient.listModels(probeProfile, {
        apiKeyOverride: draft.apiKey || undefined,
        timeoutMs: 8000,
      });
      if (models.length === 0) {
        toast.showWarning("Connected, but the provider returned no models.");
      }
      setDraft((prev) =>
        prev
          ? { ...prev, detectedModels: models, model: models.includes(prev.model) ? prev.model : (models[0] ?? prev.model) }
          : prev,
      );
    } catch (error) {
      toast.showError(error instanceof Error ? error.message : String(error));
    } finally {
      setFetchingDraftModels(false);
    }
  };

  const testDraft = async () => {
    if (!draft) {
      return;
    }
    if (requireEntitlement && !entitled) {
      toast.showError(`Requires billing add-on "${BILLING_ADDON_AI_ASSISTANT}". Sync Billing first.`);
      return;
    }
    setTesting(true);
    try {
      if (billing) {
        await billing.restore(ACCOUNT_KEY);
      }
      const probeProfile: CloudAiProfile = {
        id: "draft-probe",
        name: "",
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        model: draft.model,
        hasApiKey: false,
        isDefault: false,
      };
      const ok = await cloudClient.testConnection(probeProfile, draft.apiKey || undefined, {
        timeoutMs: 5000,
      });
      if (ok) {
        toast.showSuccess("Reachable.");
      } else {
        toast.showError(isLocalProvider(draft.provider) ? LOCAL_CONNECT_HINT : "Could not connect (check key / URL).");
      }
    } catch (error) {
      toast.showError(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const addDraft = async () => {
    if (!draft || addInFlightRef.current) {
      return;
    }
    const baseUrl = draft.baseUrl.trim();
    const model = draft.model.trim();
    if (!baseUrl || !model) {
      toast.showError("Base URL and model are required.");
      return;
    }

    addInFlightRef.current = true;
    setAdding(true);
    try {
      const dupe = findDuplicateProfile(profiles, { provider: draft.provider, baseUrl, model });
      if (dupe) {
        setSelectedId(dupe.id);
        setDraft(null);
        setPickerValue("");
        toast.showInfo(`Already added as "${dupe.name}" — selected it below.`);
        return;
      }

      const profile = createCloudProfile({
        provider: draft.provider,
        baseUrl,
        model,
        isDefault: profiles.length === 0,
      });
      if (draft.apiKey.trim()) {
        await keyStore.writeApiKey(profile.id, draft.apiKey.trim());
        profile.hasApiKey = true;
      }
      persist([...profiles, profile]);
      setSelectedId(profile.id);
      setDraft(null);
      setPickerValue("");
      toast.showSuccess(`Added "${profile.name}".`);
    } finally {
      addInFlightRef.current = false;
      setAdding(false);
    }
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

  const fetchEditModels = async () => {
    if (!selected) {
      return;
    }
    setFetchingEditModels(true);
    try {
      const models = await cloudClient.listModels(selected, {
        apiKeyOverride: editDraftApiKey || undefined,
        timeoutMs: 8000,
      });
      setEditModels(models);
      if (models.length === 0) {
        toast.showWarning("Connected, but the provider returned no models.");
      }
    } catch (error) {
      toast.showError(error instanceof Error ? error.message : String(error));
    } finally {
      setFetchingEditModels(false);
    }
  };

  const saveEditedKey = async () => {
    if (!selected || !editDraftApiKey.trim()) {
      return;
    }
    await keyStore.writeApiKey(selected.id, editDraftApiKey.trim());
    updateSelected({ hasApiKey: true });
    setEditDraftApiKey("");
    toast.showSuccess("API key saved locally in this WebView only.");
  };

  const testSelected = async () => {
    if (!selected) {
      return;
    }
    if (requireEntitlement && !entitled) {
      toast.showError(`Requires billing add-on "${BILLING_ADDON_AI_ASSISTANT}". Sync Billing first.`);
      return;
    }
    setBusy(true);
    try {
      if (billing) {
        await billing.restore(ACCOUNT_KEY);
      }
      const ok = await cloudClient.testConnection(selected, editDraftApiKey || undefined, { timeoutMs: 5000 });
      if (ok) {
        toast.showSuccess("Reachable.");
        const hasKey = selected.hasApiKey || Boolean(editDraftApiKey.trim());
        if (hasKey !== selected.hasApiKey) {
          updateSelected({ hasApiKey: hasKey });
        }
      } else {
        toast.showError(selectedIsLocal ? LOCAL_CONNECT_HINT : "Could not connect (check key / URL).");
      }
    } catch (error) {
      toast.showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    if (!selected) {
      return;
    }
    await keyStore.deleteApiKey(selected.id);
    const next = profiles.filter((p) => p.id !== selected.id);
    if (next.length > 0 && !next.some((p) => p.isDefault) && next[0]) {
      next[0].isDefault = true;
    }
    persist(next);
    setSelectedId(null);
    setEditDraftApiKey("");
    toast.showSuccess(`Removed "${selected.name}".`);
  };

  const anyReady = profiles.some(isProfileReady);

  const detectedOptions = LOCAL_PROVIDERS.filter((p) => detection[p].running).map((provider) => {
    const count = detection[provider].models.length;
    return {
      value: `detected:${provider}`,
      label: `${displayNameForProvider(provider)} — running${count ? ` (${count} model${count === 1 ? "" : "s"})` : ""}`,
    };
  });

  return (
    <>
      <PageTitle
        title="AI providers"
        description="External AI sends requests from this WebView to your provider with your API key — keys never go to an Office server. Local AI talks directly to a model server running on this device (Ollama, LM Studio, or any OpenAI-compatible server) — nothing leaves the machine."
      />
      <Note>Entitlement status: {entitled ? "ai_assistant active" : "not entitled (or not synced)"}</Note>

      <PageTitle title="Add a provider" />
      <Field label="Provider">
        <Dropdown
          placeholder="Choose a provider…"
          value={
            pickerValue.startsWith("detected:")
              ? (detectedOptions.find((o) => o.value === pickerValue)?.label ?? "")
              : pickerValue
                ? displayNameForProvider(pickerValue as CloudAiProviderKind)
                : ""
          }
          selectedOptions={pickerValue ? [pickerValue] : []}
          onOptionSelect={(_, data) => {
            if (data.optionValue) {
              pickProvider(data.optionValue);
            }
          }}
        >
          {detectedOptions.length > 0 ? (
            <OptionGroup label="Detected on this device">
              {detectedOptions.map((option) => (
                <Option key={option.value} value={option.value}>
                  {option.label}
                </Option>
              ))}
            </OptionGroup>
          ) : null}
          <OptionGroup label="Popular providers">
            <Option value="openai">OpenAI</Option>
            <Option value="openai_compatible">Custom (OpenAI-compatible)</Option>
            <Option value="ollama">Ollama (local)</Option>
            <Option value="lmstudio">LM Studio (local)</Option>
          </OptionGroup>
        </Dropdown>
      </Field>
      {detection.ollama.probing || detection.lmstudio.probing ? (
        <Note>Checking for a running local model server…</Note>
      ) : null}

      {draft ? (
        <div className={styles.card}>
          <Text weight="semibold">{displayNameForProvider(draft.provider)}</Text>
          <Field label="Base URL">
            <Input
              type="url"
              value={draft.baseUrl}
              onChange={(_, data) => setDraft({ ...draft, baseUrl: data.value })}
            />
          </Field>
          <Field label="Model">
            {draft.detectedModels.length > 0 ? (
              <Dropdown
                value={draft.model}
                selectedOptions={[draft.model]}
                onOptionSelect={(_, data) => setDraft({ ...draft, model: data.optionValue ?? draft.model })}
              >
                {draft.detectedModels.map((m) => (
                  <Option key={m} value={m}>
                    {m}
                  </Option>
                ))}
              </Dropdown>
            ) : (
              <Input
                value={draft.model}
                placeholder={isLocalProvider(draft.provider) ? "e.g. llama3.1" : "model id"}
                onChange={(_, data) => setDraft({ ...draft, model: data.value })}
              />
            )}
          </Field>
          <Field label={isLocalProvider(draft.provider) ? "API key (optional — most local servers don't need one)" : "API key"}>
            <Input
              type="password"
              placeholder={isLocalProvider(draft.provider) ? "leave blank if unused" : "sk-…"}
              value={draft.apiKey}
              onChange={(_, data) => setDraft({ ...draft, apiKey: data.value })}
            />
          </Field>
          <div className={styles.actions}>
            <Button
              appearance="secondary"
              size="small"
              disabled={testing || !draft.baseUrl.trim()}
              onClick={() => void testDraft()}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button
              appearance="secondary"
              size="small"
              disabled={fetchingDraftModels || !draft.baseUrl.trim()}
              onClick={() => void fetchDraftModels()}
            >
              {fetchingDraftModels ? "Fetching models…" : "Fetch models"}
            </Button>
            <Button
              appearance="primary"
              size="small"
              disabled={adding || !draft.baseUrl.trim() || !draft.model.trim()}
              onClick={() => void addDraft()}
            >
              {adding ? "Adding…" : "Add"}
            </Button>
            <Button appearance="subtle" size="small" disabled={adding} onClick={cancelDraft}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <PageTitle title="External AI" />
      {externalProfiles.length === 0 ? (
        <Note>No external providers added yet.</Note>
      ) : (
        <ul className={styles.list}>
          {externalProfiles.map((profile) => (
            <li key={profile.id}>
              <Button
                appearance={profile.id === selectedId ? "primary" : "secondary"}
                size="small"
                onClick={() => {
                  setSelectedId(profile.id === selectedId ? null : profile.id);
                  setEditModels([]);
                  setEditDraftApiKey("");
                }}
              >
                {profile.name}
                {profile.isDefault ? " (default)" : ""}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <PageTitle title="Local AI (on this device)" />
      {localProfiles.length === 0 ? (
        <Note>No local model servers added yet.</Note>
      ) : (
        <ul className={styles.list}>
          {localProfiles.map((profile) => (
            <li key={profile.id}>
              <Button
                appearance={profile.id === selectedId ? "primary" : "secondary"}
                size="small"
                onClick={() => {
                  setSelectedId(profile.id === selectedId ? null : profile.id);
                  setEditModels([]);
                  setEditDraftApiKey("");
                }}
              >
                {profile.name}
                {profile.isDefault ? " (default)" : ""}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <div className={styles.card}>
          <Text weight="semibold">Edit "{selected.name}"</Text>
          <Field label="Base URL">
            <Input
              type="url"
              value={selected.baseUrl}
              onChange={(_, data) => updateSelected({ baseUrl: data.value })}
            />
          </Field>
          <Field label="Model">
            {editModels.length > 0 ? (
              <Dropdown
                value={selected.model}
                selectedOptions={[selected.model]}
                onOptionSelect={(_, data) => updateSelected({ model: data.optionValue ?? selected.model })}
              >
                {editModels.map((m) => (
                  <Option key={m} value={m}>
                    {m}
                  </Option>
                ))}
              </Dropdown>
            ) : (
              <Input value={selected.model} onChange={(_, data) => updateSelected({ model: data.value })} />
            )}
          </Field>
          <Field label={selectedIsLocal ? "API key (optional)" : "API key"}>
            <Input
              type="password"
              placeholder={selected.hasApiKey ? "(saved — enter to replace)" : selectedIsLocal ? "leave blank if unused" : "sk-…"}
              value={editDraftApiKey}
              onChange={(_, data) => setEditDraftApiKey(data.value)}
            />
          </Field>
          <div className={styles.actions}>
            <Button
              appearance="secondary"
              size="small"
              disabled={busy || !editDraftApiKey.trim()}
              onClick={() => void saveEditedKey()}
            >
              Save key
            </Button>
            <Button appearance="secondary" size="small" disabled={busy} onClick={() => void testSelected()}>
              {busy ? "Testing…" : "Test connection"}
            </Button>
            <Button
              appearance="secondary"
              size="small"
              disabled={fetchingEditModels || (!selected.hasApiKey && !editDraftApiKey.trim() && !selectedIsLocal)}
              onClick={() => void fetchEditModels()}
            >
              {fetchingEditModels ? "Fetching models…" : "Fetch models"}
            </Button>
            <Button
              appearance="secondary"
              size="small"
              disabled={selected.isDefault}
              onClick={() => updateSelected({ isDefault: true })}
            >
              Use as default
            </Button>
            <Button appearance="subtle" size="small" onClick={() => void removeSelected()}>
              Remove
            </Button>
          </div>
        </div>
      ) : null}

      {anyReady ? (
        <div className={styles.actions}>
          <Button appearance="primary" onClick={() => onReady(profiles)}>
            Go to chat →
          </Button>
        </div>
      ) : null}
    </>
  );
}

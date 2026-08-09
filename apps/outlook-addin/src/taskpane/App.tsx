import { useCallback, useEffect, useMemo, useState } from "react";
import simpleFixtureHtml from "../../../../packages/testkit/fixtures/simple.html?raw";
import {
  detectOutlookCapabilities,
  MockMailHost,
  OutlookMailHost,
  type MailHost,
  type MailMessage,
} from "@scomm-office/office";
import { MemoryUserSettingsStore } from "@scomm-office/storage";
import { detectIdrRuntimeSupport } from "@scomm-office/idr";
import type { ResolvedConfiguration } from "@scomm-office/protocol";
import type { SemanticMailDocument } from "@scomm-office/semantics";
import type { PolicyEvaluation, SendDecision } from "@scomm-office/policy";
import { HostContext } from "../lib/host-context";
import {
  DEFAULT_SETTINGS,
  loadSettingsFromStorage,
  saveSettingsToStorage,
} from "../lib/settings";
import { Navigation, type NavModule } from "./Navigation";
import { MessagePanel } from "./panels/MessagePanel";
import { IdentityPanel } from "./panels/IdentityPanel";
import { SemanticsPanel } from "./panels/SemanticsPanel";
import { SecurityPanel } from "./panels/SecurityPanel";
import { CompliancePanel } from "./panels/CompliancePanel";
import { IdrPanel } from "./panels/IdrPanel";
import { DiagnosticsPanel } from "./panels/DiagnosticsPanel";
import { SettingsPanel } from "./panels/SettingsPanel";

const settingsStore = new MemoryUserSettingsStore<ResolvedConfiguration>();

async function bootstrapHost(): Promise<{
  mailHost: MailHost;
  capabilities: ReturnType<typeof detectOutlookCapabilities>;
  isMockHost: boolean;
}> {
  if (typeof Office !== "undefined" && Office.onReady) {
    await new Promise<void>((resolve) => {
      Office.onReady(() => resolve());
    });
    const capabilities = detectOutlookCapabilities({ Office });
    const mailHost = new OutlookMailHost(Office as never, capabilities);
    return { mailHost, capabilities, isMockHost: false };
  }

  const mailHost = new MockMailHost({
    mode: "read",
    subject: "Mock message — browser dev",
    bodyHtml: simpleFixtureHtml,
    from: { emailAddress: "sender@example.com", displayName: "Sender" },
    to: [{ emailAddress: "you@example.com", displayName: "You" }],
  });
  const capabilities = detectOutlookCapabilities();
  return { mailHost, capabilities, isMockHost: true };
}

export function App() {
  const [ready, setReady] = useState(false);
  const [activeModule, setActiveModule] = useState<NavModule>("message");
  const [mailHost, setMailHost] = useState<MailHost | null>(null);
  const [capabilities, setCapabilities] = useState(detectOutlookCapabilities());
  const [isMockHost, setIsMockHost] = useState(false);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [semanticDoc, setSemanticDoc] = useState<SemanticMailDocument | null>(null);
  const [policyEvaluation, setPolicyEvaluation] = useState<PolicyEvaluation | null>(null);
  const [sendDecision, setSendDecision] = useState<SendDecision | null>(null);
  const [settings, setSettings] = useState<ResolvedConfiguration>(DEFAULT_SETTINGS);
  const [idrRuntime, setIdrRuntime] = useState<Awaited<
    ReturnType<typeof detectIdrRuntimeSupport>
  > | null>(null);
  const [idrConnected, setIdrConnected] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const refreshMessage = useCallback(async () => {
    if (!mailHost) {
      return;
    }
    const next = await mailHost.getCurrentMessage();
    setMessage(next);
  }, [mailHost]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const stored = loadSettingsFromStorage();
        await settingsStore.set(stored);
        const runtime = await detectIdrRuntimeSupport();
        const boot = await bootstrapHost();
        if (cancelled) {
          return;
        }
        setMailHost(boot.mailHost);
        setCapabilities(boot.capabilities);
        setIsMockHost(boot.isMockHost);
        setSettings(stored);
        setIdrRuntime(runtime);
        const initialMessage = await boot.mailHost.getCurrentMessage();
        setMessage(initialMessage);
        setReady(true);
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : String(error));
          setReady(true);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<ResolvedConfiguration>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void settingsStore.set(next);
      saveSettingsToStorage(next);
      return next;
    });
  }, []);

  const setPolicyResult = useCallback(
    (evaluation: PolicyEvaluation | null, decision: SendDecision | null) => {
      setPolicyEvaluation(evaluation);
      setSendDecision(decision);
    },
    [],
  );

  const ctx = useMemo(() => {
    if (!mailHost) {
      return null;
    }
    return {
      mailHost,
      capabilities,
      isMockHost,
      currentUserEmail: isMockHost ? "you@example.com" : undefined,
      message,
      semanticDoc,
      policyEvaluation,
      sendDecision,
      settings,
      idrRuntime,
      idrConnected,
      refreshMessage,
      setSemanticDoc,
      setPolicyResult,
      updateSettings,
      setIdrRuntime,
      setIdrConnected,
    };
  }, [
    mailHost,
    capabilities,
    isMockHost,
    message,
    semanticDoc,
    policyEvaluation,
    sendDecision,
    settings,
    idrRuntime,
    idrConnected,
    refreshMessage,
    setPolicyResult,
    updateSettings,
  ]);

  if (!ready) {
    return <div className="panel empty">Loading SComm Office…</div>;
  }

  if (bootError || !ctx) {
    return (
      <div className="panel">
        <h2>Startup error</h2>
        <p className="error-text">{bootError ?? "Host context unavailable"}</p>
      </div>
    );
  }

  return (
    <HostContext.Provider value={ctx}>
      <div className="app-shell">
        {isMockHost ? (
          <div className="banner">Mock host — running outside Outlook with testkit fixture</div>
        ) : null}
        <header className="app-header">
          <h1>SComm Office</h1>
          <p>Semantics, identity, compliance, and IDR for Outlook mail</p>
        </header>
        <Navigation active={activeModule} onChange={setActiveModule} />
        <main className="panel">
          {activeModule === "message" ? <MessagePanel /> : null}
          {activeModule === "identity" ? <IdentityPanel /> : null}
          {activeModule === "semantics" ? <SemanticsPanel /> : null}
          {activeModule === "security" ? <SecurityPanel /> : null}
          {activeModule === "compliance" ? <CompliancePanel /> : null}
          {activeModule === "idr" ? <IdrPanel /> : null}
          {activeModule === "diagnostics" ? <DiagnosticsPanel /> : null}
          {activeModule === "settings" ? <SettingsPanel /> : null}
        </main>
      </div>
    </HostContext.Provider>
  );
}

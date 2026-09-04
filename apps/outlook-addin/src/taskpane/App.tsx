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
import { HttpMicrosoftGraphClient, GraphSubmissionAdapter } from "@scomm-office/microsoft-graph";
import { HostContext, type GraphDiagnostics } from "../lib/host-context";
import { ResilientIdentityProvider, isNaaConfigured } from "../lib/msal-auth";
import {
  DEFAULT_SETTINGS,
  loadSettingsFromStorage,
  saveSettingsToStorage,
} from "../lib/settings";
import { readTaskPaneLaunch } from "../lib/taskpane-launch";
import { Navigation, type NavModule } from "./Navigation";
import { MessagePanel } from "./panels/MessagePanel";
import { AccountBillingPanel } from "./panels/AccountBillingPanel";
import { IdentityPanel } from "./panels/IdentityPanel";
import { SemanticsPanel } from "./panels/SemanticsPanel";
import { SecurityPanel } from "./panels/SecurityPanel";
import { CompliancePanel } from "./panels/CompliancePanel";
import { IdrPanel } from "./panels/IdrPanel";
import { AiSettingsPanel } from "./panels/AiSettingsPanel";
import { DiagnosticsPanel } from "./panels/DiagnosticsPanel";
import { SettingsPanel } from "./panels/SettingsPanel";

const settingsStore = new MemoryUserSettingsStore<ResolvedConfiguration>();

async function bootstrapHost(): Promise<{
  mailHost: MailHost;
  capabilities: ReturnType<typeof detectOutlookCapabilities>;
  isMockHost: boolean;
  userEmail?: string;
  graphSubmissionAdapter: GraphSubmissionAdapter | null;
  graphDiagnostics: GraphDiagnostics;
}> {
  if (typeof Office !== "undefined" && Office.onReady) {
    const info = await Office.onReady();
    if (info.host) {
      const capabilities = detectOutlookCapabilities({ Office });
      const mailHost = new OutlookMailHost(Office as never, capabilities);

      // Get user email from Office.js mailbox profile (most reliable)
      let userEmail: string | undefined;
      try {
        const profile = (Office as unknown as {
          context?: { mailbox?: { userProfile?: { emailAddress?: string; displayName?: string } } };
        }).context?.mailbox?.userProfile;
        userEmail = profile?.emailAddress ?? undefined;
      } catch {
        // userProfile may not be available on all hosts
      }

      // Graph submission requires auth (NAA, falling back to popup); it's also
      // our fallback for user email. Interactive auth is deferred to the actual
      // send (a real button click) — never triggered here at boot, since a
      // background/init popup attempt would just get blocked by the browser.
      let graphSubmissionAdapter: GraphSubmissionAdapter | null = null;
      const graphDiagnostics: GraphDiagnostics = {
        clientIdConfigured: isNaaConfigured(),
        probedSuccessfully: null,
      };

      if (isNaaConfigured()) {
        const identity = new ResilientIdentityProvider();
        graphSubmissionAdapter = new GraphSubmissionAdapter(new HttpMicrosoftGraphClient(identity));

        // Silent-only best-effort: only succeeds if a session is already
        // cached (e.g. NAA SSO through the host) — never prompts.
        const user = await identity.trySilentUser();
        if (user && !userEmail) {
          userEmail = user.mail ?? user.userPrincipalName ?? undefined;
        }
      } else {
        graphDiagnostics.error = "VITE_AZURE_CLIENT_ID not set in the build that produced this bundle.";
      }

      return { mailHost, capabilities, isMockHost: false, userEmail, graphSubmissionAdapter, graphDiagnostics };
    }
    // info.host is falsy — office.js loaded standalone outside any Office
    // host (e.g. a plain browser tab). Fall through to MockMailHost below.
  }

  const mailHost = new MockMailHost({
    mode: "read",
    subject: "Mock message — browser dev",
    bodyHtml: simpleFixtureHtml,
    from: { emailAddress: "sender@example.com", displayName: "Sender" },
    to: [{ emailAddress: "muzamiltest9@gmail.com", displayName: "You" }],
  });
  const capabilities = detectOutlookCapabilities();
  return {
    mailHost,
    capabilities,
    isMockHost: true,
    userEmail: "muzamiltest9@gmail.com",
    graphSubmissionAdapter: null,
    graphDiagnostics: { clientIdConfigured: false, probedSuccessfully: null, error: "Mock host — Graph not applicable." },
  };
}

export function App() {
  const launch = useMemo(() => readTaskPaneLaunch(), []);
  const [ready, setReady] = useState(false);
  const [activeModule, setActiveModule] = useState<NavModule>(launch.module ?? "message");
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
  const [userEmail, setUserEmail] = useState<string | undefined>(undefined);
  const [graphSubmissionAdapter, setGraphSubmissionAdapter] =
    useState<GraphSubmissionAdapter | null>(null);
  const [graphDiagnostics, setGraphDiagnostics] = useState<GraphDiagnostics>({
    clientIdConfigured: false,
    probedSuccessfully: null,
  });

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
        setUserEmail(boot.userEmail);
        setGraphSubmissionAdapter(boot.graphSubmissionAdapter);
        setGraphDiagnostics(boot.graphDiagnostics);
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
      currentUserEmail: userEmail,
      graphSubmissionAdapter,
      graphDiagnostics,
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
      setGraphDiagnostics,
    };
  }, [
    mailHost,
    capabilities,
    isMockHost,
    userEmail,
    graphSubmissionAdapter,
    graphDiagnostics,
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
    return <div className="panel empty">Loading Scomm.AI…</div>;
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
          <h1>Scomm.AI</h1>
          <p>Outlook add-in — OpenPGP, pubkey.scomm.ai, semantics, and compliance</p>
        </header>
        <Navigation active={activeModule} onChange={setActiveModule} />
        <main className="panel">
          {activeModule === "message" ? <MessagePanel /> : null}
          {activeModule === "account" ? <AccountBillingPanel /> : null}
          {activeModule === "identity" ? <IdentityPanel /> : null}
          {activeModule === "semantics" ? <SemanticsPanel /> : null}
          {activeModule === "security" ? <SecurityPanel launchAction={launch.action} /> : null}
          {activeModule === "compliance" ? <CompliancePanel /> : null}
          {activeModule === "idr" ? <IdrPanel /> : null}
          {activeModule === "ai" ? <AiSettingsPanel /> : null}
          {activeModule === "diagnostics" ? <DiagnosticsPanel /> : null}
          {activeModule === "settings" ? <SettingsPanel /> : null}
        </main>
      </div>
    </HostContext.Provider>
  );
}

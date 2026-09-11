import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DEFAULT_SETTINGS, loadSettingsFromStorage, saveSettingsToStorage } from "../lib/settings";
import { isOutlookMailboxSession } from "../lib/office-ready";
import { readTaskPaneLaunch } from "../lib/taskpane-launch";
import { Navigation, type NavModule } from "./Navigation";
import { MessagePanel } from "./panels/MessagePanel";
import { AccountBillingPanel } from "./panels/AccountBillingPanel";
import { IdentityPanel } from "./panels/IdentityPanel";
import { VaultPanel } from "./panels/vault/VaultPanel";
import { CompliancePanel } from "./panels/CompliancePanel";
import { IdrPanel } from "./panels/IdrPanel";
import { AiSettingsPanel } from "./panels/AiSettingsPanel";
import { DiagnosticsPanel } from "./panels/DiagnosticsPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { MessageBar, MessageBarBody, Spinner, Text, Title3 } from "@fluentui/react-components";
import { usePaneStyles } from "./ui/layout";

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
    if (isOutlookMailboxSession(info, Office as never)) {
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
      // send (a real button click) â€” never triggered here at boot, since a
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
        // cached (e.g. NAA SSO through the host) â€” never prompts.
        const user = await identity.trySilentUser();
        if (user && !userEmail) {
          userEmail = user.mail ?? user.userPrincipalName ?? undefined;
        }
      } else {
        graphDiagnostics.error = "VITE_AZURE_CLIENT_ID not set in the build that produced this bundle.";
      }

      return {
        mailHost,
        capabilities,
        isMockHost: false,
        userEmail,
        graphSubmissionAdapter,
        graphDiagnostics,
      };
    }
    // Not an Outlook mailbox session â€” office.js loaded standalone outside any
    // Office host (e.g. a plain browser tab). Fall through to MockMailHost below.
  }

  // Dev/E2E-only seam so Playwright can drive the mock host with a specific
  // message (e.g. PGP-armored body) instead of the fixed fixture below.
  // Gated on import.meta.env.DEV so it's always undefined in a production
  // build (the real Office branch above is taken there anyway).
  const override = import.meta.env.DEV
    ? (globalThis as { __SCOMM_MOCK_MESSAGE__?: Partial<MailMessage> }).__SCOMM_MOCK_MESSAGE__
    : undefined;

  const mailHost = new MockMailHost({
    mode: "read",
    subject: "Mock message â€” browser dev",
    bodyHtml: simpleFixtureHtml,
    from: { emailAddress: "sender@example.com", displayName: "Sender" },
    to: [{ emailAddress: "muzamiltest9@gmail.com", displayName: "You" }],
    ...override,
  });
  const capabilities = detectOutlookCapabilities();
  return {
    mailHost,
    capabilities,
    isMockHost: true,
    userEmail: "muzamiltest9@gmail.com",
    graphSubmissionAdapter: null,
    graphDiagnostics: { clientIdConfigured: false, probedSuccessfully: null, error: "Mock host â€” Graph not applicable." },
  };
}

export function App() {
  const styles = usePaneStyles();
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

  const refreshMessage = useCallback(async (reason = "manual") => {
    if (!mailHost) {
      return;
    }
    const next = await mailHost.getCurrentMessage();
    // TEMP diagnostic â€” remove after item-switch / compose-mode issues are confirmed fixed.
    console.info("[scomm-temp:refresh-message]", {
      reason,
      id: next.id ?? null,
      mode: next.mode,
      subject: next.subject ?? null,
      bodyTextLength: next.bodyText?.length ?? 0,
    });
    setMessage(next);
  }, [mailHost]);

  const itemChangedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!mailHost || isMockHost || !(mailHost instanceof OutlookMailHost)) {
      return;
    }
    const unsubscribe = mailHost.subscribeItemChanged(() => {
      console.info("[scomm-temp:item-changed]", { note: "Outlook mailbox item changed" });
      void refreshMessage("item-changed");
      if (itemChangedTimer.current) {
        clearTimeout(itemChangedTimer.current);
      }
      // Outlook sometimes exposes the new item before body APIs are ready.
      itemChangedTimer.current = setTimeout(() => {
        void refreshMessage("item-changed-delayed");
      }, 250);
    });
    return () => {
      if (itemChangedTimer.current) {
        clearTimeout(itemChangedTimer.current);
      }
      unsubscribe();
    };
  }, [mailHost, isMockHost, refreshMessage]);

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
        console.info("[scomm-temp:boot-message]", {
          isMockHost: boot.isMockHost,
          id: initialMessage.id ?? null,
          mode: initialMessage.mode,
          subject: initialMessage.subject ?? null,
        });
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
    return (
      <div className={styles.panel}>
        <Spinner size="small" label="Loading Scomm.AIâ€¦" />
      </div>
    );
  }

  if (bootError || !ctx) {
    return (
      <div className={styles.panel}>
        <Title3>Startup error</Title3>
        <MessageBar intent="error">
          <MessageBarBody>{bootError ?? "Host context unavailable"}</MessageBarBody>
        </MessageBar>
        {bootError?.includes("mailbox item") ? (
          <Text size={200}>
            Open an email (read or compose) in Outlook, then start Scomm.AI from the ribbon. A
            normal browser tab is not a mailbox item.
          </Text>
        ) : null}
      </div>
    );
  }

  return (
    <HostContext.Provider value={ctx}>
      <div className={styles.shell}>
        {isMockHost ? (
          <MessageBar intent="warning">
            <MessageBarBody>Mock host â€” running outside Outlook with a testkit fixture.</MessageBarBody>
          </MessageBar>
        ) : null}
        <header className={styles.header}>
          <Title3 className={styles.headerTitle}>Scomm.AI</Title3>
          <Text size={200}>
            Outlook add-in â€” OpenPGP, discovery.scomm.ai, semantics, and compliance
          </Text>
        </header>
        <Navigation active={activeModule} onChange={setActiveModule} />
        <main className={styles.panel}>
          {activeModule === "message" ? <MessagePanel /> : null}
          {activeModule === "account" ? <AccountBillingPanel /> : null}
          {activeModule === "identity" ? <IdentityPanel /> : null}
          {activeModule === "security" ? <VaultPanel launchAction={launch.action} /> : null}
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

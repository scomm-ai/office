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
import { NaaIdentityProvider, isNaaConfigured } from "../lib/msal-auth";
import {
  DEFAULT_SETTINGS,
  loadSettingsFromStorage,
  saveSettingsToStorage,
} from "../lib/settings";
import { isOutlookMailboxSession } from "../lib/office-ready";
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
import { MessageBar, MessageBarBody, Spinner, Text, Title3 } from "@fluentui/react-components";
import { acquireUsingPartyApiToken } from "@2key/browser-sdk/auth";
import { createOfficeBillingClient } from "../lib/billing-client";
import { usePaneStyles } from "./ui/layout";

const settingsStore = new MemoryUserSettingsStore<ResolvedConfiguration>();

async function bootstrapHost(): Promise<{
  mailHost: MailHost;
  capabilities: ReturnType<typeof detectOutlookCapabilities>;
  isMockHost: boolean;
  userEmail?: string;
}> {
  if (typeof Office !== "undefined" && Office.onReady) {
    const info = await Office.onReady();
    if (isOutlookMailboxSession(info, Office as never)) {
      const capabilities = detectOutlookCapabilities({ Office });
      const mailHost = new OutlookMailHost(Office as never, capabilities);

      let userEmail: string | undefined;
      try {
        const profile = (Office as unknown as {
          context?: { mailbox?: { userProfile?: { emailAddress?: string; displayName?: string } } };
        }).context?.mailbox?.userProfile;
        userEmail = profile?.emailAddress ?? undefined;
      } catch {
        // userProfile may not be available on all hosts
      }

      if (!userEmail && isNaaConfigured()) {
        try {
          const naa = new NaaIdentityProvider();
          const user = await naa.getUser();
          userEmail = user.mail ?? user.userPrincipalName ?? undefined;
        } catch {
          // NAA may not be available on all hosts — silently continue
        }
      }

      return { mailHost, capabilities, isMockHost: false, userEmail };
    }
  }

  const mailHost = new MockMailHost({
    mode: "read",
    subject: "Mock message — browser dev",
    bodyHtml: simpleFixtureHtml,
    from: { emailAddress: "sender@example.com", displayName: "Sender" },
    to: [{ emailAddress: "you@example.com", displayName: "You" }],
  });
  const capabilities = detectOutlookCapabilities();
  return { mailHost, capabilities, isMockHost: true, userEmail: "you@example.com" };
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

  useEffect(() => {
    if (!ready) {
      return;
    }
    const origin = settings.billingOrigin?.trim();
    if (!origin) {
      return;
    }
    const client = createOfficeBillingClient(origin, settings.billingPortalUrl?.trim());
    client.startPolling({
      accountKey: "default",
      accessToken: async () => {
        try {
          const minted = await acquireUsingPartyApiToken(client.config);
          return minted.token ?? "";
        } catch {
          return "";
        }
      },
    });
    return () => client.stopPolling();
  }, [ready, settings.billingOrigin, settings.billingPortalUrl]);

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
    userEmail,
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
        <Spinner size="small" label="Loading Scomm.AI…" />
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
            <MessageBarBody>Mock host — running outside Outlook with a testkit fixture.</MessageBarBody>
          </MessageBar>
        ) : null}
        <header className={styles.header}>
          <Title3 className={styles.headerTitle}>Scomm.AI</Title3>
          <Text size={200}>
            Outlook add-in — OpenPGP, pubkey.scomm.ai, semantics, and compliance
          </Text>
        </header>
        <Navigation active={activeModule} onChange={setActiveModule} />
        <main className={styles.panel}>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BillingAuthClient,
  BillingPortalUrls,
  BillingSdk,
  BillingSession,
  LocalStorageBillingSessionStore,
  type BillingOAuthProvidersDocument,
  type BillingTokenPayload,
  type Plan,
} from "@scomm-office/billing";
import { useHostContext } from "../../lib/host-context";

const ACCOUNT_KEY = "default";

export function AccountBillingPanel() {
  const { settings, updateSettings, isMockHost, currentUserEmail } = useHostContext();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pasteToken, setPasteToken] = useState("");
  const [providers, setProviders] = useState<BillingOAuthProvidersDocument | null>(null);
  const [payload, setPayload] = useState<BillingTokenPayload | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);

  const store = useMemo(() => new LocalStorageBillingSessionStore(), []);
  const session = useMemo(() => new BillingSession(store), [store]);

  const billingOrigin = settings.billingOrigin?.trim() ?? "";

  const authClient = useMemo(() => {
    if (!billingOrigin) {
      return null;
    }
    return new BillingAuthClient({
      billingBaseUrl: billingOrigin,
      callbackURL:
        typeof window !== "undefined" ? `${window.location.origin}/taskpane.html` : undefined,
    });
  }, [billingOrigin]);

  const refresh = useCallback(async () => {
    if (billingOrigin) {
      BillingSdk.configure({ billingApiBaseUrl: billingOrigin });
    }
    const account = await session.initForAccount(ACCOUNT_KEY);
    setPayload(BillingSdk.getPayload());
    setProfileEmail(account?.userProfile?.email ?? null);
  }, [billingOrigin, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const discover = async () => {
    if (!authClient) {
      setStatus("Set billing origin in Settings first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const doc = await authClient.discover();
      setProviders(doc);
      setStatus(
        `Providers: ${doc.providers.join(", ") || "none"}; email/password: ${
          doc.emailPasswordEnabled ? "yes" : "unknown"
        }`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    if (!authClient) {
      setStatus("Set billing origin in Settings first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await authClient.signInEmail({ email, password });
      const tokens = await authClient.acquireApiToken();
      await session.persistAuthTokens({ accountKey: ACCOUNT_KEY, tokens });
      const sync = await session.syncOnlineForAccount({ accountKey: ACCOUNT_KEY });
      setStatus(sync.kind === "success" ? sync.message : sync.message);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const syncLicense = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const sync = await session.syncOnlineForAccount({ accountKey: ACCOUNT_KEY });
      setStatus(sync.message);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const verifyPaste = async () => {
    setBusy(true);
    setStatus(null);
    try {
      if (billingOrigin) {
        BillingSdk.configure({ billingApiBaseUrl: billingOrigin });
      }
      const result = await session.verifyOfflineToken({
        accountKey: ACCOUNT_KEY,
        token: pasteToken,
      });
      setStatus(result.message);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const loadPlans = async () => {
    if (!billingOrigin) {
      setStatus("Set billing origin in Settings first.");
      return;
    }
    setBusy(true);
    try {
      BillingSdk.configure({ billingApiBaseUrl: billingOrigin });
      const catalog = await BillingSdk.fetchPlanCatalog();
      setPlans(catalog);
      setStatus(`Loaded ${catalog.length} plan(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openPortal = () => {
    const portalBase = settings.billingPortalUrl || billingOrigin;
    if (!portalBase) {
      setStatus("Set billing portal URL.");
      return;
    }
    const urls = new BillingPortalUrls(portalBase);
    const token = session.accountSession?.authTokens?.accessToken;
    window.open(urls.home(token), "_blank", "noopener,noreferrer");
  };

  const signOut = async () => {
    setBusy(true);
    try {
      if (authClient) {
        await authClient.signOut().catch(() => undefined);
      }
      await session.clearAccount(ACCOUNT_KEY);
      setPayload(null);
      setProfileEmail(null);
      setStatus("Signed out of billing profile.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Account & Billing</h2>
      <p className="note">
        Profile/billing SSO is separate from the Outlook mailbox identity (dual auth). License JWTs
        verify client-side; checkout stays on the billing portal.
      </p>

      <dl className="meta-grid">
        <dt>Mailbox (host)</dt>
        <dd>{currentUserEmail ?? (isMockHost ? "you@example.com" : "Unknown")}</dd>
        <dt>Billing profile</dt>
        <dd>{profileEmail ?? "Not signed in"}</dd>
        <dt>Billing origin</dt>
        <dd>{billingOrigin || "— (set in Settings)"}</dd>
        <dt>AI add-on</dt>
        <dd>{session.hasAiAssistantEntitlement(payload) ? "entitled" : "not entitled"}</dd>
      </dl>

      <div className="field">
        <label htmlFor="billing-origin-inline">Billing origin</label>
        <input
          id="billing-origin-inline"
          type="url"
          placeholder="https://billing.example.com"
          value={settings.billingOrigin ?? ""}
          onChange={(event) => updateSettings({ billingOrigin: event.target.value || undefined })}
        />
      </div>

      <section>
        <h2>Sign in</h2>
        <div className="field">
          <label htmlFor="billing-email">Email</label>
          <input
            id="billing-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="billing-password">Password</label>
          <input
            id="billing-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void signIn()}>
            Sign in
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void discover()}>
            Discover providers
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void syncLicense()}>
            Sync license
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        {providers ? (
          <p className="note">
            Social: {providers.providers.join(", ") || "none"} — popup OAuth may be blocked in some
            Outlook WebViews; use email or paste token.
          </p>
        ) : null}
      </section>

      <section>
        <h2>Offline license paste</h2>
        <div className="field">
          <label htmlFor="license-paste">License JWT</label>
          <textarea
            id="license-paste"
            rows={3}
            value={pasteToken}
            onChange={(event) => setPasteToken(event.target.value)}
          />
        </div>
        <div className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => void verifyPaste()}>
            Verify & save
          </button>
        </div>
      </section>

      <section>
        <h2>Plans & portal</h2>
        <div className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => void loadPlans()}>
            Load plan catalog
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!session.canOpenPortal()}
            onClick={openPortal}
            title={session.canOpenPortal() ? "Open billing portal" : "Paying-party owners only"}
          >
            Open billing portal
          </button>
        </div>
        {plans.length > 0 ? (
          <ul className="list-plain">
            {plans.map((plan) => (
              <li key={plan.id}>
                {plan.name} — {plan.billingInterval} — {plan.basePrice} {plan.currency}
                {plan.addonCode ? ` (addon: ${plan.addonCode})` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {payload ? (
        <section>
          <h2>License entitlements</h2>
          <ul className="list-plain">
            {payload.subscriptions.map((sub) => (
              <li key={sub.subscriptionId}>
                {sub.planName} / {sub.subscriptionStatus}
                {sub.addonCode ? ` [${sub.addonCode}]` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {status ? <p className="note">{status}</p> : null}
    </section>
  );
}

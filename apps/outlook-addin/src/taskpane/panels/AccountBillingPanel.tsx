import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acquireApiToken,
  authBaseUrl,
  fetchOAuthProviders,
  shopUrl,
  type OAuthProviderInfo,
} from "@2key/browser-sdk/auth";
import type { LicensePayload, Plan } from "@2key/browser-sdk/billing";
import { BILLING_ADDON_AI_ASSISTANT, BILLING_ADDON_PGP } from "../../lib/billing-catalog";
import { createOfficeBillingClient } from "../../lib/billing-client";
import { openOAuthDialog } from "../../lib/billing-oauth-dialog";
import { useHostContext } from "../../lib/host-context";
import { DEFAULT_SETTINGS } from "../../lib/settings";

const ACCOUNT_KEY = "default";

export function AccountBillingPanel() {
  const { settings, updateSettings, isMockHost, currentUserEmail } = useHostContext();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteToken, setPasteToken] = useState("");
  const [providers, setProviders] = useState<OAuthProviderInfo[]>([]);
  const [payload, setPayload] = useState<LicensePayload | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [deviceSki, setDeviceSki] = useState<string | null>(null);
  const [aiOk, setAiOk] = useState(false);
  const [pgpOk, setPgpOk] = useState(false);

  const billingOrigin = settings.billingOrigin?.trim() ?? "";

  const billing = useMemo(() => {
    if (!billingOrigin) {
      return null;
    }
    return createOfficeBillingClient(billingOrigin);
  }, [billingOrigin]);

  const refresh = useCallback(async () => {
    if (!billing) {
      setPayload(null);
      setDeviceSki(null);
      setAiOk(false);
      setPgpOk(false);
      return;
    }
    const device = await billing.ensureDeviceId({
      accountKey: ACCOUNT_KEY,
      friendlyName: "Outlook",
    });
    setDeviceSki(device.ski);
    const restored = await billing.restore(ACCOUNT_KEY);
    setPayload(restored);
    try {
      const e = billing.entitlements();
      setAiOk(e.hasAddon(BILLING_ADDON_AI_ASSISTANT) || e.hasOffering(BILLING_ADDON_AI_ASSISTANT));
      setPgpOk(e.hasAddon(BILLING_ADDON_PGP) || e.hasOffering(BILLING_ADDON_PGP));
    } catch {
      setAiOk(false);
      setPgpOk(false);
    }
  }, [billing]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!billing) return;
    fetchOAuthProviders(billing.config)
      .then((doc) =>
        setProviders(doc.providers.filter((p) => p.enabled && p.id !== "email")),
      )
      .catch(() => setProviders([]));
  }, [billing]);

  const signInWithProvider = async (providerId: string) => {
    if (!billing) {
      setStatus("Set billing origin in Settings first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await openOAuthDialog(billing.config, providerId);
      if (result.status === "cancelled") {
        setStatus("Sign-in cancelled.");
        return;
      }
      if (result.status === "error") {
        setStatus(result.message);
        return;
      }
      let token = result.token;
      if (!token) {
        const minted = await acquireApiToken(billing.config);
        if (minted.orgPickRequired) {
          setStatus("Choose an organization in the billing portal, then sync again.");
          return;
        }
        token = minted.token;
      }
      await billing.ensureDeviceId({ accountKey: ACCOUNT_KEY, friendlyName: "Outlook" });
      await billing.syncLicense({ accessToken: token, accountKey: ACCOUNT_KEY });
      setStatus("Signed in and license synced.");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const syncLicense = async () => {
    if (!billing) {
      setStatus("Set billing origin in Settings first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const minted = await acquireApiToken(billing.config);
      if (minted.orgPickRequired || !minted.token) {
        setStatus("Sign in first, then sync license.");
        return;
      }
      await billing.syncLicense({ accessToken: minted.token, accountKey: ACCOUNT_KEY });
      setStatus("License synced.");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const verifyPaste = async () => {
    if (!billing) {
      setStatus("Set billing origin in Settings first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await billing.pasteLicense(pasteToken, ACCOUNT_KEY);
      setStatus("Token verified. Subscription data updated.");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const loadPlans = async () => {
    if (!billing) {
      setStatus("Set billing origin in Settings first.");
      return;
    }
    setBusy(true);
    try {
      const catalog = await billing.api.fetchPlans();
      setPlans(catalog);
      setStatus(`Loaded ${catalog.length} plan(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openPortal = () => {
    if (!billing) {
      setStatus("Set billing origin in Settings first.");
      return;
    }
    window.open(shopUrl(billing.config), "_blank", "noopener,noreferrer");
  };

  const signOut = async () => {
    setBusy(true);
    try {
      if (billing) {
        await fetch(`${authBaseUrl(billing.config)}/sign-out`, {
          method: "POST",
          credentials: "include",
        }).catch(() => undefined);
        await billing.session.clear(ACCOUNT_KEY);
      }
      setPayload(null);
      setAiOk(false);
      setPgpOk(false);
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
        verify client-side via `@2key/browser-sdk`; checkout stays on the billing portal.
      </p>

      <dl className="meta-grid">
        <dt>Mailbox (host)</dt>
        <dd>{currentUserEmail ?? (isMockHost ? "you@example.com" : "Unknown")}</dd>
        <dt>Billing profile</dt>
        <dd>{payload?.payingParty.billingEmail ?? "Not signed in"}</dd>
        <dt>Billing origin</dt>
        <dd>{billingOrigin || "— (set in Settings)"}</dd>
        <dt>Device SKI</dt>
        <dd>{deviceSki ?? "—"}</dd>
        <dt>AI add-on</dt>
        <dd>{aiOk ? "entitled" : "not entitled"}</dd>
        <dt>PGP add-on</dt>
        <dd>{pgpOk ? "entitled" : "not entitled"}</dd>
      </dl>

      <div className="field">
        <label htmlFor="billing-origin-inline">Billing origin</label>
        <input
          id="billing-origin-inline"
          type="url"
          placeholder={DEFAULT_SETTINGS.billingOrigin ?? ""}
          value={settings.billingOrigin ?? ""}
          onChange={(event) => updateSettings({ billingOrigin: event.target.value || undefined })}
        />
      </div>

      <section>
        <h2>Sign in</h2>
        <div className="actions">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void signInWithProvider(p.id)}
            >
              Sign in with {p.id.charAt(0).toUpperCase() + p.id.slice(1)}
            </button>
          ))}
          {providers.length === 0 && billingOrigin ? (
            <p className="note">No sign-in providers discovered.</p>
          ) : null}
          {!billingOrigin ? (
            <p className="note">Set billing origin in Settings first.</p>
          ) : null}
        </div>
        <div className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => void syncLicense()}>
            Sync license
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
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
          <button type="button" className="secondary" disabled={!billing} onClick={openPortal}>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acquireUsingPartyApiToken,
  authBaseUrl,
  clearAuthSessionToken,
  fetchOAuthProviders,
  readAuthSessionToken,
  shopUrl,
  type OAuthProviderInfo,
} from "@2key/browser-sdk/auth";
import {
  licenseListsSki,
  TwoKeyError,
  type LicensePayload,
} from "@2key/browser-sdk/billing";
import { BILLING_ADDON_AI_ASSISTANT, BILLING_ADDON_PGP } from "../../lib/billing-catalog";
import {
  deviceBoundLabel,
  encodePublicJwkForPortal,
  hasBillingAuth,
  onlineSyncBlockedReason,
  parseDeviceLimitError,
  resolveBillingPortalOpenUrl,
  validateDeviceFriendlyName,
  copyTextToClipboard,
  type DeviceLimitState,
} from "../../lib/billing-account-sync";
import { createOfficeBillingClient } from "../../lib/billing-client";
import { openOAuthDialog, type OAuthDialogResult } from "../../lib/billing-oauth-dialog";
import { useHostContext } from "../../lib/host-context";
import { DEFAULT_SETTINGS } from "../../lib/settings";
import { ActionAlert, type AlertKind } from "../components/action-alert";
import { Button, Field, Input, Note, PageTitle, StatusBadge, Textarea, usePaneStyles } from "../ui/layout";

const ACCOUNT_KEY = "default";
const DEFAULT_DEVICE_NAME = "Outlook";

type AlertRegion = "signin" | "sync" | "device" | "paste" | "seats" | "limit";

interface RegionAlert {
  region: AlertRegion;
  kind: AlertKind;
  message: string;
}

export function AccountBillingPanel() {
  const styles = usePaneStyles();
  const { settings, updateSettings, isMockHost, currentUserEmail } = useHostContext();
  const [alert, setAlert] = useState<RegionAlert | null>(null);
  const [busyRegion, setBusyRegion] = useState<AlertRegion | null>(null);
  const [pasteToken, setPasteToken] = useState("");
  const [providers, setProviders] = useState<OAuthProviderInfo[]>([]);
  const [payload, setPayload] = useState<LicensePayload | null>(null);
  const [deviceSki, setDeviceSki] = useState<string | null>(null);
  const [deviceKeyJson, setDeviceKeyJson] = useState("");
  const [publicJwk, setPublicJwk] = useState<Record<string, unknown> | null>(null);
  const [friendlyName, setFriendlyName] = useState(DEFAULT_DEVICE_NAME);
  const [deviceBound, setDeviceBound] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [deviceLimit, setDeviceLimit] = useState<DeviceLimitState | null>(null);
  const [aiOk, setAiOk] = useState(false);
  const [pgpOk, setPgpOk] = useState(false);

  const billingOrigin = settings.billingOrigin?.trim() ?? "";
  const billingPortalUrl = settings.billingPortalUrl?.trim() ?? "";

  const billing = useMemo(() => {
    if (!billingOrigin) {
      return null;
    }
    return createOfficeBillingClient(billingOrigin, billingPortalUrl || undefined);
  }, [billingOrigin, billingPortalUrl]);

  const announce = (region: AlertRegion, message: string, kind: AlertKind = "ok") => {
    setAlert({ region, kind, message });
  };

  const refresh = useCallback(async () => {
    if (!billing) {
      setPayload(null);
      setDeviceSki(null);
      setDeviceKeyJson("");
      setPublicJwk(null);
      setFriendlyName(DEFAULT_DEVICE_NAME);
      setDeviceBound(false);
      setSignedIn(false);
      setAiOk(false);
      setPgpOk(false);
      return;
    }
    try {
      const device = await billing.ensureDeviceId({
        accountKey: ACCOUNT_KEY,
      });
      const name = device.friendlyName?.trim() || DEFAULT_DEVICE_NAME;
      setDeviceSki(device.ski);
      setPublicJwk(device.publicJwk);
      setFriendlyName(name);
      setDeviceKeyJson(encodePublicJwkForPortal(device.publicJwk, name));
      const stored = await billing.session.load(ACCOUNT_KEY);
      setSignedIn(
        hasBillingAuth({
          sessionToken: readAuthSessionToken(billing.config),
          accessToken: stored?.accessToken,
        }),
      );
      const restored = await billing.restore(ACCOUNT_KEY);
      setPayload(restored);
      setDeviceBound(Boolean(restored && licenseListsSki(restored, device.ski)));
      try {
        const e = billing.entitlements();
        setAiOk(e.hasAddon(BILLING_ADDON_AI_ASSISTANT) || e.hasOffering(BILLING_ADDON_AI_ASSISTANT));
        setPgpOk(e.hasAddon(BILLING_ADDON_PGP) || e.hasOffering(BILLING_ADDON_PGP));
      } catch {
        setAiOk(false);
        setPgpOk(false);
      }
    } catch (error) {
      announce(
        "device",
        error instanceof Error ? error.message : "Could not create this Outlook device key.",
        "error",
      );
    }
  }, [billing]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!alert) {
      return;
    }
    document.getElementById(`alert-${alert.region}`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [alert]);

  useEffect(() => {
    if (!billing) {
      setProviders([]);
      return;
    }
    fetchOAuthProviders(billing.config)
      .then((doc) => {
        const enabled = doc.providers.filter((p) => p.enabled && p.id !== "email");
        setProviders(enabled);
        if (enabled.length === 0) {
          announce(
            "signin",
            "No sign-in providers are enabled on this billing origin.",
            "warn",
          );
        }
      })
      .catch((error) => {
        setProviders([]);
        announce(
          "signin",
          error instanceof Error
            ? error.message
            : "Could not load sign-in providers from billing.",
          "error",
        );
      });
  }, [billing]);

  const persistFriendlyName = async (): Promise<string | null> => {
    if (!billing) {
      announce("device", "Set billing origin in Settings first.", "error");
      return null;
    }
    const invalid = validateDeviceFriendlyName(friendlyName);
    if (invalid) {
      announce("device", invalid, "error");
      return null;
    }
    const name = friendlyName.trim();
    const device = await billing.ensureDeviceId({
      accountKey: ACCOUNT_KEY,
      friendlyName: name,
    });
    setDeviceSki(device.ski);
    setPublicJwk(device.publicJwk);
    setDeviceKeyJson(encodePublicJwkForPortal(device.publicJwk, name));
    return name;
  };

  const runOnlineSync = async (accessToken: string, replaceSki?: string) => {
    if (!billing) return;
    const name = await persistFriendlyName();
    if (!name) {
      throw new Error("Set a valid device name on this Outlook first.");
    }
    const nextPayload = await billing.syncLicense({
      accessToken,
      accountKey: ACCOUNT_KEY,
      replaceSki,
      platform: "web",
      friendlyName: name,
    });
    setPayload(nextPayload);
    setDeviceLimit(null);
  };

  const applySyncError = (region: AlertRegion, error: unknown) => {
    const limit = parseDeviceLimitError(error);
    if (limit) {
      setDeviceLimit(limit);
      announce("limit", limit.message, "error");
      return;
    }
    announce(region, error instanceof Error ? error.message : String(error), "error");
  };

  const finishSignIn = async (result: OAuthDialogResult) => {
    if (!billing) return;
    if (result.status === "cancelled") {
      announce("signin", "Sign-in cancelled.", "warn");
      return;
    }
    if (result.status === "error") {
      announce("signin", result.message, "error");
      return;
    }
    announce("signin", "Signed in. Registering this Outlook…", "pending");
    let token = result.token;
    if (!token) {
      const minted = await acquireUsingPartyApiToken(billing.config);
      if (minted.orgPickRequired || !minted.token) {
        announce(
          "signin",
          "Signed in, but could not open a personal billing context. Try again.",
          "error",
        );
        return;
      }
      token = minted.token;
    }
    await runOnlineSync(token);
    announce("signin", "Signed in, device registered, and license synced.", "ok");
    await refresh();
  };

  const startSignIn = (providerId: string) => {
    if (!billing) {
      announce("signin", "Set billing origin in Settings first.", "error");
      return;
    }
    // Must start the dialog in this click turn (Outlook user-gesture).
    const pending = openOAuthDialog(billing.config, providerId);
    setBusyRegion("signin");
    announce("signin", "Waiting for Google to finish — Outlook will pick it up…", "pending");
    void pending
      .then((result) => finishSignIn(result))
      .catch((error) => applySyncError("signin", error))
      .finally(() => setBusyRegion(null));
  };

  const officeSync = async () => {
    if (!billing) {
      announce("sync", "Set billing origin in Settings first.", "error");
      return;
    }
    setBusyRegion("sync");
    announce("sync", "Restoring the cached license…", "pending");
    try {
      const restored = await billing.restore(ACCOUNT_KEY);
      if (!restored) {
        announce(
          "sync",
          "No cached license. Paste a token or sign in to billing for an online sync.",
          "warn",
        );
        await refresh();
        return;
      }
      announce("sync", "Office sync restored the cached license. Assigned seats are listed below.", "ok");
      await refresh();
    } catch (error) {
      announce("sync", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusyRegion(null);
    }
  };

  const onlineSync = async (replaceSki?: string) => {
    if (!billing) {
      announce("sync", "Set billing origin in Settings first.", "error");
      return;
    }
    const blocked = onlineSyncBlockedReason(signedIn);
    if (blocked) {
      announce("sync", blocked, "warn");
      return;
    }
    const region: AlertRegion = replaceSki ? "limit" : "sync";
    setBusyRegion(region);
    announce(region, "Syncing license with billing…", "pending");
    try {
      const minted = await acquireUsingPartyApiToken(billing.config);
      if (minted.orgPickRequired || !minted.token) {
        announce("sync", "Sign in to billing first, then sync online.", "warn");
        setSignedIn(false);
        return;
      }
      await runOnlineSync(minted.token, replaceSki);
      announce(
        region,
        replaceSki ? "Device replaced and license synced." : "Device registered and license synced.",
        "ok",
      );
      await refresh();
    } catch (error) {
      if (error instanceof TwoKeyError && error.code === "unauthorized") {
        setSignedIn(false);
        announce("sync", onlineSyncBlockedReason(false) ?? "Sign in to billing first.", "warn");
        return;
      }
      applySyncError(region, error);
    } finally {
      setBusyRegion(null);
    }
  };

  const verifyPaste = async () => {
    if (!billing) {
      announce("paste", "Set billing origin in Settings first.", "error");
      return;
    }
    setBusyRegion("paste");
    announce("paste", "Verifying license token…", "pending");
    try {
      await billing.pasteLicense(pasteToken, ACCOUNT_KEY);
      announce("paste", "Token verified. Assigned seats updated from the license.", "ok");
      await refresh();
    } catch (error) {
      announce("paste", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusyRegion(null);
    }
  };

  const copyDevicePublicKey = async () => {
    setBusyRegion("device");
    announce("device", "Copying public key…", "pending");
    try {
      let json = deviceKeyJson.trim();
      if (!json) {
        const name = await persistFriendlyName();
        json = name ? encodePublicJwkForPortal(publicJwk ?? {}, name).trim() : "";
      }
      if (!json) {
        announce(
          "device",
          "No public key to copy yet. Set billing origin, then try Copy again.",
          "error",
        );
        return;
      }
      const field = document.getElementById("device-public-jwk");
      const copied = await copyTextToClipboard(
        json,
        field instanceof HTMLTextAreaElement ? field : null,
      );
      if (copied) {
        announce(
          "device",
          "Copied. Paste this JSON in the billing portal under Settings → Devices.",
          "ok",
        );
      } else {
        if (field instanceof HTMLTextAreaElement) field.select();
        announce(
          "device",
          "Clipboard is blocked in this Outlook WebView. The JSON is selected — press Ctrl+C (Cmd+C on Mac).",
          "warn",
        );
      }
      if (!validateDeviceFriendlyName(friendlyName) && billing) {
        void persistFriendlyName();
      }
    } catch (error) {
      announce(
        "device",
        error instanceof Error ? error.message : "Could not copy the public key.",
        "error",
      );
    } finally {
      setBusyRegion(null);
    }
  };

  const openPortal = () => {
    const url = resolveBillingPortalOpenUrl({
      portalUrl: settings.billingPortalUrl,
      fallbackShopUrl: billing ? shopUrl(billing.config) : "",
    });
    if (!url) {
      announce("seats", "Set billing portal URL in Settings first.", "error");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    announce("seats", "Opened the billing portal in a browser window.", "ok");
  };

  const signOut = async () => {
    setBusyRegion("sync");
    announce("sync", "Signing out…", "pending");
    try {
      if (billing) {
        await fetch(`${authBaseUrl(billing.config)}/sign-out`, {
          method: "POST",
          credentials: "include",
        }).catch(() => undefined);
        const stored = await billing.session.load(ACCOUNT_KEY);
        if (stored) {
          await billing.session.save({
            ...stored,
            accessToken: undefined,
          });
        }
        clearAuthSessionToken(billing.config);
      }
      setSignedIn(false);
      setDeviceLimit(null);
      announce("sync", "Signed out of billing. Cached license remains available for office sync.", "ok");
      await refresh();
    } catch (error) {
      announce("sync", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusyRegion(null);
    }
  };

  const regionAlert = (region: AlertRegion) =>
    alert?.region === region ? (
      <ActionAlert id={`alert-${region}`} kind={alert.kind} message={alert.message} />
    ) : null;

  return (
    <>
      <PageTitle
        title="Account & Billing"
        description="Outlook mailbox identity is separate from billing SSO. Copy this Outlook public key into the billing portal (Settings → Devices), or sign in and use Online sync to bind it automatically. Office sync only restores a cached license and lists assigned seats (no prices)."
      />

      <dl className={styles.metaGrid}>
        <dt className={styles.metaLabel}>Mailbox (host)</dt>
        <dd>{currentUserEmail ?? (isMockHost ? "you@example.com" : "Unknown")}</dd>
        <dt className={styles.metaLabel}>Billing profile</dt>
        <dd>
          {signedIn ? (payload?.payingParty.billingEmail ?? "Signed in") : "Not signed in"}
        </dd>
        <dt className={styles.metaLabel}>Billing origin</dt>
        <dd>{billingOrigin || "— (set in Settings)"}</dd>
        <dt className={styles.metaLabel}>Device</dt>
        <dd>{deviceBoundLabel(deviceBound, deviceSki)}</dd>
        <dt className={styles.metaLabel}>AI add-on</dt>
        <dd>
          <StatusBadge tone={aiOk ? "ok" : "muted"}>{aiOk ? "entitled" : "not entitled"}</StatusBadge>
        </dd>
        <dt className={styles.metaLabel}>PGP add-on</dt>
        <dd>
          <StatusBadge tone={pgpOk ? "ok" : "muted"}>{pgpOk ? "entitled" : "not entitled"}</StatusBadge>
        </dd>
      </dl>

      <Field label="Billing origin">
        <Input
          type="url"
          placeholder={DEFAULT_SETTINGS.billingOrigin ?? "https://billing.scomm.ai"}
          value={settings.billingOrigin ?? ""}
          onChange={(_, data) => updateSettings({ billingOrigin: data.value || undefined })}
        />
      </Field>

      <PageTitle title="Sign in" />
      <div className={styles.actions}>
        {providers.map((p) => (
          <Button
            key={p.id}
            appearance="primary"
            size="small"
            disabled={busyRegion === "signin"}
            onClick={() => startSignIn(p.id)}
          >
            {busyRegion === "signin"
              ? "Signing in…"
              : `Sign in with ${p.id.charAt(0).toUpperCase()}${p.id.slice(1)}`}
          </Button>
        ))}
      </div>
      {providers.length === 0 && billingOrigin ? <Note>No sign-in providers discovered.</Note> : null}
      {!billingOrigin ? <Note>Set billing origin in Settings first.</Note> : null}
      {billingOrigin.startsWith("http:") ? (
        <Note>
          This billing origin is HTTP. Outlook cannot host that in its sign-in window (error 12005),
          so Sign in opens a separate browser window instead. Prefer https://billing.scomm.ai.
        </Note>
      ) : null}
      {regionAlert("signin")}
      <div className={styles.actions}>
        <Button
          appearance="secondary"
          size="small"
          disabled={busyRegion === "sync"}
          onClick={() => void officeSync()}
        >
          {busyRegion === "sync" ? "Working…" : "Office sync"}
        </Button>
        <Button
          appearance="secondary"
          size="small"
          disabled={busyRegion === "sync" || !signedIn}
          onClick={() => void onlineSync()}
        >
          Online sync
        </Button>
        <Button
          appearance="secondary"
          size="small"
          disabled={busyRegion === "sync"}
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </div>
      {regionAlert("sync")}
      {!signedIn ? (
        <Note>
          Online sync needs a billing login. Without it, copy the public device key below into the
          portal, then paste the issued license JWT here.
        </Note>
      ) : null}

      <PageTitle
        title="This Outlook device"
        description="Name this Outlook here (1–15 characters: A–Z, 0–9, hyphens). The portal reads that name from the copied JSON — you do not type it there."
      />
      <Field label="Device name">
        <Input
          maxLength={15}
          placeholder={DEFAULT_DEVICE_NAME}
          value={friendlyName}
          onChange={(_, data) => {
            const next = data.value;
            setFriendlyName(next);
            if (publicJwk) {
              setDeviceKeyJson(encodePublicJwkForPortal(publicJwk, next));
            }
          }}
        />
      </Field>
      <Field label="Public device key">
        <Textarea id="device-public-jwk" rows={8} readOnly value={deviceKeyJson} resize="vertical" />
      </Field>
      <div className={styles.actions}>
        <Button
          appearance="secondary"
          size="small"
          disabled={busyRegion === "device"}
          onClick={() => void copyDevicePublicKey()}
        >
          {busyRegion === "device" ? "Copying…" : "Copy public key"}
        </Button>
      </div>
      {regionAlert("device")}

      {deviceLimit ? (
        <>
          <PageTitle
            title="Device limit reached"
            description={
              deviceLimit.maxDevices != null
                ? `This seat already has ${deviceLimit.maxDevices} devices. Replace one to register Outlook.`
                : deviceLimit.message
            }
          />
          <ul className={styles.list}>
            {deviceLimit.devices.map((d) => (
              <li key={d.ski}>
                {d.friendlyName ?? d.platform ?? "device"} · {d.ski.slice(0, 10)}…
                <Button
                  appearance="secondary"
                  size="small"
                  disabled={busyRegion === "limit"}
                  onClick={() => void onlineSync(d.ski)}
                >
                  Replace with this Outlook
                </Button>
              </li>
            ))}
          </ul>
          {regionAlert("limit")}
        </>
      ) : null}

      <PageTitle title="Offline license paste" />
      <Field label="License JWT">
        <Textarea
          rows={3}
          value={pasteToken}
          resize="vertical"
          onChange={(_, data) => setPasteToken(data.value)}
        />
      </Field>
      <div className={styles.actions}>
        <Button
          appearance="secondary"
          size="small"
          disabled={busyRegion === "paste"}
          onClick={() => void verifyPaste()}
        >
          {busyRegion === "paste" ? "Verifying…" : "Verify & save"}
        </Button>
      </div>
      {regionAlert("paste")}

      <PageTitle
        title="License seats"
        description="Assigned to you across personal and organization subscriptions. Buy or manage plans in the billing portal."
      />
      {payload && payload.subscriptions.length > 0 ? (
        <ul className={styles.list}>
          {payload.subscriptions.map((sub) => (
            <li key={sub.subscriptionId}>
              {sub.planName} / {sub.subscriptionStatus}
              {sub.addonCode ? ` [${sub.addonCode}]` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <Note>No assigned seats on the current license.</Note>
      )}
      <div className={styles.actions}>
        <Button appearance="secondary" size="small" onClick={openPortal}>
          Open billing portal
        </Button>
      </div>
      {regionAlert("seats")}
    </>
  );
}

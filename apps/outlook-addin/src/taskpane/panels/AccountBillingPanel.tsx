import { useCallback, useEffect, useMemo, useState } from "react";
import { shopUrl } from "@2key/browser-sdk/auth";
import {
  licenseListsSki,
  type BillingSubscription,
  type LicensePayload,
} from "@2key/browser-sdk/billing";
import { BILLING_ADDON_AI_ASSISTANT, BILLING_ADDON_PGP, licenseGrantsFeature } from "../../lib/billing-catalog";
import {
  deviceBoundLabel,
  encodePublicJwkForPortal,
  resolveBillingPortalOpenUrl,
  validateDeviceFriendlyName,
  copyTextToClipboard,
} from "../../lib/billing-account-sync";
import { createOfficeBillingClient } from "../../lib/billing-client";
import { useHostContext } from "../../lib/host-context";
import { ActionAlert, type AlertKind } from "../components/action-alert";
import { Button, Field, Input, Note, PageTitle, StatusBadge, Textarea, usePaneStyles } from "../ui/layout";

const ACCOUNT_KEY = "default";
const DEFAULT_DEVICE_NAME = "Outlook";

type AlertRegion = "sync" | "device" | "paste" | "seats";

interface RegionAlert {
  region: AlertRegion;
  kind: AlertKind;
  message: string;
}

export function AccountBillingPanel() {
  const styles = usePaneStyles();
  const { settings, isMockHost, currentUserEmail } = useHostContext();
  const [alert, setAlert] = useState<RegionAlert | null>(null);
  const [busyRegion, setBusyRegion] = useState<AlertRegion | null>(null);
  const [pasteToken, setPasteToken] = useState("");
  const [payload, setPayload] = useState<LicensePayload | null>(null);
  const [hostSeats, setHostSeats] = useState<BillingSubscription[]>([]);
  const [deviceSki, setDeviceSki] = useState<string | null>(null);
  const [deviceKeyJson, setDeviceKeyJson] = useState("");
  const [publicJwk, setPublicJwk] = useState<Record<string, unknown> | null>(null);
  const [friendlyName, setFriendlyName] = useState(DEFAULT_DEVICE_NAME);
  const [deviceBound, setDeviceBound] = useState(false);
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
      setHostSeats([]);
      setDeviceSki(null);
      setDeviceKeyJson("");
      setPublicJwk(null);
      setFriendlyName(DEFAULT_DEVICE_NAME);
      setDeviceBound(false);
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
      const restored = await billing.restore(ACCOUNT_KEY);
      setPayload(restored);
      setDeviceBound(Boolean(restored && licenseListsSki(restored, device.ski)));
      try {
        const snap = billing.normalizedEntitlements();
        setHostSeats(billing.hostSubscriptions());
        setAiOk(licenseGrantsFeature(snap.products, BILLING_ADDON_AI_ASSISTANT));
        setPgpOk(licenseGrantsFeature(snap.products, BILLING_ADDON_PGP));
      } catch {
        setHostSeats([]);
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

  const persistFriendlyName = async (): Promise<string | null> => {
    if (!billing) {
      announce("device", "Billing origin is not configured. Set VITE_BILLING_ORIGIN in .env.", "error");
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

  const officeSync = async () => {
    if (!billing) {
      announce("sync", "Billing origin is not configured. Set VITE_BILLING_ORIGIN in .env.", "error");
      return;
    }
    setBusyRegion("sync");
    announce("sync", "Restoring the cached license…", "pending");
    try {
      const restored = await billing.restore(ACCOUNT_KEY);
      if (!restored) {
        announce(
          "sync",
          "No cached license. Copy this Outlook public key into the billing portal, then paste the issued license.",
          "warn",
        );
        await refresh();
        return;
      }
      announce("sync", "Restored the cached license. Assigned seats are listed below.", "ok");
      await refresh();
    } catch (error) {
      announce("sync", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusyRegion(null);
    }
  };

  const verifyPaste = async () => {
    if (!billing) {
      announce("paste", "Billing origin is not configured. Set VITE_BILLING_ORIGIN in .env.", "error");
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
      announce("seats", "Billing portal URL is not configured. Set VITE_BILLING_PORTAL_URL in .env.", "error");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    announce("seats", "Opened the billing portal in a browser window.", "ok");
  };

  const regionAlert = (region: AlertRegion) =>
    alert?.region === region ? (
      <ActionAlert id={`alert-${region}`} kind={alert.kind} message={alert.message} />
    ) : null;

  return (
    <>
      <PageTitle
        title="Account & Billing"
        description="Outlook mailbox identity is separate from billing. Copy this Outlook public key into the billing portal (Settings → Devices), then paste the issued license here. Restore only reloads a cached license and lists assigned seats (no prices)."
      />

      <dl className={styles.metaGrid}>
        <dt className={styles.metaLabel}>Mailbox (host)</dt>
        <dd>{currentUserEmail ?? (isMockHost ? "you@example.com" : "Unknown")}</dd>
        <dt className={styles.metaLabel}>Billing profile</dt>
        <dd>{payload?.payingParty.billingEmail ?? "No license"}</dd>
        <dt className={styles.metaLabel}>Billing origin</dt>
        <dd>{billingOrigin || "— (not configured in .env)"}</dd>
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

      {!billingOrigin ? <Note>Billing origin is not configured. Set VITE_BILLING_ORIGIN in .env.</Note> : null}
      <div className={styles.actions}>
        <Button
          appearance="secondary"
          size="small"
          disabled={busyRegion === "sync"}
          onClick={() => void officeSync()}
        >
          {busyRegion === "sync" ? "Working…" : "Restore cached license"}
        </Button>
      </div>
      {regionAlert("sync")}
      <Note>
        Register this Outlook in the billing portal with the public device key below, then paste the
        issued license. Online license sync is not supported.
      </Note>

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
        description="Seats this Outlook build can use (catalog ∩ license). Linux and other JWT-only codes stay off. Buy or manage plans in the billing portal."
      />
      {hostSeats.length > 0 ? (
        <ul className={styles.list}>
          {hostSeats.map((sub) => (
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

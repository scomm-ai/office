import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { attachmentEncryptionNotice } from "@scomm-office/office";
import { ComposeSecurityControls } from "../components/ComposeSecurityControls";
import { EcdhEnvelopeControls } from "../components/EcdhEnvelopeControls";
import { useHostContext } from "../../lib/host-context";
import { Button, Divider, Field, Input, Note, PageTitle, StatusBadge, Textarea, tokens, usePaneStyles } from "../ui/layout";
import {
  ProductionPubkeyDirectory,
  extractPgpMessage,
  extractPgpSignedMessage,
  normalizeEmail,
} from "@scomm-office/pubkeys";
import { resolvePubkeyReadBaseUrl, resolvePubkeyWriteBaseUrl } from "../../lib/settings";
import { loadPgpEntitlement, PGP_ADDON_REQUIRED_MESSAGE } from "../../lib/billing-pgp";
import type { TaskPaneCryptoAction } from "../../lib/taskpane-launch";
import { decryptCurrentBody, verifyCurrentBody } from "../../lib/mail-crypto-actions";
import {
  getOfficePubkeySession,
  mskPublicKeyBytes,
  persistMsk,
  publishPgpContentKey,
  restoreOfficeVault,
  completeDeviceTransfer,
  exportVaultBackup,
  importVaultBackup,
  exportKeyPackageBackup,
  importKeyPackageBackup,
  fetchVaultInventory,
  listVaultTiles,
  syncHostedVault,
  pullHostedVault,
  type OfficePubkeySession,
} from "../../lib/pubkey-session";

type BootstrapStep =
  | "idle"
  | "create"
  | "otp-sent"
  | "unauthorized"
  | "transfer"
  | "recover"
  | "recover-otp"
  | "verified";

function enrollOtpStatus(email: string, result: unknown): string {
  const otp =
    result && typeof result === "object" && "otp" in result && typeof result.otp === "string"
      ? result.otp
      : "";
  if (otp) return `Verification code for ${email}: ${otp}`;
  return `Verification code sent to ${email}. If SMTP is off, set DEV_RETURN_OTP=1 on the local pubkey server and retry.`;
}

export function SecurityPanel({ launchAction = null }: { launchAction?: TaskPaneCryptoAction }) {
  const styles = usePaneStyles();
  const { settings, currentUserEmail, isMockHost, mailHost, message, refreshMessage, capabilities } =
    useHostContext();
  const [busy, setBusy] = useState(false);
  const pubkeyBase = resolvePubkeyReadBaseUrl(settings);
  const userEmail = currentUserEmail ?? (isMockHost ? "muzamiltest9@gmail.com" : undefined);

  const [bootstrapStep, setBootstrapStep] = useState<BootstrapStep>("idle");
  const [otpInput, setOtpInput] = useState("");
  const [bootstrapStatus, setBootstrapStatus] = useState<string | null>(null);
  const [hasPgp, setHasPgp] = useState(false);
  const [mailStatus, setMailStatus] = useState<string | null>(null);
  const [decryptedBody, setDecryptedBody] = useState<string | null>(null);
  const launchRan = useRef(false);
  const lastItemId = useRef<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [pgpEntitled, setPgpEntitled] = useState(false);
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultBackup, setVaultBackup] = useState("");
  const [vaultTiles, setVaultTiles] = useState<Array<Record<string, unknown>>>([]);
  const [showPurposeFilter, setShowPurposeFilter] = useState(false);
  const [keyPurposeFilter, setKeyPurposeFilter] = useState<"all" | "encryption" | "signing">("all");
  const [inventoryNote, setInventoryNote] = useState<string | null>(null);
  const [keyPackageJson, setKeyPackageJson] = useState("");
  const [keyPackagePass, setKeyPackagePass] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [devicesNote, setDevicesNote] = useState<string | null>(null);
  // Every path that reaches "verified" (genesis enroll+verify, device
  // transfer, recovery, or a vault restored/imported from a prior session)
  // implies the server already has this identity's MSK armed — pairing
  // itself requires an already-armed MSK (see createPairingSession in
  // @scomm-office/pubkeys). Track it so we don't invite a second, redundant
  // enrollment attempt that the server will reject with 409.
  const [directoryArmed, setDirectoryArmed] = useState(false);

  const directory = useMemo(
    () => (pubkeyBase ? new ProductionPubkeyDirectory(pubkeyBase) : null),
    [pubkeyBase],
  );

  const sessionFor = useCallback((): OfficePubkeySession | null => {
    if (!pubkeyBase) return null;
    return getOfficePubkeySession({
      readBaseUrl: pubkeyBase,
      writeBaseUrl: resolvePubkeyWriteBaseUrl(settings),
    });
  }, [pubkeyBase, settings]);

  useEffect(() => {
    const session = sessionFor();
    if (!session) return;
    setEngineReady(session.pgpEngine.available === true);
    let cancelled = false;
    void restoreOfficeVault(session).then((state) => {
      if (cancelled) return;
      if (state.restored) {
        setBootstrapStep("verified");
        setDirectoryArmed(true);
      }
      setHasPgp(state.hasPgp);
      if (session.vault.unlocked) setVaultTiles(listVaultTiles(session));
    });
    void loadPgpEntitlement(settings.billingOrigin).then((ok) => {
      if (!cancelled) setPgpEntitled(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionFor, settings.billingOrigin]);

  const handleRequestOtp = useCallback(async () => {
    if (!userEmail || !pubkeyBase) return;
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    setBootstrapStatus(null);
    try {
      let principalExists = false;
      try {
        const found = await session.client.getBestKey({
          email: normalizeEmail(userEmail),
          purpose: "encryption",
        });
        principalExists = Boolean(found);
      } catch {
        principalExists = false;
      }
      session.client.assertNoSilentMsk({
        principalExists,
        localMsk: Boolean(session.msk),
        explicitRecovery: false,
      });
      const msk = await session.crypto.generateMSK();
      if (!msk.publicKey) throw new Error("MSK public key missing");
      session.pendingMsk = msk;
      session.msk = msk;
      const result = await session.client.enrollMsk({
        email: normalizeEmail(userEmail),
        mskPublicKey: msk.publicKey,
      });
      setBootstrapStep("otp-sent");
      setBootstrapStatus(enrollOtpStatus(userEmail, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already") || message.includes("replace") || message.includes("transfer")) {
        setBootstrapStep("unauthorized");
        setBootstrapStatus("This mailbox already has a SComm identity. Transfer from another device or recover identity.");
      } else {
        setBootstrapStatus(`Could not start identity setup: ${message}`);
      }
    } finally {
      setBusy(false);
    }
  }, [userEmail, pubkeyBase, sessionFor]);

  const handleRegisterOnThisDirectory = useCallback(async () => {
    if (!userEmail || !pubkeyBase) return;
    const session = sessionFor();
    if (!session) return;
    if (!session.msk) {
      await restoreOfficeVault(session);
    }
    const publicKey = mskPublicKeyBytes(session);
    if (!publicKey) {
      setBootstrapStatus("Unlock the local Vault MSK first, then register it on this directory.");
      return;
    }
    setBusy(true);
    setBootstrapStatus(null);
    try {
      const result = await session.client.enrollMsk({
        email: normalizeEmail(userEmail),
        mskPublicKey: publicKey,
      });
      setBootstrapStep("otp-sent");
      setBootstrapStatus(enrollOtpStatus(userEmail, result));
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 0;
      const message = err instanceof Error ? err.message : String(err);
      if (status === 409 && /already has an armed msk/i.test(message)) {
        // We only manage one MSK per identity: the directory already has
        // this key armed (every path that reaches this button — genesis,
        // transfer, recovery, or a restored vault — implies that), so a
        // second enrollment is a no-op, not a failure.
        setDirectoryArmed(true);
        setBootstrapStatus("This identity is already registered on the directory — no action needed.");
        return;
      }
      setBootstrapStatus(`Could not register this identity on the directory: ${message}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, pubkeyBase, sessionFor]);

  const handleVerifyOtp = useCallback(async () => {
    if (!userEmail || !pubkeyBase || !otpInput.trim()) return;
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    setBootstrapStatus(null);
    try {
      const msk = session.msk ?? session.pendingMsk;
      if (!msk) throw new Error("Enroll an MSK before verifying OTP");
      const deviceKey = await session.crypto.generateDeviceKey({ extractable: true });
      await session.client.verifyEnroll({
        email: normalizeEmail(userEmail),
        otp: otpInput.trim(),
        mskKey: msk,
        device: {
          identityKey: deviceKey,
          publicKey: deviceKey.publicKey,
          name: "Outlook",
        },
      });
      await persistMsk(session, userEmail);
      setBootstrapStep("verified");
      setDirectoryArmed(true);
      setBootstrapStatus("SComm identity created on this device. Synchronize the Vault before creating a new encryption key.");
    } catch (err) {
      setBootstrapStatus(`OTP verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, pubkeyBase, otpInput, sessionFor]);

  const handlePublishPgp = useCallback(async () => {
    if (!userEmail) return;
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    setBootstrapStatus(null);
    try {
      await publishPgpContentKey(session, userEmail);
      setHasPgp(true);
      setBootstrapStatus("OpenPGP encryption and signing keys published to the directory.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code === "master_key_not_armed" || message.includes("No armed MSK")) {
        await handleRegisterOnThisDirectory();
        return;
      }
      setBootstrapStatus(`Publish failed: ${message} (${session.client.writeBaseUrl})`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, sessionFor, handleRegisterOnThisDirectory]);

  const handleBeginTransfer = useCallback(async () => {
    if (!userEmail) return;
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    try {
      const started = await session.client.createPairingSession({
        email: normalizeEmail(userEmail),
        deviceName: "Outlook",
        requestedTier: "full",
      });
      setPairingCode(started.pairingCode);
      setBootstrapStep("transfer");
      setBootstrapStatus("On your existing SComm device, choose Add device and enter this pairing code.");
      void session.client
        .completePairingAsNewDevice({
          email: normalizeEmail(userEmail),
          sessionId: started.sessionId,
          ephemeral: started.ephemeral,
          deviceId: started.deviceId,
        })
        .then(async ({ vrk, aek }: { vrk: Uint8Array; aek?: Uint8Array }) => {
          const { hasPgp, hasMsk } = await completeDeviceTransfer(session, userEmail, { vrk, aek });
          setHasPgp(hasPgp);
          setBootstrapStep("verified");
          setDirectoryArmed(true);
          setBootstrapStatus(
            hasMsk
              ? "Paired and synced — this device can now sign and decrypt with your identity."
              : "Paired and synced, but no signing authority was granted (limited tier) — content keys only.",
          );
        })
        .catch((err: unknown) => {
          setBootstrapStatus(`Pairing failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    } catch (err) {
      setBootstrapStatus(`Transfer failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, sessionFor]);

  const handleBeginRecovery = useCallback(async () => {
    if (!userEmail) return;
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    try {
      const msk = await session.crypto.generateMSK();
      if (!msk.publicKey) throw new Error("MSK public key missing");
      session.pendingMsk = msk;
      session.msk = msk;
      await session.client.beginIdentityRecovery({
        email: normalizeEmail(userEmail),
        mskPublicKey: msk.publicKey,
      });
      setBootstrapStep("recover-otp");
      setBootstrapStatus("Recovery creates a new Master Identity Key. Enter the email verification code.");
    } catch (err) {
      setBootstrapStatus(`Recovery failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, sessionFor]);

  const handleVerifyRecovery = useCallback(async () => {
    if (!userEmail || !otpInput.trim()) return;
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    try {
      const msk = session.msk ?? session.pendingMsk;
      if (!msk) throw new Error("Start recovery first");
      const deviceKey = await session.crypto.generateDeviceKey({ extractable: true });
      await session.client.replaceMasterSigningKey({
        email: normalizeEmail(userEmail),
        otp: otpInput.trim(),
        mskKey: msk,
        device: { identityKey: deviceKey, publicKey: deviceKey.publicKey, name: "Outlook" },
      });
      await persistMsk(session, userEmail);
      setBootstrapStep("verified");
      setDirectoryArmed(true);
      setBootstrapStatus("Identity recovered. Historical encryption keys are unavailable unless another device or ordinary-key backup exists.");
    } catch (err) {
      setBootstrapStatus(`Recovery verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, otpInput, sessionFor]);

  const handleListDevices = useCallback(async () => {
    if (!userEmail) return;
    const session = sessionFor();
    if (!session?.msk) return;
    setBusy(true);
    try {
      const listed = (await session.client.listDevices({
        email: normalizeEmail(userEmail),
        mskKey: session.msk,
      })) as { devices?: Array<{ device_id: string; active: boolean; device_name?: string }> };
      setDevicesNote(
        (listed.devices ?? [])
          .map((device) => `${device.device_name || device.device_id} (${device.active ? "active" : "revoked"})`)
          .join(" · ") || "No authorized devices yet",
      );
    } catch (err) {
      setDevicesNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [userEmail, sessionFor]);

  const handleSyncVault = useCallback(async () => {
    if (!userEmail) return;
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    setBootstrapStatus(null);
    try {
      const { hasPgp: synced } = await pullHostedVault(session, userEmail);
      setHasPgp(synced);
      if (session.vault.unlocked) setVaultTiles(listVaultTiles(session));
      setBootstrapStatus("Vault synced. Local Vault now matches the directory's latest generation.");
    } catch (err) {
      setBootstrapStatus(`Vault sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, sessionFor]);

  const handleDecrypt = useCallback(async () => {
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    setMailStatus(null);
    setDecryptedBody(null);
    try {
      console.info("[scomm-temp:decrypt-click]", {
        cachedId: message?.id ?? null,
        cachedMode: message?.mode ?? null,
        cachedSubject: message?.subject ?? null,
      });
      const result = await decryptCurrentBody({ session, mailHost });
      setDecryptedBody(result.plaintext);
      setMailStatus(result.note);
    } catch (err) {
      setMailStatus(`Decrypt failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [sessionFor, mailHost, settings, message?.id, message?.mode, message?.subject]);

  const handleVerify = useCallback(async () => {
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    setMailStatus(null);
    try {
      setMailStatus(await verifyCurrentBody({ session, mailHost }));
    } catch (err) {
      setMailStatus(`Verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [sessionFor, mailHost]);

  const handleExportVault = useCallback(async () => {
    const session = sessionFor();
    if (!session || !vaultPassphrase.trim()) return;
    setBusy(true);
    setBootstrapStatus(null);
    try {
      const json = await exportVaultBackup(session, vaultPassphrase.trim());
      setVaultBackup(json);
      setBootstrapStatus("Vault exported. Store this JSON and passphrase offline. IndexedDB can vanish.");
    } catch (err) {
      setBootstrapStatus(`Vault export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [sessionFor, vaultPassphrase]);

  const handleImportVault = useCallback(async () => {
    const session = sessionFor();
    if (!session || !vaultPassphrase.trim() || !vaultBackup.trim()) return;
    setBusy(true);
    setBootstrapStatus(null);
    try {
      await importVaultBackup(session, vaultBackup.trim(), vaultPassphrase.trim());
      const state = await restoreOfficeVault(session);
      setHasPgp(state.hasPgp);
      if (state.restored) {
        setBootstrapStep("verified");
        // Unlike the other "verified" paths, a manually-imported backup's
        // origin isn't known — it may predate this identity ever being
        // armed on the directory. Leave directoryArmed as-is: the Register
        // button stays available so this ambiguous case can still self-heal,
        // and a redundant attempt is now handled gracefully (see
        // handleRegisterOnThisDirectory).
      }
      setBootstrapStatus("Vault imported from passphrase backup.");
    } catch (err) {
      setBootstrapStatus(`Vault import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [sessionFor, vaultPassphrase, vaultBackup]);

  useEffect(() => {
    void refreshMessage("security-panel");
  }, [refreshMessage]);

  useEffect(() => {
    const nextId = message?.id ?? null;
    console.info("[scomm-temp:security-item]", {
      id: nextId,
      previousId: lastItemId.current,
      mode: message?.mode ?? null,
      subject: message?.subject ?? null,
    });
    if (lastItemId.current && lastItemId.current !== nextId) {
      setDecryptedBody(null);
      setMailStatus(null);
    }
    lastItemId.current = nextId;
  }, [message?.id, message?.mode, message?.subject]);

  const liveMode = (() => {
    try {
      return mailHost.getMode();
    } catch {
      return undefined;
    }
  })();
  const composeMode = liveMode === "compose" || message?.mode === "compose" || isMockHost;

  useEffect(() => {
    console.info("[scomm-temp:compose-mode]", {
      liveMode: liveMode ?? null,
      cachedMode: message?.mode ?? null,
      engineReady,
      composeMode,
    });
  }, [liveMode, message?.mode, engineReady, composeMode]);

  useEffect(() => {
    if (launchRan.current || !launchAction || !engineReady) return;
    launchRan.current = true;
    if (launchAction === "decrypt") void handleDecrypt();
    if (launchAction === "verify") void handleVerify();
  }, [launchAction, engineReady, handleDecrypt, handleVerify]);

  const pgpPresent = Boolean(
    extractPgpMessage(message?.bodyText) ??
      extractPgpMessage(message?.bodyHtml) ??
      extractPgpSignedMessage(message?.bodyText) ??
      extractPgpSignedMessage(message?.bodyHtml),
  );
  const attachmentNotice = isMockHost ? null : attachmentEncryptionNotice(capabilities);

  return (
    <section className={styles.stack}>
      <PageTitle title="Security" />
      <dl className={styles.metaGrid}>
        <dt className={styles.metaLabel}>Identity</dt>
        <dd>
          {bootstrapStep === "verified" ? (
            <StatusBadge tone="ok">
              Registered · Vault/MSK on this device{hasPgp ? " · OpenPGP keys published" : ""}
            </StatusBadge>
          ) : (
            <StatusBadge tone="muted">Not registered on this device</StatusBadge>
          )}
        </dd>
        <dt className={styles.metaLabel}>Mail E2EE</dt>
        <dd>
          {engineReady ? (
            <StatusBadge tone="ok">OpenPGP (openpgp.js)</StatusBadge>
          ) : (
            <StatusBadge tone="muted">OpenPGP engine unavailable</StatusBadge>
          )}
        </dd>
        <dt className={styles.metaLabel}>Directory</dt>
        <dd>{directory ? "GET /v1/keys via @scomm/pubkey" : "—"}</dd>
        <dt className={styles.metaLabel}>Pubkey server</dt>
        <dd>{pubkeyBase || "— (set in Settings)"}</dd>
        <dt className={styles.metaLabel}>ECDH envelope</dt>
        <dd>
          {settings.experimentalEncryptionEnabled ? (
            <StatusBadge tone="ok">experimental (Settings)</StatusBadge>
          ) : (
            <StatusBadge tone="muted">off</StatusBadge>
          )}
        </dd>
      </dl>

      <Divider />

      <section className={styles.stack}>
        <PageTitle title="Scomm.AI identity" />
        {!userEmail ? (
          <Note>Current user email unknown — sign in via Microsoft to set up Scomm.AI.</Note>
        ) : bootstrapStep === "idle" ? (
          <div className={styles.stack}>
            <Note>Set up Scomm.AI on this device for {userEmail}.</Note>
            <div className={styles.actions}>
              <Button appearance="primary" size="small" disabled={busy} onClick={() => void handleRequestOtp()}>
                Create Scomm.AI identity
              </Button>
              <Button appearance="secondary" size="small" disabled={busy} onClick={() => setBootstrapStep("unauthorized")}>
                I already have Scomm.AI on another device
              </Button>
            </div>
          </div>
        ) : bootstrapStep === "otp-sent" ? (
          <div className={styles.stack}>
            <Field label={`Paste the 11-character Scomm.AI code sent to ${userEmail}`}>
              <Input
                maxLength={16}
                placeholder="11-character code"
                autoComplete="one-time-code"
                spellCheck={false}
                value={otpInput}
                onChange={(_, data) => setOtpInput(data.value.replace(/[-\s]/g, ""))}
                style={{ fontFamily: tokens.fontFamilyMonospace }}
              />
            </Field>
            <div className={styles.actions}>
              <Button
                appearance="primary"
                size="small"
                disabled={busy || otpInput.replace(/[-\s]/g, "").length < 11}
                onClick={() => void handleVerifyOtp()}
              >
                Verify code
              </Button>
            </div>
          </div>
        ) : bootstrapStep === "unauthorized" ? (
          <div className={styles.stack}>
            <Note>To add this device normally, approve it from an existing SComm device.</Note>
            <div className={styles.actions}>
              <Button appearance="primary" size="small" disabled={busy} onClick={() => void handleBeginTransfer()}>
                Transfer from another SComm device
              </Button>
              <Button appearance="secondary" size="small" disabled={busy} onClick={() => setBootstrapStep("recover")}>
                Recover identity
              </Button>
            </div>
          </div>
        ) : bootstrapStep === "transfer" ? (
          <div className={styles.stack}>
            <Note>Paste this pairing code on your existing device. Outlook cannot reliably scan a camera QR.</Note>
            <Textarea readOnly value={pairingCode} rows={6} style={{ width: "100%" }} />
          </div>
        ) : bootstrapStep === "recover" ? (
          <div className={styles.stack}>
            <Note>
              Recovery creates a new Master Identity Key and retires the previous one. It does not restore
              encryption keys that existed only on lost devices.
            </Note>
            <div className={styles.actions}>
              <Button appearance="primary" size="small" disabled={busy} onClick={() => void handleBeginRecovery()}>
                Continue with recovery
              </Button>
              <Button appearance="secondary" size="small" disabled={busy} onClick={() => setBootstrapStep("unauthorized")}>
                Cancel
              </Button>
            </div>
          </div>
        ) : bootstrapStep === "recover-otp" ? (
          <div className={styles.stack}>
            <Field label={`Paste the 11-character Scomm.AI code sent to ${userEmail}`}>
              <Input
                maxLength={16}
                placeholder="11-character code"
                autoComplete="one-time-code"
                spellCheck={false}
                value={otpInput}
                onChange={(_, data) => setOtpInput(data.value.replace(/[-\s]/g, ""))}
                style={{ fontFamily: tokens.fontFamilyMonospace }}
              />
            </Field>
            <div className={styles.actions}>
              <Button appearance="primary" size="small" disabled={busy || otpInput.replace(/[-\s]/g, "").length < 11} onClick={() => void handleVerifyRecovery()}>
                Verify
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.stack}>
            <StatusBadge tone="ok">This device is authorized. Master Identity Key is protected.</StatusBadge>
            <div className={styles.actions}>
              <Button appearance="secondary" size="small" disabled={busy} onClick={() => void handleListDevices()}>
                Show devices
              </Button>
              <Button appearance="secondary" size="small" disabled={busy} onClick={() => void handleSyncVault()}>
                Sync vault
              </Button>
            </div>
            {directoryArmed ? null : (
              <div className={styles.stack}>
                <Note>
                  A restored Vault is not the same as an armed identity on this pubkey directory. If publish
                  fails with “No armed MSK”, register the existing key here, then verify the OTP.
                </Note>
                <div className={styles.actions}>
                  <Button
                    appearance="secondary"
                    size="small"
                    disabled={busy}
                    onClick={() => void handleRegisterOnThisDirectory()}
                  >
                    Register identity on this directory
                  </Button>
                </div>
              </div>
            )}
            {!hasPgp ? (
              <div className={styles.stack}>
                <div className={styles.actions}>
                  <Button
                    appearance="primary"
                    size="small"
                    disabled={busy || !engineReady || !pgpEntitled}
                    onClick={() => void handlePublishPgp()}
                  >
                    Publish OpenPGP key
                  </Button>
                </div>
                {!pgpEntitled ? <Note>{PGP_ADDON_REQUIRED_MESSAGE}</Note> : null}
              </div>
            ) : (
              <div className={styles.stack}>
                <Note>OpenPGP encryption and signing keys are in the local Vault.</Note>
                <div className={styles.actions}>
                  <Button appearance="secondary" size="small" disabled={busy || !engineReady} onClick={() => void handlePublishPgp()}>
                    Publish / repair directory keys
                  </Button>
                </div>
              </div>
            )}
            {devicesNote ? <Note>{devicesNote}</Note> : null}
          </div>
        )}
        {bootstrapStatus ? <Note>{bootstrapStatus}</Note> : null}
      </section>

      <Divider />

      <ComposeSecurityControls
        session={sessionFor()}
        userEmail={userEmail}
        engineReady={engineReady}
        composeMode={composeMode}
        pgpEntitled={pgpEntitled}
      />

      <Divider />

      <section className={styles.stack}>
        <PageTitle
          title="OpenPGP (read)"
          description="Decrypt and verify stay in this pane so plaintext is not written back to the mailbox. Compose protection is the Encrypt/Sign toggles above — they apply when you press Send. Attachments need Mailbox 1.8+. Encrypt, sign, and key publish require the paid pgp add-on."
        />
        {!pgpEntitled ? <Note>{PGP_ADDON_REQUIRED_MESSAGE}</Note> : null}
        {composeMode && attachmentNotice ? <Note>{attachmentNotice}</Note> : null}
        <div className={styles.actions}>
          <Button appearance="primary" size="small" disabled={busy || !engineReady} onClick={() => void handleDecrypt()}>
            Decrypt
          </Button>
          <Button appearance="secondary" size="small" disabled={busy || !engineReady} onClick={() => void handleVerify()}>
            Verify signature
          </Button>
        </div>
        {pgpPresent ? <Note>Current item looks like OpenPGP.</Note> : null}
        {mailStatus ? <Note>{mailStatus}</Note> : null}
        {decryptedBody ? <pre className={styles.code}>{decryptedBody}</pre> : null}
      </section>

      {settings.experimentalEncryptionEnabled ? (
        <>
          <Divider />
          <EcdhEnvelopeControls directory={directory} userEmail={userEmail} pgpEntitled={pgpEntitled} />
        </>
      ) : null}

      <Divider />

      <section className={styles.stack}>
        <PageTitle
          title="Vault keys"
          description="Tiles show the OpenPGP 64-bit Key-ID. Mailbox 1.5 task pane only — no file-save API. Copy a password-wrapped package to move a key to another device."
        />
        {vaultTiles.length === 0 ? (
          <Note>No content keys in this device Vault yet.</Note>
        ) : (
          <>
            <div className={styles.actions}>
              <Button
                appearance="secondary"
                size="small"
                onClick={() => {
                  setShowPurposeFilter((prev) => !prev);
                  setKeyPurposeFilter("all");
                }}
              >
                {showPurposeFilter ? "Hide purpose filter" : "Filter by purpose"}
              </Button>
            </div>
            {showPurposeFilter ? (
              <div className={styles.actions} role="tablist" aria-label="Filter by key purpose">
                {(
                  [
                    { value: "all", label: "All" },
                    { value: "encryption", label: "Encryption" },
                    { value: "signing", label: "Signing" },
                  ] as const
                ).map((tab) => (
                  <Button
                    key={tab.value}
                    appearance={keyPurposeFilter === tab.value ? "primary" : "secondary"}
                    size="small"
                    aria-pressed={keyPurposeFilter === tab.value}
                    onClick={() => setKeyPurposeFilter(tab.value)}
                  >
                    {tab.label}
                    {tab.value === "all"
                      ? ` (${vaultTiles.length})`
                      : ` (${vaultTiles.filter((t) => t.purpose === tab.value).length})`}
                  </Button>
                ))}
              </div>
            ) : null}
            {(() => {
              const filtered =
                !showPurposeFilter || keyPurposeFilter === "all"
                  ? vaultTiles
                  : vaultTiles.filter((tile) => tile.purpose === keyPurposeFilter);
              return filtered.length === 0 ? (
                <Note>No {keyPurposeFilter} keys in this device Vault.</Note>
              ) : (
                <div className={styles.stack}>
                  {filtered.map((tile) => (
                    <div key={String(tile.fingerprint ?? tile.locator)} className={styles.card}>
                      <div className={styles.cardHeading}>
                        <span>{String(tile.family ?? "KEY").toUpperCase()}</span>
                        <StatusBadge tone={tile.status === "active" ? "ok" : "muted"}>
                          {tile.status === "active" ? "Default" : "Historical"}
                        </StatusBadge>
                      </div>
                      <div>Key ID {String(tile.locator ?? tile.fingerprint ?? "—")}</div>
                      <div>{String(tile.algorithm ?? "")}</div>
                      {showPurposeFilter ? <div>Purpose: {String(tile.purpose ?? "—")}</div> : null}
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        )}
        {inventoryNote ? <Note>{inventoryNote}</Note> : null}
        <div className={styles.actions}>
          <Button
            appearance="secondary"
            size="small"
            disabled={busy || !userEmail}
            onClick={() => {
              const session = sessionFor();
              if (!session || !userEmail) return;
              void fetchVaultInventory(session, userEmail)
                .then((me) => {
                  const payload = me as {
                    keys?: Array<{ locator?: string }>;
                    hosted_record_ids?: string[];
                    authorized_devices?: Array<{ status?: string }>;
                  };
                  const keys = Array.isArray(payload.keys) ? payload.keys : [];
                  const local = new Set(vaultTiles.map((t) => String(t.locator ?? "")));
                  const missing = keys.filter((k) => k.locator && !local.has(k.locator));
                  const hosted = payload.hosted_record_ids?.length ?? 0;
                  const authorized = (payload.authorized_devices ?? []).some(
                    (row) => row.status === "active",
                  );
                  setInventoryNote(
                    !authorized
                      ? "This Outlook install is not an authorized device. Add this device before Sync with Scomm.AI."
                      : missing.length
                        ? `${missing.length} published keys are not on this device${hosted ? ` · ${hosted} records on Scomm.AI` : ""}`
                        : hosted
                          ? `This device has every published Key-ID · ${hosted} records on Scomm.AI`
                          : "This device has every published Key-ID.",
                  );
                })
                .catch((err) =>
                  setInventoryNote(err instanceof Error ? err.message : String(err)),
                );
            }}
          >
            Check coverage
          </Button>
          <Button
            appearance="secondary"
            size="small"
            disabled={busy || !userEmail}
            onClick={() => {
              const session = sessionFor();
              if (!session || !userEmail) return;
              setBusy(true);
              void syncHostedVault(session, userEmail)
                .then(() => {
                  setVaultTiles(listVaultTiles(session));
                  setInventoryNote("Vault synchronized with Scomm.AI.");
                })
                .catch((err) =>
                  setInventoryNote(err instanceof Error ? err.message : String(err)),
                )
                .finally(() => setBusy(false));
            }}
          >
            Sync with Scomm.AI
          </Button>
        </div>
        <Field label="Key-package password">
          <Input
            type="password"
            placeholder="key-package password"
            value={keyPackagePass}
            onChange={(_, data) => setKeyPackagePass(data.value)}
          />
        </Field>
        <Field label="Key-package JSON">
          <Textarea
            placeholder="paste a password-wrapped key package JSON"
            value={keyPackageJson}
            onChange={(_, data) => setKeyPackageJson(data.value)}
            rows={4}
            style={{ width: "100%", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 }}
          />
        </Field>
        <div className={styles.actions}>
          <Button
            appearance="secondary"
            size="small"
            disabled={busy || !keyPackagePass.trim() || vaultTiles.length === 0}
            onClick={() => {
              const session = sessionFor();
              const fp = String(vaultTiles[0]?.fingerprint ?? "");
              if (!session || !fp) return;
              void exportKeyPackageBackup(session, fp, keyPackagePass.trim())
                .then((json) => {
                  setKeyPackageJson(json);
                  void navigator.clipboard?.writeText(json);
                  setInventoryNote("Key package copied to clipboard.");
                })
                .catch((err) =>
                  setInventoryNote(err instanceof Error ? err.message : String(err)),
                );
            }}
          >
            Export key package
          </Button>
          <Button
            appearance="secondary"
            size="small"
            disabled={busy || !keyPackagePass.trim() || !keyPackageJson.trim()}
            onClick={() => {
              const session = sessionFor();
              if (!session) return;
              void importKeyPackageBackup(session, keyPackageJson.trim(), keyPackagePass.trim())
                .then(() => {
                  setVaultTiles(listVaultTiles(session));
                  setInventoryNote("Key package imported into this Vault.");
                })
                .catch((err) =>
                  setInventoryNote(err instanceof Error ? err.message : String(err)),
                );
            }}
          >
            Import key package
          </Button>
        </div>
      </section>

      <Divider />

      <section className={styles.stack}>
        <PageTitle
          title="Vault backup"
          description="This device unlocks the Vault with a secret in IndexedDB. That store can vanish (new Outlook profile, cleared cache, another browser). Export with a passphrase you choose."
        />
        <Field label="Backup passphrase">
          <Input
            type="password"
            placeholder="backup passphrase"
            value={vaultPassphrase}
            onChange={(_, data) => setVaultPassphrase(data.value)}
          />
        </Field>
        <Field label="Vault backup JSON">
          <Textarea
            placeholder="paste exported Vault JSON to restore"
            value={vaultBackup}
            onChange={(_, data) => setVaultBackup(data.value)}
            rows={6}
            style={{ width: "100%", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 }}
          />
        </Field>
        <div className={styles.actions}>
          <Button appearance="secondary" size="small" disabled={busy || !vaultPassphrase.trim()} onClick={() => void handleExportVault()}>
            Export Vault
          </Button>
          <Button appearance="secondary" size="small" disabled={busy || !vaultPassphrase.trim() || !vaultBackup.trim()} onClick={() => void handleImportVault()}>
            Import Vault
          </Button>
        </div>
      </section>
    </section>
  );
}

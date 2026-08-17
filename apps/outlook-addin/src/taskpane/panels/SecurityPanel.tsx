import { useCallback, useEffect, useMemo, useState } from "react";
import { attachmentEncryptionNotice } from "@scomm-office/office";
import { useHostContext } from "../../lib/host-context";
import {
  ProductionPubkeyDirectory,
  decodePublicMaterial,
  extractPgpMessage,
  messagePlaintext,
  normalizeEmail,
} from "@scomm-office/pubkeys";
import { collectRecipientEmails } from "../../lib/semantic-policy";
import { resolvePubkeyReadBaseUrl } from "../../lib/settings";
import {
  getOfficePubkeySession,
  persistMsk,
  publishPgpContentKey,
  restoreOfficeVault,
  exportVaultBackup,
  importVaultBackup,
  exportKeyPackageBackup,
  importKeyPackageBackup,
  fetchVaultInventory,
  listVaultTiles,
  syncHostedVault,
  vaultPgpPrivateKeys,
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

export function SecurityPanel() {
  const { settings, currentUserEmail, isMockHost, mailHost, message, refreshMessage, capabilities } =
    useHostContext();
  const [busy, setBusy] = useState(false);
  const pubkeyBase = resolvePubkeyReadBaseUrl(settings);
  const userEmail = currentUserEmail ?? (isMockHost ? "you@example.com" : undefined);

  const [bootstrapStep, setBootstrapStep] = useState<BootstrapStep>("idle");
  const [otpInput, setOtpInput] = useState("");
  const [bootstrapStatus, setBootstrapStatus] = useState<string | null>(null);
  const [hasPgp, setHasPgp] = useState(false);
  const [mailStatus, setMailStatus] = useState<string | null>(null);
  const [decryptedBody, setDecryptedBody] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultBackup, setVaultBackup] = useState("");
  const [vaultTiles, setVaultTiles] = useState<Array<Record<string, unknown>>>([]);
  const [inventoryNote, setInventoryNote] = useState<string | null>(null);
  const [keyPackageJson, setKeyPackageJson] = useState("");
  const [keyPackagePass, setKeyPackagePass] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [devicesNote, setDevicesNote] = useState<string | null>(null);

  const directory = useMemo(
    () => (pubkeyBase ? new ProductionPubkeyDirectory(pubkeyBase) : null),
    [pubkeyBase],
  );

  const sessionFor = useCallback((): OfficePubkeySession | null => {
    if (!pubkeyBase) return null;
    return getOfficePubkeySession({
      readBaseUrl: pubkeyBase,
      writeBaseUrl: settings.pubkeyWriteBaseUrl || pubkeyBase,
    });
  }, [pubkeyBase, settings.pubkeyWriteBaseUrl]);

  useEffect(() => {
    const session = sessionFor();
    if (!session) return;
    setEngineReady(session.pgpEngine.available === true);
    let cancelled = false;
    void restoreOfficeVault(session).then((state) => {
      if (cancelled) return;
      if (state.restored) setBootstrapStep("verified");
      setHasPgp(state.hasPgp);
      if (session.vault.unlocked) setVaultTiles(listVaultTiles(session));
    });
    return () => {
      cancelled = true;
    };
  }, [sessionFor]);

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
      await session.client.enrollMsk({
        email: normalizeEmail(userEmail),
        mskPublicKey: msk.publicKey,
      });
      setBootstrapStep("otp-sent");
      setBootstrapStatus(`Verification code sent to ${userEmail}.`);
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
      setBootstrapStatus("OpenPGP content key published.");
    } catch (err) {
      setBootstrapStatus(`Publish failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, sessionFor]);

  const handleBeginTransfer = useCallback(async () => {
    if (!userEmail) return;
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    try {
      const started = await session.client.beginDeviceEnrollment({
        email: normalizeEmail(userEmail),
      });
      setPairingCode(started.pairingCode ?? JSON.stringify(started.qr ?? {}));
      setBootstrapStep("transfer");
      setBootstrapStatus("On your existing SComm device, choose Add device and paste this pairing code.");
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

  const handleEncrypt = useCallback(async () => {
    if (!userEmail) return;
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    setMailStatus(null);
    try {
      const current = message ?? (await mailHost.getCurrentMessage());
      const recipients = collectRecipientEmails(current);
      const emails = [...new Set([...recipients, userEmail].map((value) => normalizeEmail(value)))];
      const missing: string[] = [];
      const publicKeys: Uint8Array[] = [];
      for (const email of emails) {
        try {
          const selected = await session.client.getBestKey({
            email,
            purpose: "encryption",
          });
          const material = selected?.public_material as string | undefined;
          if (!material) {
            missing.push(email);
            continue;
          }
          publicKeys.push(decodePublicMaterial(material));
        } catch {
          missing.push(email);
        }
      }
      if (missing.length > 0) {
        throw new Error(`No OpenPGP encryption key for: ${missing.join(", ")}`);
      }
      const plaintext = messagePlaintext(current);
      if (!plaintext.trim()) {
        throw new Error("Message body is empty");
      }
      const ciphertext = await session.pgpEngine.encrypt({
        plaintext,
        recipientPublicKeys: publicKeys,
      });
      const armored = new TextDecoder().decode(ciphertext);
      await mailHost.setBody({ text: armored });
      await refreshMessage();
      const notice = isMockHost ? null : attachmentEncryptionNotice(capabilities);
      const leftover =
        notice ??
        (current.attachments && current.attachments.length > 0
          ? "Attachments were not encrypted."
          : null);
      setMailStatus(
        leftover
          ? `Encrypted body for ${emails.join(", ")}. ${leftover}`
          : `Encrypted for ${emails.join(", ")}.`,
      );
    } catch (err) {
      setMailStatus(`Encrypt failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, sessionFor, message, mailHost, refreshMessage, capabilities, isMockHost]);

  const handleDecrypt = useCallback(async () => {
    const session = sessionFor();
    if (!session) return;
    setBusy(true);
    setMailStatus(null);
    setDecryptedBody(null);
    try {
      if (!session.vault.unlocked) {
        const restored = await restoreOfficeVault(session);
        if (!restored.restored) {
          throw new Error("Unlock the Vault (enroll MSK) before decrypting");
        }
      }
      const current = message ?? (await mailHost.getCurrentMessage());
      const armored = extractPgpMessage(current.bodyText) ?? extractPgpMessage(current.bodyHtml);
      if (!armored) {
        throw new Error("No OpenPGP message in the current item");
      }
      const keys = vaultPgpPrivateKeys(session);
      if (keys.length === 0) {
        throw new Error("Vault has no OpenPGP private key");
      }
      let lastError: unknown;
      for (const privateKey of keys) {
        try {
          const plain = await session.pgpEngine.decrypt({ ciphertext: armored, privateKey });
          setDecryptedBody(new TextDecoder().decode(plain));
          setMailStatus("Decrypted with a Vault OpenPGP key.");
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("No Vault key decrypted this message");
    } catch (err) {
      setMailStatus(`Decrypt failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [sessionFor, message, mailHost]);

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
      if (state.restored) setBootstrapStep("verified");
      setBootstrapStatus("Vault imported from passphrase backup.");
    } catch (err) {
      setBootstrapStatus(`Vault import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [sessionFor, vaultPassphrase, vaultBackup]);

  const composeMode = message?.mode === "compose" || isMockHost;
  const pgpPresent = Boolean(
    extractPgpMessage(message?.bodyText) ?? extractPgpMessage(message?.bodyHtml),
  );
  const attachmentNotice = isMockHost ? null : attachmentEncryptionNotice(capabilities);

  return (
    <section>
      <h2>Security</h2>
      <dl className="meta-grid">
        <dt>Mail E2EE</dt>
        <dd>
          {engineReady ? (
            <span className="status ok">OpenPGP (openpgp.js)</span>
          ) : (
            <span className="status muted">OpenPGP engine unavailable</span>
          )}
        </dd>
        <dt>Directory</dt>
        <dd>{directory ? "GET /v1/keys via @scomm/pubkey" : "—"}</dd>
        <dt>Pubkey server</dt>
        <dd>{pubkeyBase || "— (set in Settings)"}</dd>
      </dl>

      <section>
        <h2>SComm identity</h2>
        {!userEmail ? (
          <p className="note">Current user email unknown — sign in via Microsoft to set up SComm.</p>
        ) : bootstrapStep === "idle" ? (
          <div className="actions">
            <p className="note">Set up SComm on this device for {userEmail}.</p>
            <button type="button" className="primary" disabled={busy} onClick={() => void handleRequestOtp()}>
              Create SComm identity
            </button>
            <button type="button" disabled={busy} onClick={() => setBootstrapStep("unauthorized")}>
              I already have SComm on another device
            </button>
          </div>
        ) : bootstrapStep === "otp-sent" ? (
          <div className="actions">
            <p className="note">Paste the 11-character Scomm.AI code sent to {userEmail}:</p>
            <input
              type="text"
              maxLength={16}
              placeholder="11-character code"
              autoComplete="one-time-code"
              spellCheck={false}
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/[-\s]/g, ""))}
              style={{ padding: "4px 8px", fontSize: "16px", width: "220px", marginBottom: "8px", fontFamily: "monospace" }}
            />
            <button
              type="button"
              className="primary"
              disabled={busy || otpInput.replace(/[-\s]/g, "").length < 11}
              onClick={() => void handleVerifyOtp()}
            >
              Verify code
            </button>
          </div>
        ) : bootstrapStep === "unauthorized" ? (
          <div className="actions">
            <p className="note">To add this device normally, approve it from an existing SComm device.</p>
            <button type="button" className="primary" disabled={busy} onClick={() => void handleBeginTransfer()}>
              Transfer from another SComm device
            </button>
            <button type="button" disabled={busy} onClick={() => setBootstrapStep("recover")}>
              Recover identity
            </button>
          </div>
        ) : bootstrapStep === "transfer" ? (
          <div className="actions">
            <p className="note">Paste this pairing code on your existing device. Outlook cannot reliably scan a camera QR.</p>
            <textarea readOnly value={pairingCode} rows={6} style={{ width: "100%" }} />
          </div>
        ) : bootstrapStep === "recover" ? (
          <div className="actions">
            <p className="note">
              Recovery creates a new Master Identity Key and retires the previous one. It does not restore
              encryption keys that existed only on lost devices.
            </p>
            <button type="button" className="primary" disabled={busy} onClick={() => void handleBeginRecovery()}>
              Continue with recovery
            </button>
            <button type="button" disabled={busy} onClick={() => setBootstrapStep("unauthorized")}>
              Cancel
            </button>
          </div>
        ) : bootstrapStep === "recover-otp" ? (
          <div className="actions">
            <p className="note">Paste the 11-character Scomm.AI code sent to {userEmail}:</p>
            <input
              type="text"
              maxLength={16}
              placeholder="11-character code"
              autoComplete="one-time-code"
              spellCheck={false}
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/[-\s]/g, ""))}
              style={{ padding: "4px 8px", fontSize: "16px", width: "220px", marginBottom: "8px", fontFamily: "monospace" }}
            />
            <button type="button" className="primary" disabled={busy || otpInput.replace(/[-\s]/g, "").length < 11} onClick={() => void handleVerifyRecovery()}>
              Verify
            </button>
          </div>
        ) : (
          <div className="actions">
            <p className="note status ok">This device is authorized. Master Identity Key is protected.</p>
            <button type="button" disabled={busy} onClick={() => void handleListDevices()}>
              Show devices
            </button>
            {!hasPgp ? (
              <button type="button" className="primary" disabled={busy || !engineReady} onClick={() => void handlePublishPgp()}>
                Publish OpenPGP key
              </button>
            ) : (
              <p className="note">OpenPGP encryption key is in the local Vault and the directory.</p>
            )}
            {devicesNote ? <p className="note">{devicesNote}</p> : null}
          </div>
        )}
        {bootstrapStatus ? <p className="note">{bootstrapStatus}</p> : null}
      </section>

      <section>
        <h2>Message encryption</h2>
        <p className="note">
          Body-only OpenPGP (armored). Recipients need a published pgp key. Your address is
          included so Sent items can decrypt. Attachments and S/MIME are not in this slice.
        </p>
        {composeMode && attachmentNotice ? <p className="note">{attachmentNotice}</p> : null}
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={busy || !engineReady || !hasPgp || !composeMode}
            onClick={() => void handleEncrypt()}
          >
            Encrypt body
          </button>
          <button type="button" disabled={busy || !engineReady || !hasPgp} onClick={() => void handleDecrypt()}>
            Decrypt body
          </button>
        </div>
        {pgpPresent ? <p className="note">Current item looks like an OpenPGP message.</p> : null}
        {mailStatus ? <p className="note">{mailStatus}</p> : null}
        {decryptedBody ? <pre className="code-block">{decryptedBody}</pre> : null}
      </section>

      <section>
        <h2>Vault keys</h2>
        <p className="note">
          Tiles show the OpenPGP 64-bit Key-ID. Mailbox 1.5 task pane only — no file-save API.
          Copy a password-wrapped package to move a key to another device.
        </p>
        {vaultTiles.length === 0 ? (
          <p className="note">No content keys in this device Vault yet.</p>
        ) : (
          vaultTiles.map((tile) => (
            <div key={String(tile.fingerprint ?? tile.locator)} className="note" style={{ border: "1px solid #ccc", padding: 8, marginBottom: 8 }}>
              <strong>{String(tile.family ?? "KEY").toUpperCase()}</strong>
              {tile.status === "active" ? " — DEFAULT" : " — HISTORICAL"}
              <div>Key ID {String(tile.locator ?? tile.fingerprint ?? "—")}</div>
              <div>{String(tile.algorithm ?? "")}</div>
            </div>
          ))
        )}
        {inventoryNote ? <p className="note">{inventoryNote}</p> : null}
        <div className="actions">
          <button
            type="button"
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
          </button>
          <button
            type="button"
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
          </button>
        </div>
        <input
          type="password"
          placeholder="key-package password"
          value={keyPackagePass}
          onChange={(e) => setKeyPackagePass(e.target.value)}
          style={{ padding: "4px 8px", fontSize: "16px", width: "100%", marginBottom: "8px" }}
        />
        <textarea
          placeholder="paste a password-wrapped key package JSON"
          value={keyPackageJson}
          onChange={(e) => setKeyPackageJson(e.target.value)}
          rows={4}
          style={{ width: "100%", fontFamily: "monospace", fontSize: "12px", marginBottom: "8px" }}
        />
        <div className="actions">
          <button
            type="button"
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
          </button>
          <button
            type="button"
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
          </button>
        </div>
      </section>

      <section>
        <h2>Vault backup</h2>
        <p className="note">
          This device unlocks the Vault with a secret in IndexedDB. That store can vanish (new
          Outlook profile, cleared cache, another browser). Export with a passphrase you choose.
        </p>
        <input
          type="password"
          placeholder="backup passphrase"
          value={vaultPassphrase}
          onChange={(e) => setVaultPassphrase(e.target.value)}
          style={{ padding: "4px 8px", fontSize: "16px", width: "100%", marginBottom: "8px" }}
        />
        <textarea
          placeholder="paste exported Vault JSON to restore"
          value={vaultBackup}
          onChange={(e) => setVaultBackup(e.target.value)}
          rows={6}
          style={{ width: "100%", fontFamily: "monospace", fontSize: "12px", marginBottom: "8px" }}
        />
        <div className="actions">
          <button type="button" disabled={busy || !vaultPassphrase.trim()} onClick={() => void handleExportVault()}>
            Export Vault
          </button>
          <button type="button" disabled={busy || !vaultPassphrase.trim() || !vaultBackup.trim()} onClick={() => void handleImportVault()}>
            Import Vault
          </button>
        </div>
      </section>
    </section>
  );
}

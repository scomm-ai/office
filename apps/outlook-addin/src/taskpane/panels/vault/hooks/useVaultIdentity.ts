import { useCallback, useEffect, useState } from "react";
import { normalizeEmail } from "@scomm-office/pubkeys";
import { loadPgpEntitlement } from "../../../../lib/billing-pgp";
import {
  awaitDevicePairing,
  checkRecoveryEnvelope,
  ensureDeviceKey,
  publishPgpContentKey,
  persistMsk,
  requestRecoveryCodeOtp as requestRecoveryCodeOtpApi,
  restoreFromRecoveryCode,
  restoreOfficeVault,
  saveRecoveryEnvelope,
  startDevicePairing,
  type OfficePubkeySession,
  type PgpKeyPurpose,
} from "../../../../lib/pubkey-session";

export type IdentityStatus =
  | "idle"
  | "otp-sent"
  | "unauthorized"
  | "recovery-code"
  | "transfer"
  | "recover"
  | "recover-otp"
  | "verified";

/** Lightweight, read-only "does any identity exist for this email" probe — same signal `requestOtp` uses for its silent-MSK guard. */
async function probeIdentityExists(
  session: OfficePubkeySession,
  userEmail: string,
): Promise<boolean> {
  try {
    const found = await session.client.getBestKey({
      email: normalizeEmail(userEmail),
      purpose: "encryption",
    });
    return Boolean(found);
  } catch {
    return false;
  }
}

function enrollOtpStatus(email: string, result: unknown): string {
  const otp =
    result && typeof result === "object" && "otp" in result && typeof result.otp === "string"
      ? result.otp
      : "";
  if (otp) return `Verification code for ${email}: ${otp}`;
  return `Verification code sent to ${email}. If SMTP is off`;
}

/**
 * Identity/vault bootstrap state machine: create-or-restore the Scomm.AI
 * identity on this device, verify by email OTP, publish OpenPGP keys, or
 * transfer/recover an existing identity. Extracted from the pre-redesign
 * VaultPanel so screens can consume it without owning ~10 useStates each.
 */
export function useVaultIdentity(
  session: OfficePubkeySession | null,
  userEmail: string | undefined,
  billingOrigin: string | undefined,
) {
  const [status, setStatus] = useState<IdentityStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [otpInput, setOtpInputState] = useState("");
  const [hasPgp, setHasPgp] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [pgpEntitled, setPgpEntitled] = useState(false);
  const [directoryArmed, setDirectoryArmed] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  // null = not checked yet. Whether *any* identity already exists on the
  // server for this email, checked as soon as we know there's no local
  // vault — drives whether SetupIntroScreen offers "I already have an
  // identity on another device" at all (a genuinely first-time user has
  // nothing to pair with or recover, so that option shouldn't be shown).
  const [identityExists, setIdentityExists] = useState<boolean | null>(null);
  // null = not checked yet. Decides which of the two mutually-exclusive
  // "no local vault, but this identity exists elsewhere" screens to show:
  // recovery-code entry (true) vs. "recover from another device" (false).
  const [hasRecoveryEnvelope, setHasRecoveryEnvelope] = useState<boolean | null>(null);
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  // Set once by setupRecoveryCode(); shown exactly once, then dismissed —
  // never persisted here or anywhere else.
  const [recoveryCodeResult, setRecoveryCodeResult] = useState<string | null>(null);
  // True only right after a publish attempt genuinely failed (not the
  // "master_key_not_armed" retry path) — drives whether Settings shows a
  // "repair" action or just a plain "Published" status.
  const [publishFailed, setPublishFailed] = useState(false);

  const setOtpInput = useCallback(
    (value: string) => setOtpInputState(value.replace(/[-\s]/g, "")),
    [],
  );

  const refreshFromVault = useCallback(async () => {
    if (!session) return;
    const state = await restoreOfficeVault(session);
    if (state.restored) {
      setStatus("verified");
      setDirectoryArmed(true);
    }
    setHasPgp(state.hasPgp);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    setEngineReady(session.pgpEngine.available === true);
    let cancelled = false;
    void restoreOfficeVault(session).then((state) => {
      if (cancelled) return;
      if (state.restored) {
        setStatus("verified");
        setDirectoryArmed(true);
      } else if (userEmail) {
        // No local vault — find out up front whether this is a genuinely
        // first-time user. If an identity already exists remotely, this is
        // NOT a "create a new vault" situation — skip straight past
        // SetupIntroScreen into the same Case 1/2 recovery branch
        // requestOtp's catch would otherwise only discover reactively.
        void probeIdentityExists(session, userEmail).then(async (exists) => {
          if (cancelled) return;
          setIdentityExists(exists);
          if (!exists) return;
          let recoveryExists = false;
          try {
            recoveryExists = await checkRecoveryEnvelope(session, userEmail);
          } catch {
            recoveryExists = false;
          }
          if (cancelled) return;
          setHasRecoveryEnvelope(recoveryExists);
          setStatus(recoveryExists ? "recovery-code" : "unauthorized");
          setStatusMessage(
            recoveryExists
              ? "This mailbox already has an identity, and a recovery code is set up for it."
              : "This mailbox already has an identity. Approve this device from one you've already set up.",
          );
        });
      }
      setHasPgp(state.hasPgp);
    });
    void loadPgpEntitlement(billingOrigin).then((ok) => {
      if (!cancelled) setPgpEntitled(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [session, billingOrigin, userEmail]);

  const requestOtp = useCallback(async () => {
    if (!userEmail || !session) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      const principalExists =
        identityExists ?? (await probeIdentityExists(session, userEmail));
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
      setStatus("otp-sent");
      setStatusMessage(enrollOtpStatus(userEmail, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already") || message.includes("replace") || message.includes("transfer")) {
        // Case 1 vs Case 2: a recovery-code envelope on the server means this
        // identity's *existing* vault can be restored directly; without one,
        // the only vault-preserving path is pairing with another device.
        let recoveryExists = false;
        try {
          recoveryExists = await checkRecoveryEnvelope(session, userEmail);
        } catch {
          recoveryExists = false;
        }
        setHasRecoveryEnvelope(recoveryExists);
        setStatus(recoveryExists ? "recovery-code" : "unauthorized");
        setStatusMessage(
          recoveryExists
            ? "This mailbox already has an identity, and a recovery code is set up for it."
            : "This mailbox already has an identity. Approve this device from one you've already set up.",
        );
      } else {
        setStatusMessage(`Could not start identity setup: ${message}`);
      }
    } finally {
      setBusy(false);
    }
  }, [userEmail, session, identityExists]);

  const registerOnDirectory = useCallback(async () => {
    if (!userEmail || !session) return;
    if (!session.msk) {
      await restoreOfficeVault(session);
    }
    const publicKey =
      session.msk?.publicKey && session.msk.publicKey.length > 0 ? session.msk.publicKey : null;
    if (!publicKey) {
      setStatusMessage("Unlock the local Vault MSK first, then register it on this directory.");
      return;
    }
    setBusy(true);
    setStatusMessage(null);
    try {
      const result = await session.client.enrollMsk({
        email: normalizeEmail(userEmail),
        mskPublicKey: publicKey,
      });
      setStatus("otp-sent");
      setStatusMessage(enrollOtpStatus(userEmail, result));
    } catch (err) {
      const httpStatus = err && typeof err === "object" && "status" in err ? Number(err.status) : 0;
      const message = err instanceof Error ? err.message : String(err);
      if (httpStatus === 409 && /already has an armed msk/i.test(message)) {
        setDirectoryArmed(true);
        setStatusMessage("This identity is already registered on the directory — no action needed.");
        return;
      }
      setStatusMessage(`Could not register this identity on the directory: ${message}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, session]);

  const verifyOtp = useCallback(async () => {
    if (!userEmail || !session || !otpInput.trim()) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      const msk = session.msk ?? session.pendingMsk;
      if (!msk) throw new Error("Enroll an MSK before verifying OTP");
      const deviceKey = await ensureDeviceKey(session);
      await session.client.verifyEnroll({
        email: normalizeEmail(userEmail),
        otp: otpInput.trim(),
        mskKey: msk,
        device: { identityKey: deviceKey, publicKey: deviceKey.publicKey, name: "Outlook" },
      });
      await persistMsk(session, userEmail);
      setStatus("verified");
      setDirectoryArmed(true);
      setStatusMessage("SComm identity created on this device. Synchronize the Vault before creating a new encryption key.");
    } catch (err) {
      setStatusMessage(`OTP verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, session, otpInput]);

  /** Resolves true once the requested purpose(s) actually reached the directory. */
  const publishPgp = useCallback(
    async (purposes?: PgpKeyPurpose[]): Promise<boolean> => {
      if (!userEmail || !session) return false;
      setBusy(true);
      setStatusMessage(null);
      try {
        await publishPgpContentKey(session, userEmail, purposes);
        if (!purposes || purposes.includes("encryption")) setHasPgp(true);
        setStatusMessage(
          !purposes
            ? "OpenPGP encryption and signing keys published to the directory."
            : `OpenPGP ${purposes.join(" and ")} key published to the directory.`,
        );
        setPublishFailed(false);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code =
          err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
        if (code === "master_key_not_armed" || message.includes("No armed MSK")) {
          await registerOnDirectory();
          return false;
        }
        setStatusMessage(`Publish failed: ${message} (${session.client.writeBaseUrl})`);
        setPublishFailed(true);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [userEmail, session, registerOnDirectory],
  );

  const beginTransfer = useCallback(async () => {
    if (!userEmail || !session) return;
    setBusy(true);
    try {
      const started = await startDevicePairing(session, userEmail);
      setPairingCode(started.pairingCode);
      setStatus("transfer");
      setStatusMessage("On your existing SComm device, choose Approve a new device and enter this pairing code.");
      void awaitDevicePairing(session, userEmail, started)
        .then(({ hasPgp: synced, hasMsk }) => {
          setHasPgp(synced);
          setStatus("verified");
          setDirectoryArmed(true);
          setStatusMessage(
            hasMsk
              ? "Paired and synced — this device can now sign and decrypt with your identity."
              : "Paired and synced, but no signing authority was granted (limited tier) — content keys only.",
          );
        })
        .catch((err: unknown) => {
          setStatusMessage(`Pairing failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    } catch (err) {
      setStatusMessage(`Transfer failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, session]);

  const beginRecovery = useCallback(async () => {
    if (!userEmail || !session) return;
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
      setStatus("recover-otp");
      setStatusMessage("Recovery issues a new identity key and retires the old one. Enter the email verification code to continue.");
    } catch (err) {
      setStatusMessage(`Recovery failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, session]);

  const verifyRecovery = useCallback(async () => {
    if (!userEmail || !session || !otpInput.trim()) return;
    setBusy(true);
    try {
      const msk = session.msk ?? session.pendingMsk;
      if (!msk) throw new Error("Start recovery first");
      const deviceKey = await ensureDeviceKey(session);
      await session.client.replaceMasterSigningKey({
        email: normalizeEmail(userEmail),
        otp: otpInput.trim(),
        mskKey: msk,
        device: { identityKey: deviceKey, publicKey: deviceKey.publicKey, name: "Outlook" },
      });
      await persistMsk(session, userEmail);
      setStatus("verified");
      setDirectoryArmed(true);
      setHasPgp(false);
      setStatusMessage("Identity recovered with a new key. Mail encrypted under your previous identity is no longer readable — publish a new OpenPGP key to resume sending and receiving encrypted mail.");
    } catch (err) {
      setStatusMessage(`Recovery verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, session, otpInput]);

  /** Entry point for "I already have an identity on another device" — same Case 1/2 check as requestOtp's catch. */
  const goUnauthorized = useCallback(async () => {
    setOtpInputState("");
    setStatusMessage(null);
    if (!userEmail || !session) {
      setStatus("unauthorized");
      return;
    }
    setBusy(true);
    try {
      const recoveryExists = await checkRecoveryEnvelope(session, userEmail);
      setHasRecoveryEnvelope(recoveryExists);
      setStatus(recoveryExists ? "recovery-code" : "unauthorized");
    } catch {
      setHasRecoveryEnvelope(false);
      setStatus("unauthorized");
    } finally {
      setBusy(false);
    }
  }, [userEmail, session]);

  const goRecoverConfirm = useCallback(() => {
    setOtpInputState("");
    setRecoveryCodeInput("");
    setStatusMessage(null);
    setStatus("recover");
  }, []);

  const requestRecoveryCodeOtp = useCallback(async () => {
    if (!userEmail || !session) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      await requestRecoveryCodeOtpApi(session, userEmail);
      setStatusMessage(`Verification code sent to ${userEmail}. Enter it below along with your recovery code.`);
    } catch (err) {
      setStatusMessage(`Could not send verification code: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, session]);

  const setRecoveryCode = useCallback(
    (value: string) => setRecoveryCodeInput(value),
    [],
  );

  /** Case 1's primary action: restore the *existing* vault from the recovery-code envelope. */
  const submitRecoveryCode = useCallback(async () => {
    if (!userEmail || !session || !otpInput.trim() || !recoveryCodeInput.trim()) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      const result = await restoreFromRecoveryCode(
        session,
        userEmail,
        otpInput.trim(),
        recoveryCodeInput.trim(),
      );
      setStatus("verified");
      setDirectoryArmed(true);
      setHasPgp(result.hasPgp);
      setStatusMessage("Vault restored from your recovery code.");
    } catch (err) {
      setStatusMessage(`Recovery failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, session, otpInput, recoveryCodeInput]);

  /** The "create it" half of Case 1 — without this, hasRecoveryEnvelope can never be true. */
  const setupRecoveryCode = useCallback(async () => {
    if (!userEmail || !session) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      const code = await saveRecoveryEnvelope(session, userEmail);
      setRecoveryCodeResult(code);
      setStatusMessage("Recovery code created. Save it now — it won't be shown again.");
    } catch (err) {
      setStatusMessage(`Could not set up a recovery code: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, session]);

  const dismissRecoveryCode = useCallback(() => setRecoveryCodeResult(null), []);

  return {
    status,
    busy,
    statusMessage,
    otpInput,
    setOtpInput,
    hasPgp,
    engineReady,
    pgpEntitled,
    directoryArmed,
    publishFailed,
    pairingCode,
    identityExists,
    hasRecoveryEnvelope,
    recoveryCodeInput,
    setRecoveryCode,
    recoveryCodeResult,
    setupRecoveryCode,
    dismissRecoveryCode,
    requestOtp,
    registerOnDirectory,
    verifyOtp,
    publishPgp,
    beginTransfer,
    beginRecovery,
    verifyRecovery,
    goUnauthorized,
    goRecoverConfirm,
    requestRecoveryCodeOtp,
    submitRecoveryCode,
    refreshFromVault,
  };
}

export type UseVaultIdentityResult = ReturnType<typeof useVaultIdentity>;

import { useCallback, useEffect, useState } from "react";
import { createEmailIdentity } from "@scomm-office/identity";
import { HttpPublicKeyDirectory, resolveRecipientKeys, resolveSenderKeys } from "@scomm-office/pubkeys";
import { DevMemoryKeyStore } from "@scomm-office/storage";
import type { PublicKeyRecord } from "@scomm-office/protocol";
import { useHostContext } from "../../lib/host-context";
import { collectRecipientEmails } from "../../lib/semantic-policy";
import { formatAddresses } from "../../lib/settings";

const devKeyStore = new DevMemoryKeyStore();

interface KeyStatus {
  email: string;
  status: "loading" | "found" | "missing" | "error";
  count?: number;
  error?: string;
}

export function IdentityPanel() {
  const { message, settings, isMockHost, currentUserEmail, capabilities } = useHostContext();
  const [senderStatus, setSenderStatus] = useState<KeyStatus | null>(null);
  const [recipientStatuses, setRecipientStatuses] = useState<KeyStatus[]>([]);
  const [publishState, setPublishState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const userEmail = currentUserEmail ?? (isMockHost ? "you@example.com" : undefined);
  const pubkeyBase = settings.pubkeyServerUrl ?? settings.scommServerUrl ?? "http://localhost:8787";
  const directory = new HttpPublicKeyDirectory(pubkeyBase);

  const refreshKeys = useCallback(async () => {
    if (!message) {
      return;
    }

    const senderEmail = message.from?.emailAddress;
    if (senderEmail) {
      setSenderStatus({ email: senderEmail, status: "loading" });
      try {
        const keys = await resolveSenderKeys(directory, senderEmail);
        setSenderStatus({
          email: senderEmail,
          status: keys.length > 0 ? "found" : "missing",
          count: keys.length,
        });
      } catch (error) {
        setSenderStatus({
          email: senderEmail,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      setSenderStatus(null);
    }

    const recipients = collectRecipientEmails(message, userEmail);
    if (message.mode !== "compose" || recipients.length === 0) {
      setRecipientStatuses([]);
      return;
    }

    const statuses: KeyStatus[] = [];
    for (const email of recipients) {
      try {
        const keys = await resolveRecipientKeys(directory, email);
        statuses.push({
          email,
          status: keys.length > 0 ? "found" : "missing",
          count: keys.length,
        });
      } catch (error) {
        statuses.push({
          email,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    setRecipientStatuses(statuses);
  }, [directory, message, userEmail]);

  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);

  const publishDevKey = async () => {
    if (!userEmail) {
      setPublishState("Current user email unknown — cannot publish dev key.");
      return;
    }
    setBusy(true);
    setPublishState(null);
    try {
      const pair = await devKeyStore.generate({ algorithm: "Ed25519", purpose: "signing" });
      const identity = createEmailIdentity(userEmail);
      const record: PublicKeyRecord = {
        version: 1,
        identity: { type: "email", value: identity.value },
        keyId: pair.keyId,
        algorithm: pair.algorithm,
        publicKey: pair.publicKey,
        encoding: pair.encoding,
        purpose: pair.purpose,
        state: "active",
        trust: "directory-asserted",
        createdAt: new Date().toISOString(),
        metadata: { source: "dev-console", note: "DevMemoryKeyStore fake key" },
      };
      await directory.setKey(record);
      setPublishState(`Published dev signing key ${pair.keyId} for ${userEmail}`);
      await refreshKeys();
    } catch (error) {
      setPublishState(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Identity</h2>
      <dl className="meta-grid">
        <dt>Current user</dt>
        <dd>{userEmail ?? "Unknown (Outlook profile not exposed in MVP)"}</dd>
        <dt>Pubkey server</dt>
        <dd>{pubkeyBase}</dd>
      </dl>

      <section>
        <h2>Sender keys</h2>
        {!message?.from ? (
          <p className="empty">No sender on current message.</p>
        ) : senderStatus ? (
          <KeyStatusRow status={senderStatus} label="GET signing keys" />
        ) : null}
      </section>

      {message?.mode === "compose" ? (
        <section>
          <h2>Recipient encryption keys</h2>
          {recipientStatuses.length === 0 ? (
            <p className="empty">No recipients or not in compose mode.</p>
          ) : (
            <ul className="list-plain">
              {recipientStatuses.map((status) => (
                <li key={status.email}>
                  <KeyStatusRow status={status} label={status.email} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="note">
          Recipient key lookup runs in compose mode. Current mode: {message?.mode ?? "—"} (
          {formatAddresses(message?.to)}).
        </p>
      )}

      <section>
        <h2>Dev key publish</h2>
        <p className="note">
          Generates a fake in-memory key via DevMemoryKeyStore and PUTs to the pubkey directory.
          Never use in production.
        </p>
        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void publishDevKey()}>
            SET dev public key
          </button>
          <button type="button" className="secondary" onClick={() => void refreshKeys()}>
            Refresh lookup
          </button>
        </div>
        {publishState ? <p className="note">{publishState}</p> : null}
        {!capabilities.internetHeaders ? (
          <p className="error-text">Internet headers unavailable — Mailbox 1.8+ required for header stamping.</p>
        ) : null}
      </section>
    </section>
  );
}

function KeyStatusRow({ status, label }: { status: KeyStatus; label: string }) {
  const badge =
    status.status === "found"
      ? "ok"
      : status.status === "missing"
        ? "warn"
        : status.status === "error"
          ? "error"
          : "muted";

  return (
    <div>
      <strong>{label}</strong>{" "}
      <span className={`status ${badge}`}>
        {status.status === "loading"
          ? "loading…"
          : status.status === "found"
            ? `${status.count} key(s)`
            : status.status === "missing"
              ? "not found"
              : "error"}
      </span>
      {status.error ? <div className="error-text">{status.error}</div> : null}
    </div>
  );
}

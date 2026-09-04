import { useCallback, useEffect, useMemo, useState } from "react";
import { createEmailIdentity } from "@scomm-office/identity";
import {
  HttpPublicKeyDirectory,
  ProductionPubkeyDirectory,
  resolveRecipientKeys,
  resolveSenderKeys,
  type PublicKeyDirectory,
} from "@scomm-office/pubkeys";
import { DevMemoryKeyStore } from "@scomm-office/storage";
import { UnsupportedFeatureError } from "@scomm-office/core";
import type { PublicKeyRecord } from "@scomm-office/protocol";
import { MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Button, Note, PageTitle, StatusBadge, usePaneStyles } from "../ui/layout";
import { useHostContext } from "../../lib/host-context";
import { collectRecipientEmails } from "../../lib/semantic-policy";
import { formatAddresses, resolvePubkeyReadBaseUrl } from "../../lib/settings";

const devKeyStore = new DevMemoryKeyStore();

interface KeyStatus {
  email: string;
  status: "loading" | "found" | "missing" | "error";
  count?: number;
  error?: string;
}

function createDirectory(settings: {
  pubkeyReadBaseUrl?: string;
  pubkeyServerUrl?: string;
  scommServerUrl?: string;
}): { directory: PublicKeyDirectory; mode: "production" | "fixture" | "unset"; base: string } {
  const configured =
    settings.pubkeyReadBaseUrl || settings.pubkeyServerUrl || settings.scommServerUrl || "";
  const readBase = resolvePubkeyReadBaseUrl(settings);
  if (!configured && !readBase) {
    return {
      directory: new ProductionPubkeyDirectory("https://invalid.local"),
      mode: "unset",
      base: "",
    };
  }
  const looksLikeFixture =
    /localhost:8787/i.test(configured) ||
    Boolean(settings.scommServerUrl && configured === settings.scommServerUrl);
  if (looksLikeFixture && !settings.pubkeyReadBaseUrl) {
    return { directory: new HttpPublicKeyDirectory(readBase), mode: "fixture", base: readBase };
  }
  return { directory: new ProductionPubkeyDirectory(readBase), mode: "production", base: readBase };
}

export function IdentityPanel() {
  const styles = usePaneStyles();
  const { message, settings, isMockHost, currentUserEmail, capabilities } = useHostContext();
  const [senderStatus, setSenderStatus] = useState<KeyStatus | null>(null);
  const [recipientStatuses, setRecipientStatuses] = useState<KeyStatus[]>([]);
  const [publishState, setPublishState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const userEmail = currentUserEmail ?? (isMockHost ? "you@example.com" : undefined);
  const { directory, mode, base: pubkeyBase } = useMemo(() => createDirectory(settings), [settings]);

  const refreshKeys = useCallback(async () => {
    if (!message || !pubkeyBase) {
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
  }, [directory, message, userEmail, pubkeyBase]);

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
      if (error instanceof UnsupportedFeatureError) {
        setPublishState(
          "Production pubkey upload needs a Master Identity Key on this device. Use the Security panel to create or restore one, then publish.",
        );
      } else {
        setPublishState(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle
        title="Identity"
        description="Keys are discovered on pubkey.scomm.ai — the same directory as the Scomm.AI mail client."
      />
      <dl className={styles.metaGrid}>
        <dt className={styles.metaLabel}>Current user (mailbox)</dt>
        <dd>{userEmail ?? "Unknown (Outlook profile not exposed in MVP)"}</dd>
        <dt className={styles.metaLabel}>Pubkey directory</dt>
        <dd>
          {pubkeyBase || "— (set pubkey read URL in Settings)"} ({mode})
        </dd>
      </dl>

      <PageTitle title="Sender keys" />
      {!pubkeyBase ? (
        <Note>Configure pubkey read base URL to discover keys.</Note>
      ) : !message?.from ? (
        <Note>No sender on current message.</Note>
      ) : senderStatus ? (
        <KeyStatusRow status={senderStatus} label="GET signing keys" />
      ) : null}

      {message?.mode === "compose" ? (
        <>
          <PageTitle title="Recipient encryption keys" />
          {recipientStatuses.length === 0 ? (
            <Note>No recipients or not in compose mode.</Note>
          ) : (
            <ul className={styles.list}>
              {recipientStatuses.map((status) => (
                <li key={status.email}>
                  <KeyStatusRow status={status} label={status.email} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <Note>
          Recipient key lookup runs in compose mode. Current mode: {message?.mode ?? "—"} (
          {formatAddresses(message?.to)}).
        </Note>
      )}

      <PageTitle
        title="Dev key publish"
        description="Fixture mode only: generates a fake key via DevMemoryKeyStore and PUTs to Fastify MVP routes."
      />
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy || mode !== "fixture"} onClick={() => void publishDevKey()}>
          SET dev public key
        </Button>
        <Button appearance="secondary" size="small" onClick={() => void refreshKeys()}>
          Refresh lookup
        </Button>
      </div>
      {publishState ? <Note>{publishState}</Note> : null}
      {!capabilities.internetHeaders ? (
        <MessageBar intent="error">
          <MessageBarBody>Internet headers unavailable — Mailbox 1.8+ required for header stamping.</MessageBarBody>
        </MessageBar>
      ) : null}
    </>
  );
}

function KeyStatusRow({ status, label }: { status: KeyStatus; label: string }) {
  const tone =
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
      <StatusBadge tone={tone}>
        {status.status === "loading"
          ? "loading…"
          : status.status === "found"
            ? `${status.count} key(s)`
            : status.status === "missing"
              ? "not found"
              : "error"}
      </StatusBadge>
      {status.error ? (
        <MessageBar intent="error">
          <MessageBarBody>{status.error}</MessageBarBody>
        </MessageBar>
      ) : null}
    </div>
  );
}

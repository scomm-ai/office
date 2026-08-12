import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHostContext } from "../../lib/host-context";
import { ScommMessageEncryptor, ScommMessageDecryptor } from "@scomm-office/crypto";
import { WebCryptoKeyStore } from "@scomm-office/storage";
import {
  ProductionPubkeyDirectory,
  resolveRecipientKeys,
} from "@scomm-office/pubkeys";
import { resolvePubkeyReadBaseUrl } from "../../lib/settings";
import { collectRecipientEmails } from "../../lib/semantic-policy";

const keyStore = new WebCryptoKeyStore();
const encryptor = new ScommMessageEncryptor();

type BootstrapStep = "idle" | "otp-sent" | "verified" | "published";

export function SecurityPanel() {
  const { settings, message, mailHost, currentUserEmail, isMockHost } = useHostContext();
  const encryptionEnabled = settings.experimentalEncryptionEnabled ?? false;
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatedKeyId, setGeneratedKeyId] = useState<string | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<{ subject?: string; body: string } | null>(null);

  // Load existing key from IndexedDB on mount
  useEffect(() => {
    void keyStore.listKeyIds().then((ids) => {
      if (ids.length > 0 && !generatedKeyId) {
        setGeneratedKeyId(ids[ids.length - 1]);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pubkeyBase = resolvePubkeyReadBaseUrl(settings);
  const userEmail = currentUserEmail ?? (isMockHost ? "you@example.com" : undefined);

  // Bootstrap state
  const [bootstrapStep, setBootstrapStep] = useState<BootstrapStep>("idle");
  const [otpInput, setOtpInput] = useState("");
  const [bootstrapStatus, setBootstrapStatus] = useState<string | null>(null);
  const fetchTokenRef = useRef<string | null>(null);

  const directory = useMemo(
    () => (pubkeyBase ? new ProductionPubkeyDirectory(pubkeyBase) : null),
    [pubkeyBase],
  );

  const decryptor = useMemo(
    () =>
      new ScommMessageDecryptor(async (_keyId: string) => {
        // The envelope stores the server's keyId (e.g. "7") but IndexedDB
        // uses local keyIds (e.g. "scomm-1786..."). Try all local keys.
        try {
          const allIds = await keyStore.listKeyIds();
          for (const localId of allIds) {
            try {
              const key = await keyStore.getPrivate(localId);
              if (key instanceof CryptoKey) return key;
            } catch {
              continue;
            }
          }
          return null;
        } catch {
          return null;
        }
      }),
    [],
  );

  const handleGenerateKey = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const pair = await keyStore.generate({
        algorithm: "ECDH-P256",
        purpose: "encryption",
      });
      setGeneratedKeyId(pair.keyId);
      setStatus(`Generated encryption key: ${pair.keyId}`);
    } catch (err) {
      setStatus(`Key generation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleRequestOtp = useCallback(async () => {
    if (!userEmail || !pubkeyBase) return;
    setBusy(true);
    setBootstrapStatus(null);
    try {
      const res = await fetch(`${pubkeyBase}/auth/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data.message as string) ?? `OTP request failed (${res.status})`);
      }
      setBootstrapStep("otp-sent");
      setBootstrapStatus(`OTP sent to ${userEmail}. Check your email and enter the code below.`);
    } catch (err) {
      setBootstrapStatus(`OTP request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, pubkeyBase]);

  const handleVerifyOtp = useCallback(async () => {
    if (!userEmail || !pubkeyBase || !otpInput.trim()) return;
    setBusy(true);
    setBootstrapStatus(null);
    try {
      const res = await fetch(`${pubkeyBase}/auth/bootstrap/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, otp: otpInput.trim() }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data.message as string) ?? `OTP verify failed (${res.status})`);
      }
      fetchTokenRef.current = (data.fetchToken as string) ?? null;
      setBootstrapStep("verified");
      setBootstrapStatus("Email verified! Now generate a key and publish it.");
    } catch (err) {
      setBootstrapStatus(`OTP verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [userEmail, pubkeyBase, otpInput]);

  const handlePublishKey = useCallback(async () => {
    if (!pubkeyBase || !fetchTokenRef.current || !generatedKeyId) return;
    setBusy(true);
    setBootstrapStatus(null);
    try {
      // Get the public key from IndexedDB
      const stored = await keyStore.getPublic(generatedKeyId);
      if (!stored) throw new Error("Local key not found in IndexedDB");

      const payload = {
        email: userEmail,
        algorithm: "smime-ecdh-p256",
        publicKey: stored.publicKey,
        label: `outlook-addin-${generatedKeyId}`,
        timestamp: new Date().toISOString(),
        jti: crypto.randomUUID(),
      };

      const res = await fetch(`${pubkeyBase}/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `FetchToken ${fetchTokenRef.current}`,
        },
        body: JSON.stringify({
          proofType: "fetch_token_trusted",
          ...payload,
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data.message as string) ?? `Key publish failed (${res.status})`);
      }
      setBootstrapStep("published");
      setBootstrapStatus(`Key published to pubkey server! Key ID: ${data.keyId ?? generatedKeyId}`);
    } catch (err) {
      setBootstrapStatus(`Publish failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [pubkeyBase, generatedKeyId, userEmail]);

  const handleEncrypt = useCallback(async () => {
    if (!directory) {
      setStatus("No pubkey directory configured.");
      return;
    }

    setBusy(true);
    setStatus("Reading current message...");
    try {
      // Always re-read the message to get latest recipients
      const freshMessage = await mailHost.getCurrentMessage();
      if (!freshMessage) {
        setStatus("No message available.");
        setBusy(false);
        return;
      }
      if (freshMessage.mode !== "compose") {
        setStatus("Encryption is only available in compose mode.");
        setBusy(false);
        return;
      }

      setStatus("Looking up recipient keys...");
      const recipientEmails = collectRecipientEmails(freshMessage, userEmail);
      if (recipientEmails.length === 0) {
        setStatus("No recipients to encrypt for.");
        setBusy(false);
        return;
      }

      const recipientKeySets = [];
      for (const email of recipientEmails) {
        const keys = await resolveRecipientKeys(directory, email);
        for (const key of keys) {
          recipientKeySets.push({
            identity: email,
            keyId: key.keyId,
            publicKey: key.publicKey,
            algorithm: key.algorithm,
          });
        }
      }

      if (recipientKeySets.length === 0) {
        setStatus(
          `No encryption keys found for: ${recipientEmails.join(", ")}. Recipients must publish their public keys first.`,
        );
        setBusy(false);
        return;
      }

      setStatus("Encrypting message...");
      const body = freshMessage.bodyHtml ?? freshMessage.bodyText ?? "";
      const encrypted = await encryptor.encrypt(
        { subject: freshMessage.subject, body },
        recipientKeySets,
      );

      // Replace the email body with the encrypted envelope
      const envelopeHtml = `<pre data-scomm-encrypted="true">${encrypted.ciphertext}</pre>`;
      await mailHost.setBody({ html: envelopeHtml });

      // Stamp the security header
      try {
        await mailHost.setHeaders({ "X-SComm-Security": "e2ee-v1" });
      } catch {
        // Header setting may not be available on all hosts
      }

      setStatus(`Encrypted for ${recipientKeySets.length} key(s) across ${recipientEmails.length} recipient(s).`);
    } catch (err) {
      setStatus(`Encryption failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [directory, mailHost, userEmail]);

  const handleDecrypt = useCallback(async () => {
    if (!message) {
      setStatus("No message to decrypt.");
      return;
    }

    setBusy(true);
    setStatus("Attempting decryption...");
    try {
      // Try multiple sources to find the encrypted envelope
      const bodyHtml = message.bodyHtml ?? "";
      const bodyText = message.bodyText ?? "";
      let envelopeCiphertext: string | null = null;

      // 1. HTML-wrapped format: <pre data-scomm-encrypted="true">...</pre>
      const htmlMatch = bodyHtml.match(/data-scomm-encrypted="true"[^>]*>([\s\S]*?)<\/pre>/);
      if (htmlMatch?.[1]) {
        envelopeCiphertext = htmlMatch[1].trim();
      }

      // 2. Raw JSON in plain text body
      if (!envelopeCiphertext) {
        const textMatch = bodyText.match(/(\{[^{}]*"algorithmSuite"\s*:\s*"scomm-v1-[^"]*"[\s\S]*\})\s*$/);
        if (textMatch?.[1]) {
          envelopeCiphertext = textMatch[1].trim();
        }
      }

      // 3. Raw JSON in HTML body (Outlook may wrap it in tags)
      if (!envelopeCiphertext) {
        // Strip HTML tags and decode entities, then search
        const stripped = bodyHtml.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, "").replace(/\u200B/g, "");
        const strippedMatch = stripped.match(/(\{[^{}]*"algorithmSuite"\s*:\s*"scomm-v1-[^"]*"[\s\S]*\})\s*$/);
        if (strippedMatch?.[1]) {
          envelopeCiphertext = strippedMatch[1].trim();
        }
      }

      if (!envelopeCiphertext) {
        setStatus("No SComm encrypted content found in this message.");
        setBusy(false);
        return;
      }

      // Try each local key — the envelope's keyId (server-side) won't match
      // the local keyId, so we brute-force all local keys against the envelope.
      const allLocalIds = await keyStore.listKeyIds();
      let decrypted: Awaited<ReturnType<ScommMessageDecryptor["decrypt"]>> | null = null;

      for (const localId of allLocalIds) {
        const tryDecryptor = new ScommMessageDecryptor(async () => {
          try {
            const key = await keyStore.getPrivate(localId);
            return key instanceof CryptoKey ? key : null;
          } catch {
            return null;
          }
        });
        try {
          decrypted = await tryDecryptor.decrypt({
            envelopeVersion: 1,
            ciphertext: envelopeCiphertext,
            recipients: [],
          });
          break;
        } catch {
          continue;
        }
      }

      if (!decrypted) {
        setStatus("Cannot decrypt: no matching private key found in local key store.");
        setBusy(false);
        return;
      }

      setDecryptedContent({ subject: decrypted.subject, body: decrypted.body });
      setStatus(`Decrypted successfully. Subject: ${decrypted.subject ?? "(none)"}`);
      // In compose mode, replace the body directly
      if (message.mode === "compose") {
        await mailHost.setBody({ html: decrypted.body });
      }
    } catch (err) {
      setStatus(`Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [message, mailHost]);

  return (
    <section>
      <h2>Security</h2>
      <dl className="meta-grid">
        <dt>Encryption</dt>
        <dd>
          <span className={`status ${encryptionEnabled ? "ok" : "muted"}`}>
            {encryptionEnabled ? "SComm E2EE (ECDH-P256 + AES-256-GCM)" : "disabled (enable in Settings)"}
          </span>
        </dd>
        <dt>Encryptor</dt>
        <dd>{encryptionEnabled ? "ScommMessageEncryptor" : "disabled"}</dd>
        <dt>Decryptor</dt>
        <dd>{encryptionEnabled ? "ScommMessageDecryptor" : "disabled"}</dd>
        <dt>Local key</dt>
        <dd>{generatedKeyId ?? "none — generate below"}</dd>
        <dt>Pubkey server</dt>
        <dd>{pubkeyBase || "— (set in Settings)"}</dd>
      </dl>

      {!encryptionEnabled ? (
        <p className="note">
          Enable encryption in Settings to use E2EE features.
        </p>
      ) : (
        <>
          <section>
            <h2>Key Management</h2>
            <p className="note">
              Generate an ECDH P-256 encryption key pair. The private key is stored
              securely in IndexedDB (non-exportable). The public key can be published
              to the pubkey server.
            </p>
            <div className="actions">
              <button type="button" className="primary" disabled={busy} onClick={() => void handleGenerateKey()}>
                Generate encryption key
              </button>
            </div>
          </section>

          <section>
            <h2>Publish key to server</h2>
            {!userEmail ? (
              <p className="note">Current user email unknown — sign in via Microsoft to publish keys.</p>
            ) : bootstrapStep === "idle" ? (
              <div className="actions">
                <p className="note">Verify your email ({userEmail}) to publish your public key.</p>
                <button type="button" className="primary" disabled={busy} onClick={() => void handleRequestOtp()}>
                  Send verification code
                </button>
              </div>
            ) : bootstrapStep === "otp-sent" ? (
              <div className="actions">
                <p className="note">Enter the 6-digit code sent to {userEmail}:</p>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="123456"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value)}
                  style={{ padding: "4px 8px", fontSize: "16px", width: "120px", marginBottom: "8px" }}
                />
                <button type="button" className="primary" disabled={busy || otpInput.trim().length < 6} onClick={() => void handleVerifyOtp()}>
                  Verify code
                </button>
              </div>
            ) : bootstrapStep === "verified" ? (
              <div className="actions">
                <p className="note">Email verified. {generatedKeyId ? "Publish your key now." : "Generate a key first, then publish."}</p>
                <button type="button" className="primary" disabled={busy || !generatedKeyId} onClick={() => void handlePublishKey()}>
                  Publish key to server
                </button>
              </div>
            ) : (
              <p className="note status ok">Key published successfully.</p>
            )}
            {bootstrapStatus ? <p className="note">{bootstrapStatus}</p> : null}
          </section>

          <section>
            <h2>Message encryption</h2>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={busy || message?.mode !== "compose"}
                onClick={() => void handleEncrypt()}
              >
                Encrypt for recipients
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void handleDecrypt()}
              >
                Decrypt message
              </button>
            </div>
          </section>
        </>
      )}

      {status ? <p className="note">{status}</p> : null}

      {decryptedContent ? (
        <section>
          <h2>Decrypted message</h2>
          {decryptedContent.subject ? (
            <dl className="meta-grid">
              <dt>Subject</dt>
              <dd>{decryptedContent.subject}</dd>
            </dl>
          ) : null}
          <div
            style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "4px", padding: "8px", marginTop: "8px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            dangerouslySetInnerHTML={{ __html: decryptedContent.body }}
          />
        </section>
      ) : null}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { ScommMessageDecryptor, ScommMessageEncryptor } from "@scomm-office/crypto";
import { resolveRecipientKeys, type PublicKeyDirectory } from "@scomm-office/pubkeys";
import { WebCryptoKeyStore } from "@scomm-office/storage";
import { useHostContext } from "../../lib/host-context";
import { collectRecipientEmails } from "../../lib/semantic-policy";
import { extractScommEnvelopeCiphertext, isEcdhP256Algorithm } from "../../lib/ecdh-envelope";

const keyStore = new WebCryptoKeyStore();
const encryptor = new ScommMessageEncryptor();

export function EcdhEnvelopeControls({
  directory,
  userEmail,
}: {
  directory: PublicKeyDirectory | null;
  userEmail: string | undefined;
}) {
  const { mailHost, message } = useHostContext();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [generatedKeyId, setGeneratedKeyId] = useState<string | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<{ subject?: string; body: string } | null>(
    null,
  );

  useEffect(() => {
    void keyStore.listKeyIds().then((ids) => {
      if (ids.length > 0) {
        setGeneratedKeyId(ids[ids.length - 1] ?? null);
      }
    });
  }, []);

  const handleGenerateKey = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const pair = await keyStore.generate({
        algorithm: "ECDH-P256",
        purpose: "encryption",
      });
      setGeneratedKeyId(pair.keyId);
      setStatus(`Generated local ECDH key: ${pair.keyId}`);
    } catch (err) {
      setStatus(`Key generation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleEncrypt = useCallback(async () => {
    setBusy(true);
    setStatus("Reading current message...");
    try {
      const freshMessage = await mailHost.getCurrentMessage();
      if (!freshMessage) {
        setStatus("No message available.");
        return;
      }
      if (freshMessage.mode !== "compose") {
        setStatus("ECDH envelope encryption is only available in compose mode.");
        return;
      }

      const recipientEmails = collectRecipientEmails(freshMessage, userEmail);
      if (userEmail) {
        recipientEmails.push(userEmail);
      }
      const uniqueEmails = [...new Set(recipientEmails.map((email) => email.toLowerCase()))];

      const recipientKeySets = [];
      if (directory) {
        for (const email of uniqueEmails) {
          const keys = await resolveRecipientKeys(directory, email);
          for (const key of keys) {
            if (!isEcdhP256Algorithm(key.algorithm)) continue;
            recipientKeySets.push({
              identity: email,
              keyId: key.keyId,
              publicKey: key.publicKey,
              algorithm: key.algorithm,
            });
          }
        }
      }

      if (generatedKeyId && userEmail) {
        const local = await keyStore.getPublic(generatedKeyId);
        if (local) {
          recipientKeySets.push({
            identity: userEmail,
            keyId: local.keyId,
            publicKey: local.publicKey,
            algorithm: local.algorithm,
          });
        }
      }

      if (recipientKeySets.length === 0) {
        setStatus(
          uniqueEmails.length === 0
            ? "No recipients to encrypt for. Add To/Cc/Bcc, or generate a local key for self-send."
            : `No ECDH P-256 keys found for: ${uniqueEmails.join(", ")}. Generate a local key for self-send, or publish ECDH keys for recipients.`,
        );
        return;
      }

      setStatus("Encrypting message...");
      const body = freshMessage.bodyHtml ?? freshMessage.bodyText ?? "";
      const encrypted = await encryptor.encrypt(
        { subject: freshMessage.subject, body },
        recipientKeySets,
      );
      const envelopeHtml = `<pre data-scomm-encrypted="true">${encrypted.ciphertext}</pre>`;
      await mailHost.setBody({ html: envelopeHtml });
      try {
        await mailHost.setHeaders({ "X-SComm-Security": "e2ee-v1" });
      } catch {
        // Header setting may not be available on all hosts
      }
      setStatus(
        `Encrypted ECDH envelope for ${recipientKeySets.length} key(s) across ${uniqueEmails.length || 1} identity(ies).`,
      );
    } catch (err) {
      setStatus(`Encryption failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [directory, generatedKeyId, mailHost, userEmail]);

  const handleDecrypt = useCallback(async () => {
    if (!message) {
      setStatus("No message to decrypt.");
      return;
    }
    setBusy(true);
    setStatus("Attempting ECDH decryption...");
    try {
      const envelopeCiphertext = extractScommEnvelopeCiphertext(message.bodyHtml, message.bodyText);
      if (!envelopeCiphertext) {
        setStatus("No Scomm.AI ECDH envelope found in this message.");
        return;
      }

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
        setStatus("Cannot decrypt: no matching ECDH private key in this device key store.");
        return;
      }

      setDecryptedContent({ subject: decrypted.subject, body: decrypted.body });
      setStatus(`Decrypted ECDH envelope. Subject: ${decrypted.subject ?? "(none)"}`);
    } catch (err) {
      setStatus(`Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [message]);

  return (
    <section>
      <h2>Experimental ECDH envelope</h2>
      <p className="note">
        Separate from OpenPGP. Local ECDH P-256 keys stay in IndexedDB. Encrypt wraps the compose
        body in a Scomm.AI envelope; decrypt shows plaintext in this pane.
      </p>
      <dl className="meta-grid">
        <dt>Local ECDH key</dt>
        <dd>{generatedKeyId ?? "none — generate below"}</dd>
      </dl>
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => void handleGenerateKey()}>
          Generate ECDH key
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || message?.mode !== "compose"}
          onClick={() => void handleEncrypt()}
        >
          Encrypt ECDH envelope
        </button>
        <button type="button" disabled={busy} onClick={() => void handleDecrypt()}>
          Decrypt ECDH envelope
        </button>
      </div>
      {status ? <p className="note">{status}</p> : null}
      {decryptedContent ? (
        <section>
          <h3>Decrypted ECDH message</h3>
          {decryptedContent.subject ? <p className="note">Subject: {decryptedContent.subject}</p> : null}
          <pre className="code-block">{decryptedContent.body}</pre>
        </section>
      ) : null}
    </section>
  );
}

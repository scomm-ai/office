import {
  bodyHasOpenPgpProtection,
  decodePublicMaterial,
  extractPgpMessage,
  extractPgpSignedMessage,
  matchDecryptionKeys,
  messagePlaintext,
  normalizeEmail,
} from "@scomm-office/pubkeys";
import { attachmentEncryptionNotice, type MailHost } from "@scomm-office/office";
import { X_SCOMM_ENCRYPTION } from "@scomm-office/protocol";
import { errorMessage } from "./error-message";
import { collectRecipientEmails } from "./semantic-policy";
import {
  classifyDirectoryKey,
  decideSendGate,
  isDirectoryKeyMiss,
  type RecipientDirectoryStatus,
} from "./directory-key";
import type { ComposeProtectionToggles } from "./compose-security-state";
import { ENCRYPTED_PLACEHOLDER, writeArmoredComposeBody } from "./pgp-armor-body";
import {
  restoreOfficeVault,
  vaultPgpPrivateKeys,
  type OfficePubkeySession,
} from "./pubkey-session";
import { assertPgpAddon } from "./billing-pgp";

async function vaultPublicEncryptionKey(
  session: OfficePubkeySession,
): Promise<Uint8Array | null> {
  if (!session.vault.unlocked) {
    await restoreOfficeVault(session);
  }
  if (!session.vault.unlocked) return null;
  const privateKey = vaultPgpPrivateKeys(session)[0];
  if (!privateKey || typeof session.pgpEngine.exportPublicKey !== "function") return null;
  return session.pgpEngine.exportPublicKey(privateKey);
}

export async function lookupRecipientStatuses(
  session: OfficePubkeySession,
  emails: string[],
  options?: { userEmail?: string },
): Promise<RecipientDirectoryStatus[]> {
  const unique = [...new Set(emails.map((email) => normalizeEmail(email)))];
  const self = options?.userEmail ? normalizeEmail(options.userEmail) : "";
  const rows: RecipientDirectoryStatus[] = [];
  for (const email of unique) {
    try {
      const selected = (await session.client.getBestKey({
        email,
        purpose: "encryption",
      })) as {
        family?: string;
        algorithm?: string;
        suite?: string;
        public_material?: string;
      } | null;
      if (!selected) {
        const local = email === self ? await vaultPublicEncryptionKey(session) : null;
        if (local) {
          rows.push({
            email,
            status: "found",
            family: "pgp",
            algorithm: "openpgp-cv25519",
            isPqc: false,
            addInCanEncrypt: true,
            hint: "Local Vault OpenPGP key (not yet published on the pubkey directory).",
            publicMaterial: local,
          });
          continue;
        }
        rows.push({
          email,
          status: "missing",
          family: "unknown",
          algorithm: "",
          isPqc: false,
          addInCanEncrypt: false,
          hint: "No key published on the pubkey directory.",
        });
        continue;
      }
      rows.push({
        email,
        status: "found",
        ...classifyDirectoryKey(selected),
        publicMaterial: selected.public_material
          ? decodePublicMaterial(selected.public_material)
          : undefined,
      });
    } catch (err) {
      if (isDirectoryKeyMiss(err)) {
        const local = email === self ? await vaultPublicEncryptionKey(session) : null;
        if (local) {
          rows.push({
            email,
            status: "found",
            family: "pgp",
            algorithm: "openpgp-cv25519",
            isPqc: false,
            addInCanEncrypt: true,
            hint: "Local Vault OpenPGP key (not yet published on the pubkey directory).",
            publicMaterial: local,
          });
          continue;
        }
        rows.push({
          email,
          status: "missing",
          family: "unknown",
          algorithm: "",
          isPqc: false,
          addInCanEncrypt: false,
          hint: "No key published on the pubkey directory.",
        });
        continue;
      }
      rows.push({
        email,
        status: "error",
        family: "unknown",
        algorithm: "",
        isPqc: false,
        addInCanEncrypt: false,
        hint: "Directory lookup failed.",
        error: errorMessage(err),
      });
    }
  }
  return rows;
}

export function itemIsProtected(bodyText?: string, bodyHtml?: string): boolean {
  return bodyHasOpenPgpProtection(bodyText) || bodyHasOpenPgpProtection(bodyHtml);
}

async function requireUnlockedPgp(session: OfficePubkeySession): Promise<Uint8Array> {
  if (!session.vault.unlocked) {
    const restored = await restoreOfficeVault(session);
    if (!restored.restored) {
      throw new Error("Unlock the Vault (create a Scomm.AI identity) before using OpenPGP.");
    }
  }
  const keys = vaultPgpPrivateKeys(session);
  if (keys.length === 0) {
    throw new Error("This device has no OpenPGP private key. Publish a key from the Security pane.");
  }
  return keys[0]!;
}

export async function encryptComposeBody(options: {
  session: OfficePubkeySession;
  mailHost: MailHost;
  userEmail: string;
  sign: boolean;
  capabilities?: Parameters<typeof attachmentEncryptionNotice>[0];
}): Promise<string> {
  const { session, mailHost, userEmail, sign } = options;
  await assertPgpAddon();
  const current = await mailHost.getCurrentMessage();
  if (itemIsProtected(current.bodyText, current.bodyHtml)) {
    return "Message is already OpenPGP-protected.";
  }
  const recipients = collectRecipientEmails(current);
  const emails = [...new Set([...recipients, userEmail].map((value) => normalizeEmail(value)))];
  const statuses = await lookupRecipientStatuses(session, emails, { userEmail });
  const others = statuses.filter((row) => row.email !== normalizeEmail(userEmail));
  const gate = decideSendGate({
    bodyProtected: false,
    encrypt: true,
    sign,
    recipients: others,
    pgpEntitled: true,
  });
  if (!gate.allow) {
    throw new Error(gate.errorMessage ?? "Cannot encrypt this message");
  }

  const publicKeys: Uint8Array[] = [];
  for (const row of statuses) {
    if (row.publicMaterial && row.publicMaterial.byteLength > 0) {
      publicKeys.push(row.publicMaterial);
      continue;
    }
    throw new Error(
      row.status === "missing"
        ? `No OpenPGP encryption key published for ${row.email} on the pubkey directory.`
        : `No OpenPGP encryption key for ${row.email}`,
    );
  }

  const plaintext = messagePlaintext(current);
  if (!plaintext.trim()) {
    throw new Error("Message body is empty");
  }
  const privateKey = sign ? await requireUnlockedPgp(session) : undefined;
  let ciphertext: Uint8Array;
  try {
    ciphertext = await session.pgpEngine.encrypt({
      plaintext,
      recipientPublicKeys: publicKeys,
      signingPrivateKey: privateKey,
    });
  } catch (err) {
    // pgpEngine.encrypt's own message ("OpenPGP encrypt failed") is a generic
    // wrapper â€” the actual reason (e.g. a malformed recipient key) is on
    // `.cause`, set by PubkeyError in packages/scomm-pubkey/src/engines/pgp.js.
    const cause = (err as { cause?: unknown } | undefined)?.cause;
    const causeMessage = cause instanceof Error ? cause.message : undefined;
    const base = errorMessage(err);
    throw new Error(causeMessage ? `${base}: ${causeMessage}` : base);
  }
  await writeArmoredComposeBody(mailHost, new TextDecoder().decode(ciphertext), ENCRYPTED_PLACEHOLDER);
  try {
    await mailHost.setHeaders({ [X_SCOMM_ENCRYPTION]: "openpgp-v1" });
  } catch {
    // Header setting may not be available on all hosts (Mailbox 1.8+ only);
    // body-armor detection still works as the read-side fallback.
  }
  const notice = options.capabilities ? attachmentEncryptionNotice(options.capabilities) : null;
  const leftover =
    notice ??
    (current.attachments && current.attachments.length > 0
      ? "Attachments were not encrypted."
      : null);
  return leftover
    ? `Encrypted for ${emails.join(", ")}. ${leftover}`
    : `Encrypted for ${emails.join(", ")}.`;
}

const SIGNATURE_ATTACHMENT_NAME = "signature.asc";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function signComposeBody(options: {
  session: OfficePubkeySession;
  mailHost: MailHost;
}): Promise<string> {
  const { session, mailHost } = options;
  await assertPgpAddon();
  const current = await mailHost.getCurrentMessage();
  if (extractPgpSignedMessage(current.bodyText) || extractPgpSignedMessage(current.bodyHtml)) {
    return "Message is already signed.";
  }
  if (current.attachments?.some((attachment) => attachment.name.toLowerCase() === SIGNATURE_ATTACHMENT_NAME)) {
    return "Message is already signed.";
  }
  if (extractPgpMessage(current.bodyText) || extractPgpMessage(current.bodyHtml)) {
    throw new Error("This body is already encrypted. Sign before encrypting, or use Encrypt with Sign checked.");
  }
  const privateKey = await requireUnlockedPgp(session);
  const plaintext = messagePlaintext(current);
  if (!plaintext.trim()) {
    throw new Error("Message body is empty");
  }
  const signed = await session.pgpEngine.sign({ plaintext, privateKey, detached: true });
  await mailHost.addFileAttachment({
    name: SIGNATURE_ATTACHMENT_NAME,
    contentType: "application/pgp-signature",
    base64: bytesToBase64(signed),
  });
  return "Signed. The message body is unchanged; the OpenPGP signature is attached as signature.asc.";
}

export async function decryptCurrentBody(options: {
  session: OfficePubkeySession;
  mailHost: MailHost;
}): Promise<{ plaintext: string; note: string }> {
  const { session, mailHost } = options;
  const privateKeys = [await requireUnlockedPgp(session), ...vaultPgpPrivateKeys(session).slice(1)];
  const current = await mailHost.getCurrentMessage();
  console.info("[scomm-temp:decrypt-current]", {
    id: current.id ?? null,
    mode: current.mode,
    subject: current.subject ?? null,
    bodyTextLength: current.bodyText?.length ?? 0,
    bodyHtmlLength: current.bodyHtml?.length ?? 0,
  });
  const armored = extractPgpMessage(current.bodyText) ?? extractPgpMessage(current.bodyHtml);
  if (!armored) {
    throw new Error("No OpenPGP message in the current item");
  }

  // Prefer keys whose ID actually matches the ciphertext's recipient key
  // ID(s) â€” falls back to trying every vault key only when no match is
  // found (e.g. a ciphertext with no PKESK key-ID hints).
  const matched = await matchDecryptionKeys(armored, privateKeys);
  const candidates = matched.length > 0 ? matched : privateKeys;

  let lastError: unknown;
  for (const privateKey of candidates) {
    try {
      const plain = await session.pgpEngine.decrypt({ ciphertext: armored, privateKey });
      return {
        plaintext: new TextDecoder().decode(plain),
        note: "Decrypted in the Scomm.AI pane. Plaintext is not written back to Outlook.",
      };
    } catch (err) {
      lastError = err;
    }
  }
  if (matched.length === 0 && privateKeys.length > 0) {
    throw new Error("No Vault key matches this message's recipient key ID(s).");
  }
  throw lastError instanceof Error ? lastError : new Error("No Vault key decrypted this message");
}

export async function verifyCurrentBody(options: {
  session: OfficePubkeySession;
  mailHost: MailHost;
}): Promise<string> {
  const { session, mailHost } = options;
  const current = await mailHost.getCurrentMessage();
  const signed =
    extractPgpSignedMessage(current.bodyText) ?? extractPgpSignedMessage(current.bodyHtml);
  if (!signed) {
    throw new Error("No OpenPGP signed message in the current item");
  }
  const sender = current.from?.emailAddress;
  if (!sender) {
    throw new Error("No sender address to look up a signing key");
  }
  const selected = (await session.client.getBestKey({
    email: normalizeEmail(sender),
    purpose: "signing",
  })) as { public_material?: string; algorithm?: string } | null;
  if (!selected?.public_material) {
    throw new Error(`No published OpenPGP signing key for ${sender} on discovery.scomm.ai`);
  }
  const result = await session.pgpEngine.verify({
    signed,
    publicKeys: [decodePublicMaterial(selected.public_material)],
  });
  if (result.valid) {
    return `Signature valid (${selected.algorithm || "OpenPGP"}${result.keyId ? ` Â· ${result.keyId}` : ""}).`;
  }
  throw new Error(result.reason || "Signature is not valid");
}

export function evaluateSendForToggles(
  toggles: ComposeProtectionToggles,
  bodyText: string,
  bodyHtml: string,
  recipients: RecipientDirectoryStatus[],
  pgpEntitled: boolean,
) {
  return decideSendGate({
    bodyProtected: itemIsProtected(bodyText, bodyHtml),
    encrypt: toggles.encrypt,
    sign: toggles.sign,
    recipients,
    pgpEntitled,
  });
}

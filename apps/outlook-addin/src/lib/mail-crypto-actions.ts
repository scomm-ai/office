import {
  bodyHasOpenPgpProtection,
  decodePublicMaterial,
  extractPgpMessage,
  extractPgpSignedMessage,
  messagePlaintext,
  normalizeEmail,
} from "@scomm-office/pubkeys";
import { attachmentEncryptionNotice, type MailHost } from "@scomm-office/office";
import { collectRecipientEmails } from "./semantic-policy";
import {
  classifyDirectoryKey,
  decideSendGate,
  type RecipientDirectoryStatus,
} from "./directory-key";
import type { ComposeProtectionToggles } from "./compose-security-state";
import {
  restoreOfficeVault,
  vaultPgpPrivateKeys,
  type OfficePubkeySession,
} from "./pubkey-session";

export async function lookupRecipientStatuses(
  session: OfficePubkeySession,
  emails: string[],
): Promise<RecipientDirectoryStatus[]> {
  const unique = [...new Set(emails.map((email) => normalizeEmail(email)))];
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
        rows.push({
          email,
          status: "missing",
          family: "unknown",
          algorithm: "",
          isPqc: false,
          addInCanEncrypt: false,
          hint: "No key published on pubkey.scomm.ai.",
        });
        continue;
      }
      rows.push({
        email,
        status: "found",
        ...classifyDirectoryKey(selected),
      });
    } catch (err) {
      rows.push({
        email,
        status: "error",
        family: "unknown",
        algorithm: "",
        isPqc: false,
        addInCanEncrypt: false,
        hint: "Directory lookup failed.",
        error: err instanceof Error ? err.message : String(err),
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
  const current = await mailHost.getCurrentMessage();
  if (itemIsProtected(current.bodyText, current.bodyHtml)) {
    return "Message is already OpenPGP-protected.";
  }
  const recipients = collectRecipientEmails(current);
  const emails = [...new Set([...recipients, userEmail].map((value) => normalizeEmail(value)))];
  const statuses = await lookupRecipientStatuses(session, emails);
  const others = statuses.filter((row) => row.email !== normalizeEmail(userEmail));
  const gate = decideSendGate({
    bodyProtected: false,
    encrypt: true,
    sign,
    recipients: others,
  });
  if (!gate.allow) {
    throw new Error(gate.errorMessage ?? "Cannot encrypt this message");
  }

  const publicKeys: Uint8Array[] = [];
  for (const email of emails) {
    const selected = (await session.client.getBestKey({
      email,
      purpose: "encryption",
    })) as { public_material?: string } | null;
    const material = selected?.public_material;
    if (!material) {
      throw new Error(`No OpenPGP encryption key for ${email}`);
    }
    publicKeys.push(decodePublicMaterial(material));
  }

  const plaintext = messagePlaintext(current);
  if (!plaintext.trim()) {
    throw new Error("Message body is empty");
  }
  const privateKey = sign ? await requireUnlockedPgp(session) : undefined;
  const ciphertext = await session.pgpEngine.encrypt({
    plaintext,
    recipientPublicKeys: publicKeys,
    signingPrivateKey: privateKey,
  });
  await mailHost.setBody({ text: new TextDecoder().decode(ciphertext) });
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

export async function signComposeBody(options: {
  session: OfficePubkeySession;
  mailHost: MailHost;
}): Promise<string> {
  const { session, mailHost } = options;
  const current = await mailHost.getCurrentMessage();
  if (extractPgpSignedMessage(current.bodyText) || extractPgpSignedMessage(current.bodyHtml)) {
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
  const signed = await session.pgpEngine.sign({ plaintext, privateKey });
  await mailHost.setBody({ text: new TextDecoder().decode(signed) });
  return "Signed with the Vault OpenPGP key.";
}

export async function decryptCurrentBody(options: {
  session: OfficePubkeySession;
  mailHost: MailHost;
}): Promise<{ plaintext: string; note: string }> {
  const { session, mailHost } = options;
  const privateKeys = [await requireUnlockedPgp(session), ...vaultPgpPrivateKeys(session).slice(1)];
  const current = await mailHost.getCurrentMessage();
  const armored = extractPgpMessage(current.bodyText) ?? extractPgpMessage(current.bodyHtml);
  if (!armored) {
    throw new Error("No OpenPGP message in the current item");
  }
  let lastError: unknown;
  for (const privateKey of privateKeys) {
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
    throw new Error(`No published OpenPGP signing key for ${sender} on pubkey.scomm.ai`);
  }
  const result = await session.pgpEngine.verify({
    signed,
    publicKeys: [decodePublicMaterial(selected.public_material)],
  });
  if (result.valid) {
    return `Signature valid (${selected.algorithm || "OpenPGP"}${result.keyId ? ` · ${result.keyId}` : ""}).`;
  }
  throw new Error(result.reason || "Signature is not valid");
}

export function evaluateSendForToggles(
  toggles: ComposeProtectionToggles,
  bodyText: string,
  bodyHtml: string,
  recipients: RecipientDirectoryStatus[],
) {
  return decideSendGate({
    bodyProtected: itemIsProtected(bodyText, bodyHtml),
    encrypt: toggles.encrypt,
    sign: toggles.sign,
    recipients,
  });
}

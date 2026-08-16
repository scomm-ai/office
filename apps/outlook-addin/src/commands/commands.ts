/// <reference types="office-js" />

import { createPubkeyClient } from "@scomm-office/pubkeys";
import { extractPgpMessage, normalizeEmail } from "@scomm-office/pubkeys";
import { IndexedDbVaultStore } from "@scomm-office/storage";

/**
 * Event-runtime SDK init. Reconstructs from persisted vault store.
 * Does not require the task pane, React, or a shared runtime.
 */
export function createEventPubkeyClient() {
  const readBaseUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string> }).env
        ?.VITE_PUBKEY_READ_BASE_URL) ||
    "https://pubkey.scomm.ai";
  const writeBaseUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string> }).env
        ?.VITE_PUBKEY_WRITE_BASE_URL) ||
    "https://api.pubkey.scomm.ai";
  return createPubkeyClient({
    readBaseUrl,
    writeBaseUrl,
    store: new IndexedDbVaultStore(),
  });
}

function getAsync<T>(fn: (cb: (result: Office.AsyncResult<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(result.error ?? new Error("Office.js async failed"));
    });
  });
}

function emailsFromRecipients(
  recips: Office.Recipients | Office.EmailAddressDetails[] | undefined,
): string[] {
  if (!recips) return [];
  const list = Array.isArray(recips) ? recips : [];
  return list
    .map((r) => ("emailAddress" in r ? String(r.emailAddress || "") : ""))
    .filter(Boolean);
}

async function recipientEmails(item: Office.MessageCompose): Promise<string[]> {
  const [to, cc, bcc] = await Promise.all([
    getAsync<Office.EmailAddressDetails[]>((cb) => item.to.getAsync(cb)),
    getAsync<Office.EmailAddressDetails[]>((cb) => item.cc.getAsync(cb)),
    getAsync<Office.EmailAddressDetails[]>((cb) => item.bcc.getAsync(cb)),
  ]);
  return [...new Set([...emailsFromRecipients(to), ...emailsFromRecipients(cc), ...emailsFromRecipients(bcc)].map((e) => normalizeEmail(e)))];
}

function isDirectoryPgp(selected: { family?: string; algorithm?: string; suite?: string } | null): boolean {
  if (!selected) return false;
  const family = String(selected.family || "");
  const algo = String(selected.algorithm || selected.suite || "");
  return family === "pgp" || algo.startsWith("openpgp");
}

function onMessageSend(event: Office.AddinCommands.Event): void {
  void (async () => {
    try {
      const item = Office.context.mailbox.item as Office.MessageCompose | undefined;
      if (!item || item.itemType !== Office.MailboxEnums.ItemType.Message) {
        event.completed({ allowEvent: true });
        return;
      }
      const emails = await recipientEmails(item);
      const body = await getAsync<string>((cb) =>
        item.body.getAsync(Office.CoercionType.Html, cb),
      );
      const text = await getAsync<string>((cb) =>
        item.body.getAsync(Office.CoercionType.Text, cb),
      ).catch(() => "");
      if (extractPgpMessage(text) || extractPgpMessage(body)) {
        event.completed({ allowEvent: true });
        return;
      }
      const { client } = createEventPubkeyClient();
      const needsEncrypt: string[] = [];
      for (const email of emails) {
        try {
          const selected = (await client.getBestKey({
            email,
            purpose: "encryption",
          })) as { family?: string; algorithm?: string; suite?: string } | null;
          if (isDirectoryPgp(selected)) needsEncrypt.push(email);
        } catch {
          /* lookup failure: do not brick send */
        }
      }
      if (needsEncrypt.length > 0) {
        event.completed({
          allowEvent: false,
          errorMessage:
            `Encrypt this message with OpenPGP before sending to ${needsEncrypt.join(", ")}. ` +
            "Use the SComm Security pane → Encrypt body.",
        } as Office.AddinCommands.EventCompletedOptions);
        return;
      }
      event.completed({ allowEvent: true });
    } catch {
      event.completed({ allowEvent: true });
    }
  })();
}

function onMessageCompose(event: Office.AddinCommands.Event): void {
  void createEventPubkeyClient();
  event.completed({ allowEvent: true });
}

function onMessageDecrypt(event: Office.AddinCommands.Event): void {
  void createEventPubkeyClient();
  event.completed({ allowEvent: true });
}

Office.onReady(() => {
  Office.actions.associate("onMessageSend", onMessageSend);
  Office.actions.associate("onMessageCompose", onMessageCompose);
  Office.actions.associate("onMessageDecrypt", onMessageDecrypt);
});

export { onMessageCompose, onMessageDecrypt, onMessageSend };

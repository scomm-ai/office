/// <reference types="office-js" />

import { detectOutlookCapabilities, OutlookMailHost } from "@scomm-office/office";
import {
  extractPgpMessage,
  extractPgpSignedMessage,
  normalizeEmail,
} from "@scomm-office/pubkeys";
import {
  loadComposeTogglesFromItem,
  saveComposeTogglesToItem,
  type ComposeProtectionToggles,
} from "../lib/compose-security-state";
import {
  encryptComposeBody,
  evaluateSendForToggles,
  lookupRecipientStatuses,
  signComposeBody,
} from "../lib/mail-crypto-actions";
import { getOfficePubkeySession, restoreOfficeVault } from "../lib/pubkey-session";
import { assertPgpAddon, loadPgpEntitlement } from "../lib/billing-pgp";
import { DEFAULT_SETTINGS, isLoopbackHostname, normalizePubkeyWriteBaseUrl, resolvePubkeyReadBaseUrl } from "../lib/settings";

const DEFAULT_READ = "https://pubkey.scomm.ai";
const DEFAULT_WRITE = "https://pubkey.scomm.ai";

function envUrl(name: string, fallback: string): string {
  const value =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: Record<string, string> }).env?.[name]
      : undefined;
  return value?.trim() || fallback;
}

function session() {
  const writeConfigured = normalizePubkeyWriteBaseUrl(
    envUrl("VITE_PUBKEY_WRITE_BASE_URL", DEFAULT_WRITE),
  );
  const onLoopback = typeof location !== "undefined" && isLoopbackHostname(location.hostname);
  const readConfigured = envUrl("VITE_PUBKEY_READ_BASE_URL", DEFAULT_READ);
  return getOfficePubkeySession({
    readBaseUrl: resolvePubkeyReadBaseUrl({
      ...DEFAULT_SETTINGS,
      pubkeyReadBaseUrl: readConfigured,
      pubkeyWriteBaseUrl: writeConfigured,
    }),
    writeBaseUrl: onLoopback ? `${location.origin}/pubkey-write` : writeConfigured,
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

function emailsFromRecipients(recips: Office.EmailAddressDetails[] | undefined): string[] {
  return (recips ?? [])
    .map((r) => String(r.emailAddress || ""))
    .filter(Boolean)
    .map((email) => normalizeEmail(email));
}

async function recipientEmails(item: Office.MessageCompose): Promise<string[]> {
  const [to, cc, bcc] = await Promise.all([
    getAsync<Office.EmailAddressDetails[]>((cb) => item.to.getAsync(cb)),
    getAsync<Office.EmailAddressDetails[]>((cb) => item.cc.getAsync(cb)),
    getAsync<Office.EmailAddressDetails[]>((cb) => item.bcc.getAsync(cb)),
  ]);
  return [...new Set([...emailsFromRecipients(to), ...emailsFromRecipients(cc), ...emailsFromRecipients(bcc)])];
}

function mailboxHost() {
  const capabilities = detectOutlookCapabilities({ Office });
  return {
    capabilities,
    mailHost: new OutlookMailHost(Office as never, capabilities),
  };
}

function userEmail(): string {
  const email = Office.context.mailbox?.userProfile?.emailAddress;
  if (!email) throw new Error("Mailbox address is unavailable");
  return email;
}

async function notify(item: Office.Item, message: string, type: "info" | "error" = "info"): Promise<void> {
  const bag = (item as Office.MessageCompose).notificationMessages;
  if (!bag) return;
    const details =
      type === "error"
        ? {
            type: Office.MailboxEnums.ItemNotificationMessageType.ErrorMessage,
            message: message.slice(0, 150),
          }
        : {
            type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
            message: message.slice(0, 150),
            icon: "Icon16",
            persistent: false,
          };
    try {
      await getAsync<void>((cb) => bag.replaceAsync("scomm.crypto", details, cb));
  } catch {
    /* some hosts reject notifications */
  }
}

async function completeCommand(event: Office.AddinCommands.Event, work: () => Promise<string>): Promise<void> {
  const item = Office.context.mailbox.item;
  try {
    const message = await work();
    if (item) await notify(item, message);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (item) await notify(item, text, "error");
  } finally {
    event.completed();
  }
}

function encryptMessage(event: Office.AddinCommands.Event): void {
  void completeCommand(event, async () => {
    await assertPgpAddon();
    const item = Office.context.mailbox.item as Office.MessageCompose;
    const prev = await loadComposeTogglesFromItem(item);
    const next: ComposeProtectionToggles = { ...prev, encrypt: true };
    await saveComposeTogglesToItem(item, next);
    const { mailHost, capabilities } = mailboxHost();
    const pubkey = session();
    await restoreOfficeVault(pubkey);
    return encryptComposeBody({
      session: pubkey,
      mailHost,
      userEmail: userEmail(),
      sign: next.sign,
      capabilities,
    });
  });
}

function signMessage(event: Office.AddinCommands.Event): void {
  void completeCommand(event, async () => {
    await assertPgpAddon();
    const item = Office.context.mailbox.item as Office.MessageCompose;
    const prev = await loadComposeTogglesFromItem(item);
    const next: ComposeProtectionToggles = { ...prev, sign: true };
    await saveComposeTogglesToItem(item, next);
    const { mailHost } = mailboxHost();
    const pubkey = session();
    await restoreOfficeVault(pubkey);
    if (next.encrypt) {
      return encryptComposeBody({
        session: pubkey,
        mailHost,
        userEmail: userEmail(),
        sign: true,
        capabilities: detectOutlookCapabilities({ Office }),
      });
    }
    return signComposeBody({ session: pubkey, mailHost });
  });
}

function onMessageSend(event: Office.AddinCommands.Event): void {
  void (async () => {
    try {
      const item = Office.context.mailbox.item as Office.MessageCompose | undefined;
      if (!item || item.itemType !== Office.MailboxEnums.ItemType.Message) {
        event.completed({ allowEvent: true });
        return;
      }

      const body = await getAsync<string>((cb) => item.body.getAsync(Office.CoercionType.Html, cb));
      const text = await getAsync<string>((cb) =>
        item.body.getAsync(Office.CoercionType.Text, cb),
      ).catch(() => "");

      if (
        extractPgpMessage(text) ||
        extractPgpMessage(body) ||
        extractPgpSignedMessage(text) ||
        extractPgpSignedMessage(body) ||
        body.includes('protocol="application/pgp-signature"') ||
        body.includes('protocol="application/pgp-encrypted"')
      ) {
        event.completed({ allowEvent: true });
        return;
      }

      const emails = await recipientEmails(item);
      const toggles = await loadComposeTogglesFromItem(item);
      const pubkey = session();
      const recipients = await lookupRecipientStatuses(pubkey, emails);
      const pgpEntitled = await loadPgpEntitlement();
      const gate = evaluateSendForToggles(toggles, text, body, recipients, pgpEntitled);
      if (!gate.allow) {
        event.completed({
          allowEvent: false,
          errorMessage: gate.errorMessage ?? "Scomm.AI blocked this send.",
        } as Office.AddinCommands.EventCompletedOptions);
        return;
      }

      if (gate.needsProtect) {
        const { mailHost, capabilities } = mailboxHost();
        await restoreOfficeVault(pubkey);
        if (toggles.encrypt) {
          await encryptComposeBody({
            session: pubkey,
            mailHost,
            userEmail: userEmail(),
            sign: toggles.sign,
            capabilities,
          });
        } else if (toggles.sign) {
          await signComposeBody({ session: pubkey, mailHost });
        }
      }

      event.completed({ allowEvent: true });
    } catch (err) {
      try {
        const item = Office.context.mailbox.item as Office.MessageCompose;
        const toggles = await loadComposeTogglesFromItem(item);
        if (toggles.encrypt || toggles.sign) {
          event.completed({
            allowEvent: false,
            errorMessage: err instanceof Error ? err.message : "Scomm.AI could not protect this message.",
          } as Office.AddinCommands.EventCompletedOptions);
          return;
        }
      } catch {
        /* lookup of toggles failed — do not brick send */
      }
      event.completed({ allowEvent: true });
    }
  })();
}

function onMessageCompose(event: Office.AddinCommands.Event): void {
  void session();
  event.completed({ allowEvent: true });
}

function onMessageDecrypt(event: Office.AddinCommands.Event): void {
  void session();
  event.completed({ allowEvent: true });
}

Office.onReady(() => {
  Office.actions.associate("onMessageSend", onMessageSend);
  Office.actions.associate("onMessageCompose", onMessageCompose);
  Office.actions.associate("onMessageDecrypt", onMessageDecrypt);
  Office.actions.associate("encryptMessage", encryptMessage);
  Office.actions.associate("signMessage", signMessage);
});

export { encryptMessage, onMessageCompose, onMessageDecrypt, onMessageSend, signMessage };

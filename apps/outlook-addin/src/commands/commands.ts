/// <reference types="office-js" />

import { detectOutlookCapabilities, OutlookMailHost } from "@scomm-office/office";
import { GraphSubmissionAdapter, HttpMicrosoftGraphClient } from "@scomm-office/microsoft-graph";
import {
  extractPgpMessage,
  extractPgpSignedMessage,
} from "@scomm-office/pubkeys";
import {
  loadComposeTogglesFromItem,
  saveComposeTogglesToItem,
  type ComposeProtectionToggles,
} from "../lib/compose-security-state";
import { protectOnSend } from "../lib/protect-on-send";
import { SilentOnlyIdentityProvider, isNaaConfigured } from "../lib/msal-auth";
import { getOfficePubkeySession } from "../lib/pubkey-session";
import { envPubkeyReadBaseUrl, envPubkeyWriteBaseUrl } from "../lib/settings";

function session() {
  return getOfficePubkeySession({
    readBaseUrl: envPubkeyReadBaseUrl(),
    writeBaseUrl: envPubkeyWriteBaseUrl(),
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

function mailboxHost() {
  const capabilities = detectOutlookCapabilities({ Office });
  return {
    capabilities,
    mailHost: new OutlookMailHost(Office as never, capabilities),
  };
}

function silentGraphSubmit() {
  if (!isNaaConfigured()) return undefined;
  const adapter = new GraphSubmissionAdapter(
    new HttpMicrosoftGraphClient(new SilentOnlyIdentityProvider()),
  );
  return (message: Parameters<GraphSubmissionAdapter["submit"]>[0], headers: Record<string, string>) =>
    adapter.submit(message, headers);
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
    const item = Office.context.mailbox.item as Office.MessageCompose;
    const prev = await loadComposeTogglesFromItem(item);
    const next: ComposeProtectionToggles = { ...prev, encrypt: true };
    await saveComposeTogglesToItem(item, next);
    return next.sign
      ? "Encrypt and Sign enabled. Outlook Send will protect this message."
      : "Encrypt enabled. Outlook Send will protect this message.";
  });
}

function signMessage(event: Office.AddinCommands.Event): void {
  void completeCommand(event, async () => {
    const item = Office.context.mailbox.item as Office.MessageCompose;
    const prev = await loadComposeTogglesFromItem(item);
    const next: ComposeProtectionToggles = { ...prev, sign: true };
    await saveComposeTogglesToItem(item, next);
    return next.encrypt
      ? "Encrypt and Sign enabled. Outlook Send will protect this message."
      : "Sign enabled. Outlook Send will protect this message.";
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

      const toggles = await loadComposeTogglesFromItem(item);
      const { mailHost } = mailboxHost();
      const result = await protectOnSend({
        session: session(),
        mailHost,
        userEmail: userEmail(),
        toggles,
        graphSubmit: silentGraphSubmit(),
      });

      if (result.outcome === "block") {
        event.completed({
          allowEvent: false,
          errorMessage: result.errorMessage,
        } as Office.AddinCommands.EventCompletedOptions);
        return;
      }

      if (result.outcome === "graph-sent") {
        try {
          item.close();
        } catch {
          /* close() may be unavailable */
        }
        event.completed({
          allowEvent: false,
          errorMessage: "Sent securely via Scomm.AI. You can close this window.",
        } as Office.AddinCommands.EventCompletedOptions);
        return;
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

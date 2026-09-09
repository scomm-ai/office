import {
  extractPgpMessage,
  extractPgpSignedMessage,
} from "@scomm-office/pubkeys";
import type { MailHost } from "@scomm-office/office";

/** Pull the OpenPGP armor block out of a protected EML (never the MIME headers). */
export function armoredPayloadFromEml(eml: Uint8Array | string): string {
  const encodings =
    typeof eml === "string"
      ? [eml]
      : [new TextDecoder("utf-8").decode(eml), new TextDecoder("latin1").decode(eml)];
  for (const text of encodings) {
    const block = extractPgpMessage(text) ?? extractPgpSignedMessage(text);
    if (block) return block;
    const parts = text.split(/\r?\n\r?\n/);
    if (parts.length > 1) {
      const body = parts.slice(1).join("\n\n").trim();
      const fromBody = extractPgpMessage(body) ?? extractPgpSignedMessage(body);
      if (fromBody) return fromBody;
      if (/BEGIN PGP (MESSAGE|SIGNED MESSAGE)/.test(body)) return body;
    }
  }
  const preview =
    typeof eml === "string" ? eml.slice(0, 240) : new TextDecoder("utf-8").decode(eml).slice(0, 240);
  throw new Error(`Protected message did not contain OpenPGP armor (${preview})`);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shown ahead of the armor block so a recipient without the Scomm.AI add-in
 * (or an OnMessageDecrypt-incapable client) sees guidance instead of raw PGP
 * text. extractPgpMessage locates the armor by content, not position, so
 * this prefix never interferes with decryption by an add-in that has one.
 */
export const ENCRYPTED_PLACEHOLDER_MESSAGE =
  "This message is encrypted with the Scomm.AI Outlook add-in. " +
  "Install Scomm.AI (pubkey.scomm.ai) to read it automatically, or ask the sender to resend it unencrypted.";

/** GpgOL-style HTML wrapper so Outlook’s HTML composer does not reflow armor lines. */
export function pgpArmorAsComposeHtml(armored: string, placeholder?: string): string {
  const escaped = escapeHtml(armored.replace(/\r\n/g, "\n").trim());
  const intro = placeholder ? `<p>${escapeHtml(placeholder)}</p>` : "";
  return `${intro}<pre style="font-family:Consolas,monospace;white-space:pre-wrap;word-break:keep-all">${escaped}</pre>`;
}

export async function writeArmoredComposeBody(
  mailHost: MailHost,
  armored: string,
  placeholder?: string,
): Promise<void> {
  const text = placeholder ? `${placeholder}\n\n${armored}` : armored;
  await mailHost.setBody({ html: pgpArmorAsComposeHtml(armored, placeholder), text });
}

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

/** GpgOL-style HTML wrapper so Outlook’s HTML composer does not reflow armor lines. */
export function pgpArmorAsComposeHtml(armored: string): string {
  const escaped = escapeHtml(armored.replace(/\r\n/g, "\n").trim());
  return `<pre style="font-family:Consolas,monospace;white-space:pre-wrap;word-break:keep-all">${escaped}</pre>`;
}

export async function writeArmoredComposeBody(mailHost: MailHost, armored: string): Promise<void> {
  await mailHost.setBody({ html: pgpArmorAsComposeHtml(armored), text: armored });
}

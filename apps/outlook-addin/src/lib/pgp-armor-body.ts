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
export interface EncryptedPlaceholder {
  /** Plain-text intro prepended to the text/plain body. */
  text: string;
  /** Trusted, pre-styled HTML prepended to the HTML body — not escaped. */
  html: string;
}

const PLACEHOLDER_INSTALL_URL = "https://pubkey.scomm.ai";

export const ENCRYPTED_PLACEHOLDER: EncryptedPlaceholder = {
  text:
    "This message is encrypted with the Scomm.AI Outlook add-in.\n" +
    "Open it in Outlook with Scomm.AI installed to decrypt it automatically, " +
    `or install it at ${PLACEHOLDER_INSTALL_URL} if you don't have it yet.`,
  html: `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-collapse:collapse;">
  <tr>
    <td style="border:1px solid #f4c7b8;background-color:#fdf1ee;border-radius:8px;padding:20px 24px;font-family:'Segoe UI',Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:8px;font-size:18px;line-height:1;vertical-align:middle;">&#128274;</td>
        <td style="font-size:16px;font-weight:600;color:#c4314b;vertical-align:middle;">This message is encrypted</td>
      </tr></table>
      <p style="margin:14px 0 0 0;font-size:14px;line-height:20px;color:#323130;">
        This email was encrypted with the <strong>Scomm.AI</strong> add-in for Outlook.
      </p>
      <p style="margin:10px 0 18px 0;font-size:14px;line-height:20px;color:#323130;">
        Open this message in Outlook with the Scomm.AI add-in installed and it will
        <strong>decrypt automatically</strong> &mdash; no extra steps needed.
      </p>
      <a href="${PLACEHOLDER_INSTALL_URL}" style="display:inline-block;background-color:#0f6cbd;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:4px;">
        Get Scomm.AI to decrypt
      </a>
      <hr style="border:none;border-top:1px solid #f0ded6;margin:20px 0 12px 0;" />
      <p style="margin:0;font-size:12px;">
        <a href="${PLACEHOLDER_INSTALL_URL}" style="color:#0f6cbd;text-decoration:none;">Learn more about encrypted email</a>
      </p>
      <p style="margin:10px 0 0 0;font-size:12px;color:#605e5c;font-style:italic;">
        <strong>Security note:</strong> This message is encrypted end-to-end with OpenPGP to protect its contents.
      </p>
    </td>
  </tr>
</table>`.trim(),
};

/** GpgOL-style HTML wrapper so Outlook’s HTML composer does not reflow armor lines. */
export function pgpArmorAsComposeHtml(armored: string, placeholderHtml?: string): string {
  const escaped = escapeHtml(armored.replace(/\r\n/g, "\n").trim());
  const intro = placeholderHtml ?? "";
  return `${intro}<pre style="font-family:Consolas,monospace;white-space:pre-wrap;word-break:keep-all">${escaped}</pre>`;
}

export async function writeArmoredComposeBody(
  mailHost: MailHost,
  armored: string,
  placeholder?: EncryptedPlaceholder,
): Promise<void> {
  const text = placeholder ? `${placeholder.text}\n\n${armored}` : armored;
  await mailHost.setBody({ html: pgpArmorAsComposeHtml(armored, placeholder?.html), text });
}

import { decodeBase64Url } from "@scomm/pubkey";

export const PGP_MESSAGE_BEGIN = "-----BEGIN PGP MESSAGE-----";
export const PGP_MESSAGE_END = "-----END PGP MESSAGE-----";

/** Outlook HTML often splits armor across spans, `<br>`, and `\r\n`. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|pre|blockquote)>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#13;/g, "\r")
    .replace(/&#10;/g, "\n")
    .replace(/\u00a0/g, "")
    .replace(/\u200b/g, "")
    .replace(/\u200c/g, "")
    .replace(/\u200d/g, "")
    .replace(/\ufeff/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export function extractPgpMessage(source: string | undefined | null): string | null {
  if (!source) return null;
  const candidates = source.includes("<")
    ? [htmlToPlainText(source), source]
    : [source.replace(/\r\n/g, "\n").replace(/\r/g, "\n")];
  for (const text of candidates) {
    const start = text.indexOf(PGP_MESSAGE_BEGIN);
    if (start < 0) continue;
    const end = text.indexOf(PGP_MESSAGE_END, start);
    if (end < 0) continue;
    return text
      .slice(start, end + PGP_MESSAGE_END.length)
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }
  return null;
}

export function messagePlaintext(message: {
  bodyText?: string;
  bodyHtml?: string;
}): string {
  if (message.bodyText?.trim()) {
    return extractPgpMessage(message.bodyText) ?? message.bodyText;
  }
  if (message.bodyHtml) {
    return extractPgpMessage(message.bodyHtml) ?? htmlToPlainText(message.bodyHtml);
  }
  return "";
}

/** Directory `public_material` is base64url of binary packets or UTF-8 armor. */
export function decodePublicMaterial(material: string): Uint8Array {
  try {
    return decodeBase64Url(material);
  } catch {
    return new TextEncoder().encode(material);
  }
}

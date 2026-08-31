const ECDH_ALGORITHMS = new Set(["ecdh-p256", "smime-ecdh-p256", "scomm-v1-ecdh-p256-aes256gcm"]);

export function isEcdhP256Algorithm(algorithm: string | undefined): boolean {
  if (!algorithm) return false;
  return ECDH_ALGORITHMS.has(algorithm.trim().toLowerCase());
}

export function extractScommEnvelopeCiphertext(
  bodyHtml?: string,
  bodyText?: string,
): string | null {
  const html = bodyHtml ?? "";
  const text = bodyText ?? "";

  const htmlMatch = html.match(/data-scomm-encrypted="true"[^>]*>([\s\S]*?)<\/pre>/);
  if (htmlMatch?.[1]) {
    return htmlMatch[1].trim();
  }

  const jsonPattern = /(\{[^{}]*"algorithmSuite"\s*:\s*"scomm-v1-[^"]*"[\s\S]*\})\s*$/;
  const textMatch = text.match(jsonPattern);
  if (textMatch?.[1]) {
    return textMatch[1].trim();
  }

  const stripped = html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\u200B/g, "");
  const strippedMatch = stripped.match(jsonPattern);
  if (strippedMatch?.[1]) {
    return strippedMatch[1].trim();
  }

  return null;
}

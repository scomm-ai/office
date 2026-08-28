import type { MailAddress } from "./types.js";

const CANONICALIZATION_PROFILE = "scomm-message-v1";

export function canonicalizationProfile(): string {
  return CANONICALIZATION_PROFILE;
}

/** NFC normalize and trim display names without altering email local-part semantics. */
export function normalizeAddress(address: MailAddress): MailAddress {
  const email = address.emailAddress.trim().toLowerCase();
  const displayName = address.displayName?.normalize("NFC").trim();
  return displayName ? { displayName, emailAddress: email } : { emailAddress: email };
}

/** Deterministic recipient ordering (order-independent semantically). */
export function normalizeRecipients(addresses: MailAddress[] | undefined): MailAddress[] {
  if (!addresses?.length) return [];
  return [...addresses.map(normalizeAddress)].sort((a, b) =>
    a.emailAddress.localeCompare(b.emailAddress),
  );
}

/**
 * Canonical plain-text body normalization.
 * Normalize representation, never normalize meaning.
 */
export function canonicalizeAuthoredText(text: string): string {
  let normalized = text.normalize("NFC");
  normalized = normalized.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  normalized = normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  if (!normalized.endsWith("\n") && normalized.length > 0) {
    normalized += "\n";
  }
  return normalized;
}

export function recipientEmails(addresses: MailAddress[] | undefined): string[] {
  return normalizeRecipients(addresses).map((a) => a.emailAddress);
}

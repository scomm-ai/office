/**
 * Email identity helpers.
 *
 * `normalizeEmail` is the pubkey SET/GET contract — keep in lockstep with
 * `@scomm/pubkey` / pubkey `src/lib/emailTid.ts`. Clients MUST send that exact string.
 *
 * `normalizeEmailIdentity` remains the looser MVP comparison for local
 * message identity (domain lowercased, local preserved).
 */

export interface NormalizedEmailIdentity {
  /** Original input as provided by the user/host */
  original: string;
  /** Local part preserved as-is after trim (except surrounding spaces) */
  localPart: string;
  /** Domain lowercased */
  domain: string;
  /** localPart@domain for safe comparison (local not lowercased) */
  comparisonKey: string;
  /** Fully lowercased key — only for display grouping / undocumented mailboxes */
  looseComparisonKey: string;
}

/**
 * Public mailbox canonicalization for pubkey SET/GET.
 *
 * 1. Trim Unicode whitespace
 * 2. Unicode NFC
 * 3. Split on the last ASCII `@`
 * 4. Domain: Unicode lowercase, NFC
 * 5. Local: Unicode lowercase, NFC; drop from the first ASCII `+` onward
 * 6. Join `local@domain` — SHA-256 the UTF-8 bytes of this string for `tid`
 */
export function normalizeEmail(email: string): string {
  if (typeof email !== "string") {
    return "";
  }
  const trimmed = email.trim().normalize("NFC");
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return foldUtf8(trimmed);
  }
  let local = foldUtf8(trimmed.slice(0, at));
  const domain = foldUtf8(trimmed.slice(at + 1));
  const plus = local.indexOf("+");
  if (plus !== -1) {
    local = local.slice(0, plus);
  }
  return `${local}@${domain}`;
}

function foldUtf8(value: string): string {
  return value.toLowerCase().normalize("NFC");
}

const MAX_EMAIL_OCTETS = 254;
const MAX_LOCAL_OCTETS = 64;
const MAX_DOMAIN_OCTETS = 255;
const MAX_LABEL_OCTETS = 63;

/** RFC 5322 atext plus `.` and SMTPUTF8 letters / marks / numbers. */
const LOCAL_CHARS =
  /^[\p{L}\p{N}\p{M}!#$%&'*+\/=?^_`{|}~.-]+$/u;

/** IDNA / LDH label: letters, digits, marks, internal hyphen. */
const DOMAIN_LABEL_CHARS = /^[\p{L}\p{N}\p{M}-]+$/u;

const DISALLOWED_IN_ADDRESS = /[\s\p{Cc}\p{Cf}]/u;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isValidLocalPart(local: string): boolean {
  if (
    local.length === 0 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) {
    return false;
  }
  return LOCAL_CHARS.test(local);
}

function isValidDomain(domain: string): boolean {
  if (
    domain.startsWith("[") ||
    domain.endsWith("]") ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2) {
    return false;
  }
  for (const label of labels) {
    if (
      label.length === 0 ||
      utf8ByteLength(label) > MAX_LABEL_OCTETS ||
      label.startsWith("-") ||
      label.endsWith("-") ||
      !DOMAIN_LABEL_CHARS.test(label)
    ) {
      return false;
    }
  }
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || /^\d+$/.test(tld) || !/\p{L}/u.test(tld)) {
    return false;
  }
  return true;
}

/**
 * Shape check for a *normalized* mailbox (`normalizeEmail` output).
 * Keep in lockstep with pubkey `src/lib/emailTid.ts`.
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string" || email.length === 0) {
    return false;
  }
  if (DISALLOWED_IN_ADDRESS.test(email) || email.includes("\0")) {
    return false;
  }
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) {
    return false;
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (
    utf8ByteLength(email) > MAX_EMAIL_OCTETS ||
    utf8ByteLength(local) > MAX_LOCAL_OCTETS ||
    utf8ByteLength(domain) > MAX_DOMAIN_OCTETS
  ) {
    return false;
  }
  return isValidLocalPart(local) && isValidDomain(domain);
}

export function normalizeEmailIdentity(input: string): NormalizedEmailIdentity {
  const original = input.trim();
  const at = original.lastIndexOf("@");
  if (at <= 0 || at === original.length - 1) {
    throw new Error(`Invalid email identity: ${input}`);
  }

  const localPart = original.slice(0, at);
  const domain = original.slice(at + 1).toLowerCase();
  const comparisonKey = `${localPart}@${domain}`;
  const looseComparisonKey = `${localPart.toLowerCase()}@${domain}`;

  return {
    original,
    localPart,
    domain,
    comparisonKey,
    looseComparisonKey,
  };
}

export function emailsLikelyEqual(a: string, b: string): boolean {
  const na = normalizeEmailIdentity(a);
  const nb = normalizeEmailIdentity(b);
  return na.comparisonKey === nb.comparisonKey;
}

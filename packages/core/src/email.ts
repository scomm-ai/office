/**
 * Email identity normalization.
 *
 * See openspec/features/email-identity-normalization.md
 *
 * Rules implemented for MVP comparisons:
 * - Trim surrounding whitespace
 * - Lowercase the domain part only (RFC 5321 domains are case-insensitive)
 * - Do NOT lowercase the local part by default (mailbox policies vary)
 * - Preserve the original representation separately via NormalizedEmailIdentity.original
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

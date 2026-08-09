# Email Identity Normalization

## Status

**Accepted**

## Context

Email addresses appear with inconsistent casing, whitespace, and display-name wrapping. SComm uses identities for public-key lookup, policy rules (domain allowlists), and sender/recipient comparison.

Implementation: `packages/core/src/email.ts` — `normalizeEmailIdentity()`.

## Problem

Blind lowercasing of entire addresses breaks mailboxes where local parts are case-sensitive (uncommon but RFC-permitted). Blind exact-match fails when domains differ only by case (`Example.COM` vs `example.com`).

## Goals

- Trim surrounding whitespace
- **Lowercase domain only** (RFC 5321 domains are case-insensitive)
- Preserve local part as-is for comparison key
- Keep original representation for display
- Provide explicit `emailsLikelyEqual()` for MVP comparisons

## Non-goals

- Gmail-style dot/plus normalization (provider-specific)
- IDNA/punycode conversion in MVP (document for future)
- Display-name parsing (`"Alice" <alice@example.com>`) — handled upstream in MailHost

## Constraints

- Invalid addresses throw (no silent coercion)
- Comparison semantics must be documented and stable
- Pubkey directory keys must use normalized form consistently

## Proposed design

### NormalizedEmailIdentity

```typescript
interface NormalizedEmailIdentity {
  original: string;           // trimmed input
  localPart: string;          // preserved casing
  domain: string;             // lowercased
  comparisonKey: string;      // `${localPart}@${domain}`
  looseComparisonKey: string; // local lowercased too — display grouping only
}
```

### Algorithm

```typescript
function normalizeEmailIdentity(input: string): NormalizedEmailIdentity {
  const original = input.trim();
  const at = original.lastIndexOf("@");
  if (at <= 0 || at === original.length - 1) {
    throw new Error(`Invalid email identity: ${input}`);
  }
  const localPart = original.slice(0, at);
  const domain = original.slice(at + 1).toLowerCase();
  return {
    original,
    localPart,
    domain,
    comparisonKey: `${localPart}@${domain}`,
    looseComparisonKey: `${localPart.toLowerCase()}@${domain}`,
  };
}
```

### Usage rules

| Use case | Key to use |
|----------|------------|
| Pubkey lookup URL path | `encodeURIComponent(comparisonKey)` |
| Recipient equality in policy | `comparisonKey` via `emailsLikelyEqual()` |
| UI display | `original` |
| Analytics grouping (non-security) | `looseComparisonKey` optional |

### Display-name addresses

MailHost adapter strips display names before normalization:

```text
"Alice Example" <Alice@Example.COM>  →  Alice@Example.COM  →  normalize
```

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Lowercase entire address | Breaks rare case-sensitive local parts |
| No normalization | Duplicate keys for domain case variants |
| Full RFC 5322 parser in core | Belongs in MailHost; keep core minimal |

## Security considerations

- Normalization is not authentication — spoofed From headers normalize cleanly
- Internationalized domain homograph attacks require IDNA + suspicious domain detection (deferred)
- Do not use `looseComparisonKey` for security decisions

## Compatibility

- Aligns with SComm native client conventions (pending ecosystem confirmation)
- Server pubkey API uses normalized identity in path segments

## Open questions

- IDNA/punycode normalization timing
- Plus-address stripping policy for enterprise deduplication
- `scomm-uid` identity type normalization (separate from email)

## Decision

**MVP locks domain-lowercase-only normalization with preserved local part. `comparisonKey` used for pubkey and policy equality. `looseComparisonKey` for non-security grouping only.**

## Implementation status

| Item | Status |
|------|--------|
| `normalizeEmailIdentity()` | **Done** (`packages/core/src/email.ts`) |
| `emailsLikelyEqual()` | **Done** |
| Unit tests | **Done** |
| MailHost display-name stripping | Planned |

## Deferred work

- IDNA/punycode support
- Provider-specific canonicalization profiles
- Organization alias expansion (SMTP vs X500)

# SComm MIME Type (`application/scomm+json`)

## Status

**Deferred**

## Context

Rich SComm semantic documents may exceed practical Internet Header sizes. A dedicated MIME part could carry structured semantics alongside `text/plain` and `text/html` in a standards-compatible multipart message.

Outlook Office.js attachment and body APIs have limitations on arbitrary MIME structure creation across hosts.

## Problem

Without a verified MIME strategy, SComm cannot reliably attach machine-readable semantics for non-SComm clients while preserving human-readable bodies. Premature implementation risks broken sends on Exchange.

## Goals

- Evaluate `application/scomm+json` as future semantic transport
- Define intended multipart structure for ecosystem alignment
- Leave typed stub / OpenSpec only — **no MVP implementation**

## Non-goals

- MVP message sending depending on custom MIME
- Outlook MIME rewriting without platform verification
- Replacing Internet Headers entirely

## Constraints

- Office.js may not expose low-level MIME assembly on all platforms
- Exchange may strip or modify unknown MIME parts
- S/MIME signed messages complicate part insertion
- Ordinary clients must still render readable email without the SComm part

## Proposed design

### Intended multipart structure (draft)

```text
multipart/alternative
├── text/plain          (human readable)
├── text/html           (human readable)
└── application/scomm+json  (SemanticMailDocument JSON)
```

Alternative for signed messages (future):

```text
multipart/signed
├── multipart/alternative
│   ├── text/plain
│   ├── text/html
│   └── application/scomm+json
└── application/pgp-signature
```

### Media type registration (future)

```text
Content-Type: application/scomm+json; charset=utf-8
Content-Disposition: inline
```

Body: canonical JSON matching `SemanticMailDocument` schema with `version` field.

### Relationship to headers

Headers remain compact indicators:

- `X-SComm-Version`
- `X-SComm-Semantic-Digest` (digest includes MIME part or canonical JSON)
- Optional `X-SComm-Semantics: mime-part` marker

### Outlook integration (when verified)

Potential paths (all unverified):

1. Add as attachment with inline disposition via Office.js attachment API
2. Server-side MIME assembly on send hook (requires transport agent — out of scope)
3. Graph sendMail with pre-built MIME (complex)

Each requires platform test matrix before selection.

## Alternatives

| Alternative | Why rejected for now |
|-------------|---------------------|
| Headers only | Size limited — OK for MVP |
| External URL only in headers | Requires server availability at read time |
| Proprietary TNEF | Not portable |

## Security considerations

- MIME part is untrusted on inbound — validate with Zod
- Digest/signature must cover semantic bytes ([semantic-signatures](../security/semantic-signatures.md))
- Do not execute JSON-LD or embedded scripts

## Compatibility

- Non-SComm clients ignore unknown MIME part if MIME structure valid
- Must not break `multipart/alternative` rendering priority

## Open questions

- Which Outlook hosts support adding custom MIME parts on send?
- Exchange Online vs on-premises behavior differences
- Interaction with S/MIME and encryption

## Decision

**Defer `application/scomm+json` implementation until Outlook/Exchange MIME behavior is verified. MVP uses compact Internet Headers + optional server-side semantic storage.**

## Implementation status

| Item | Status |
|------|--------|
| MIME assembly | **Not started** |
| Platform verification | **Not started** |
| OpenSpec documentation | This document |

## Deferred work

- Outlook MIME capability testing
- IANA/media type registration discussion
- Implement `ScommMimeAdapter` behind feature flag
- Cross-client interoperability tests with SComm native

See [deferred index](../deferred/README.md).

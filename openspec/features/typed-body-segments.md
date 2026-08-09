# Typed Body Segments

## Status

**Accepted**

## Context

SComm semantic email represents message bodies as ordered, typed **segments** rather than monolithic strings. This enables policy rules ("block if external recipient and no disclaimer in Legalese segment"), AI summarization of authored content only, and accurate digest computation.

Implementation lives in `packages/semantics`.

## Problem

Email clients merge authored text, quoted replies, signatures, and legal disclaimers into one HTML blob. Without typed segmentation, downstream features misidentify obligations, actions, and user intent.

## Goals

- Discriminated union **`SemanticBodySegment`** with schema versioning
- MVP detection: AuthoredContent, QuotedContent, Signature, Unknown (minimum)
- Extended types defined for forward compatibility
- Source range mapping to original HTML/text where possible
- Confidence scores on heuristic segments

## Non-goals

- Perfect segmentation accuracy in MVP
- MIME-level segment boundaries (see [scomm-mime](./scomm-mime.md))
- Localization-specific quote markers for all languages in v1

## Constraints

- Segments must serialize to JSON for dev-console and optional server storage
- Unknown segment catches all unclassified content (never drop text)
- Signature must be structured object, not plain text only

## Proposed design

### Base segment

```typescript
interface BaseSegment {
  id: string;
  type: string;
  sourceRange?: { start: number; end: number };
  confidence?: number;       // 0..1 heuristic confidence
  text?: string;
  html?: string;
  schemaVersion: string;     // e.g. "1.0"
}
```

### Segment union (MVP + defined extensions)

```typescript
type SemanticBodySegment =
  | AuthoredContentSegment
  | SignatureSegment
  | LegaleseSegment
  | QuotedContentSegment
  | ForwardedContentSegment
  | AttachmentReferenceSegment
  | GreetingSegment
  | ClosingSegment
  | ActionRequestSegment
  | StructuredDataSegment
  | UnknownSegment;
```

### Key segment schemas

**AuthoredContent** — primary user-written material:

```typescript
interface AuthoredContentSegment extends BaseSegment {
  type: "authored-content";
}
```

**QuotedContent** — inline reply history:

```typescript
interface QuotedContentSegment extends BaseSegment {
  type: "quoted-content";
  quotedFrom?: MailAddress;
  quotedAt?: string;
  depth?: number;  // nesting level
}
```

**Signature** — structured, not free text:

```typescript
interface SignatureSegment extends BaseSegment {
  type: "signature";
  person?: { name?: string; title?: string };
  organization?: { name?: string; department?: string };
  contacts?: { email?: string[]; phone?: string[]; website?: string[] };
  address?: string;
}
```

**Legalese** — confidentiality / retention notices:

```typescript
interface LegaleseSegment extends BaseSegment {
  type: "legalese";
  policyId?: string;
  jurisdiction?: string[];
  confidentiality?: boolean;
  retentionNotice?: boolean;
  rawText: string;
}
```

**Unknown** — fallback:

```typescript
interface UnknownSegment extends BaseSegment {
  type: "unknown";
  reason?: string;
}
```

### Semantic actions (cross-segment)

```typescript
interface SemanticAction {
  id: string;
  type: "request" | "approval" | "task" | "question" | "decision" | "meeting" | "other";
  description: string;
  assignees?: MailAddress[];
  dueAt?: string;
  status?: string;
  confidence?: number;
}
```

### Heuristic detection order

1. Forwarded content (strong FW:/forward header patterns)
2. Quoted content (blockquote, `On … wrote:`, Outlook `#divRplyFwdMsg`)
3. Legalese (keyword + template patterns)
4. Signature (delimiter `-- `, mobile "Sent from my", contact blocks)
5. Greeting/closing (optional MVP)
6. Remainder → AuthoredContent

### Extensibility

New segment types register with:

- `type` string discriminator
- `schemaVersion` per segment
- Zod schema in `@scomm-office/protocol`

Avoid giant enums in consuming code — use type guards.

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Plain string tags | No structured signature/legalese metadata |
| Single "body" field | Cannot exclude quotes from AI/policy |
| Full NLP pipeline required | Fails offline requirement |

## Security considerations

- Segment text is untrusted — sanitize before HTML render
- `StructuredDataSegment` must validate embedded JSON with Zod
- Do not execute URLs or scripts found in segments

## Compatibility

- Plain-text emails map to segments without HTML ranges
- Round-trip: segments reconstruct approximate body for display only (not identical HTML)

## Open questions

- Schema UID registry integration with broader SComm ecosystem
- Minimum confidence to promote heuristic → typed vs Unknown
- AttachmentReference linking to Office attachment IDs

## Decision

**MVP ships discriminated union with heuristic detection for AuthoredContent, QuotedContent, Signature, Unknown. Extended types defined in schema; Legalese and Forwarded targeted in Milestone 4+.**

## Implementation status

| Item | Status |
|------|--------|
| Type definitions | Planned |
| Heuristic detectors | Planned (Milestone 4) |
| Fixture tests | Planned |
| Zod schemas in protocol | Planned |

## Deferred work

- AI-assisted segment boundary refinement
- Multilingual quote/signature patterns
- Segment-level digital signatures

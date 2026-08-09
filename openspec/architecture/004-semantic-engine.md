# 004 — Semantic Engine Pipeline

## Status

**Accepted**

## Context

SComm's core value is structured understanding of email content: separating newly authored text from quotes, signatures, legalese, and extracting actions/entities. This must work in Outlook without requiring a remote AI service for baseline functionality.

The semantic engine lives in `packages/semantics` and must have **zero dependency on Office.js**.

## Problem

Raw email HTML conflates authored content, reply history, signatures, and disclaimers. Treating the entire body as "the message" breaks compliance rules, AI summarization, and semantic metadata. A monolithic parser becomes unmaintainable.

## Goals

- Transform **`RawMailDocument`** → **`SemanticMailDocument`**
- Multi-phase pipeline with deterministic heuristics first
- Discriminated union for body segments (see [typed-body-segments](../features/typed-body-segments.md))
- Canonical serialization + SHA-256 digest for header stamping
- Optional AI extraction via pluggable `SemanticExtractor`
- Full unit test coverage using HTML fixtures (no Outlook required)

## Non-goals

- Perfect NLP accuracy in MVP
- Mandatory cloud AI for parsing
- Mutating original email HTML in place
- Storing full semantic document in internet headers

## Constraints

- Input may be HTML, plain text, or both
- Malicious HTML must not execute during parsing (no `innerHTML` → React without sanitization)
- Parsing must complete in task pane without blocking UI (debounce on compose changes)
- `OnMessageSend` handler cannot depend on long-running AI calls

## Proposed design

### Input model

```typescript
interface RawMailDocument {
  subject?: string;
  plainText?: string;
  html?: string;
  from?: MailAddress;
  to?: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  attachments?: MailAttachmentDescriptor[];
  headers?: Record<string, string>;
}
```

Assembled by a coordinator from `MailHost` (+ optional Graph thread context).

### Output model

```typescript
interface SemanticMailDocument {
  version: string;                    // e.g. "1.0"
  segments: SemanticBodySegment[];
  entities: SemanticEntity[];
  actions: SemanticAction[];
  classification?: SemanticClassification;
  metadata: Record<string, unknown>;
}
```

### Pipeline phases

```text
RawMailDocument
      │
      ▼
1. HTML normalization
      │  (strip scripts, normalize whitespace, optional plain-text fallback)
      ▼
2. Structural detection (heuristics)
      │  ├── quoted content (blockquote, "On … wrote:", Outlook dividers)
      │  ├── forwarded content (FW:/Fwd: patterns, forward headers)
      │  ├── signature (-- , mobile signatures, contact blocks)
      │  ├── legalese (confidentiality boilerplate)
      │  └── authored content (remainder)
      ▼
3. Semantic extraction
      │  ├── email addresses, URLs
      │  ├── dates (basic patterns)
      │  ├── actions (question/request heuristics)
      │  └── classification hints
      ▼
4. Optional AI enrichment (AiSemanticExtractor — stub in MVP)
      ▼
SemanticMailDocument
```

### Extractor interface

```typescript
interface SemanticExtractor {
  extract(input: SemanticExtractionInput): Promise<SemanticExtractionResult>;
}

// MVP implementations:
class HeuristicSemanticExtractor implements SemanticExtractor { /* ... */ }
class AiSemanticExtractor implements SemanticExtractor {
  async extract() {
    throw new UnsupportedFeatureError("AI extraction not configured");
  }
}
```

### Digest for headers

```typescript
function canonicalizeSemanticDocument(doc: SemanticMailDocument): string;
async function sha256SemanticDocument(doc: SemanticMailDocument): Promise<string>;
```

Uses WebCrypto SHA-256 in browser; Node `crypto` in server tests.

Digest is written to `X-SComm-Semantic-Digest`; full document is **not** placed in headers ([scomm-message-headers](../features/scomm-message-headers.md)).

### Compose-time vs send-time

| Phase | When | Work |
|-------|------|------|
| Compose analysis | Task pane + `OnMessageCompose` | Incremental heuristic parse, debounced |
| Send validation | `OnMessageSend` | Read cached semantic model; policy check; stamp headers |

Semantic computation at send time uses **cached compose state**, not fresh AI calls.

### Thread context

Inter-message history prefers Graph `conversationId` over nested quoted bodies ([conversation-semantics](../features/conversation-semantics.md)).

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Single-pass regex parser | Unmaintainable; poor accuracy |
| AI-only extraction | Fails offline; latency on send path |
| Full semantic doc in headers | Exchange header size limits (~32 KB total) |

## Security considerations

- HTML parsing in isolated pipeline; sanitize before any preview render
- Treat extracted entities/actions as untrusted hints until policy validates
- AI extractor receives redacted/minimal context when enabled
- Digest detects tampering of semantic metadata but is not a signature ([semantic-signatures](../security/semantic-signatures.md))

## Compatibility

- Works identically on `MockMailHost` fixtures and live Outlook items
- Plain-text-only messages supported via text heuristics
- Unknown structures fall back to `UnknownSegment` type

## Open questions

- Schema versioning strategy for segment types
- Minimum confidence threshold for segment display vs `Unknown`
- Server-side semantic persistence API shape

## Decision

**MVP implements `HeuristicSemanticExtractor` with AuthoredContent, QuotedContent, Signature, and Unknown segments minimum.** AI extraction stubbed. Digest canonicalization shipped. Full semantic JSON displayed in task pane and dev-console.

## Implementation status

| Item | Status |
|------|--------|
| `RawMailDocument` / `SemanticMailDocument` types | Planned |
| `HeuristicSemanticExtractor` | Planned (Milestone 4) |
| `AiSemanticExtractor` stub | Planned |
| Digest functions | Planned (Milestone 9) |
| Fixture tests | Planned |

## Deferred work

- ML-based segment classification
- Cross-language signature/quote detection
- `application/scomm+json` MIME attachment ([scomm-mime](../features/scomm-mime.md))
- Server-side semantic repository

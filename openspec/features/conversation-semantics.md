# Conversation Semantics

## Status

**Accepted**

## Context

Email threads appear in a single message body as nested quotes, but the **authoritative thread history** for SComm should come from mailbox conversation metadata when available — not from recursively parsing quoted HTML.

Microsoft Graph exposes `conversationId` linking messages in a thread. Office.js may expose conversation ID on the current item depending on mode.

## Problem

Quoted-body parsing alone:

- Misses messages not included in quotes
- Duplicates content across nested quotes
- Misclassifies old thread text as newly authored
- Breaks when users delete quote history or use partial replies

## Goals

- Treat **newly authored portion** as primary semantic input
- Classify inline quotes as `QuotedContent` / `ForwardedContent` only
- Prefer **Graph `conversationId`** for inter-message thread context
- Document fallback when Graph unavailable

## Non-goals

- Rebuilding full thread semantics from quotes when Graph fails
- Storing entire thread in SComm headers
- Real-time thread sync

## Constraints

- Graph requires NAA + `Mail.Read` ([graph-authentication](../microsoft/graph-authentication.md))
- Compose mode may not have stable message IDs until send
- Event handlers cannot perform slow Graph fan-out

## Proposed design

### Intra-message vs inter-message

| Scope | Source | Segment types |
|-------|--------|---------------|
| Intra-message (single body) | MailHost body HTML/text | AuthoredContent, QuotedContent, ForwardedContent, Signature, … |
| Inter-message (thread) | Graph `getConversationMessages(conversationId)` | Separate `ThreadMessageSummary[]` attached to semantic metadata |

```typescript
interface SemanticExtractionInput {
  document: RawMailDocument;
  threadContext?: ThreadContext;
}

interface ThreadContext {
  conversationId: string;
  messages: ThreadMessageSummary[];  // ordered, from Graph
  source: "graph" | "none";
}
```

### Coordinator logic

```typescript
async function buildSemanticInput(mailHost: MailHost, graph?: MicrosoftGraphClient) {
  const document = await mailHostToRawDocument(mailHost);
  let threadContext: ThreadContext | undefined;

  if (graph && capabilities.nestedAppAuthentication) {
    const conversationId = await mailHost.getConversationId?.();
    if (conversationId) {
      const messages = await graph.getConversationMessages(conversationId);
      threadContext = { conversationId, messages: summarize(messages), source: "graph" };
    }
  }

  return { document, threadContext };
}
```

### Semantic metadata usage

- **Policy engine** may consider thread participants from Graph (external domain detection)
- **AI summarization** uses authored segment + optional thread summaries (not full quoted HTML)
- **UI** shows "Thread: N messages (via Graph)" vs "Thread: inferred from quotes only"

### Fallback when Graph unavailable

```typescript
threadContext = { conversationId: "", messages: [], source: "none" };
```

UI displays warning: "Thread context unavailable — analysis based on visible body only."

Do **not** recursively expand quoted segments as pseudo-thread messages.

### Compose mode

While composing a reply:

- Inline quotes → `QuotedContent` segments
- Graph may not yet index unsent draft — thread context from prior messages only
- Do not fetch Graph on every keystroke; load once on compose open

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Quote-only thread reconstruction | Fragile and incomplete |
| Ignore quotes entirely | Loses inline context for policy |
| Full thread semantic merge into one document | Conflates messages; breaks digest per message |

## Security considerations

- Graph thread may include messages user hasn't opened — respect `Mail.Read` scope minimization
- Thread summaries for AI must redact BCC-hidden content (Graph may not expose BCC to non-senders)
- conversationId is opaque — do not expose in external headers

## Compatibility

- Read mode: Graph enrichment most valuable
- Compose mode: inline quote heuristics primary
- MockGraph returns fixture threads in tests

## Open questions

- `Office.context.mailbox.item.conversationId` availability matrix
- Caching thread fetch per conversationId in compose session
- Maximum thread depth for Graph fetch (pagination)

## Decision

**Prefer Graph `conversationId` for inter-message context. Inline quotes classified as QuotedContent/ForwardedContent only — never promoted to authored. Graph unavailable → body-only analysis with explicit UI disclaimer.**

## Implementation status

| Item | Status |
|------|--------|
| ThreadContext types | Planned |
| Graph conversation fetch | Planned (Milestone 7) |
| Coordinator integration | Planned |
| Quote-only fallback UX | Planned |

## Deferred work

- Thread-level semantic aggregation (cross-message action tracking)
- Server-side conversation index
- Partial thread sync for offline

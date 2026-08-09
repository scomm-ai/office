# Event-Based Activation

## Status

**Proposed**

## Context

Outlook **LaunchEvent** handlers run JavaScript in response to mailbox events without opening the task pane. SComm Office uses them for compose-time analysis and send-time policy enforcement (Smart Alerts).

Microsoft docs: [Activate add-ins with events](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/autolaunch).

## Problem

Task pane alone cannot intercept message send or run lightweight compose hooks when the pane is closed. Compliance features (header stamping, policy warn/block) require event handlers with strict latency budgets.

## Goals

- Scaffold **`OnMessageCompose`**, **`OnMessageSend`**, and **`OnMessageDecrypt`** handlers
- Map internal `SendDecision` to Smart Alert outcomes
- Use cached semantic state at send time (no AI on send path)
- Graceful no-op when requirement sets or manifest entries unavailable

## Non-goals

- Long-running operations in event handlers
- Full E2EE decrypt in MVP
- Supporting mobile LaunchEvent (not available)

## Constraints

- `OnMessageSend` requires Mailbox **1.12+** and manifest LaunchEvent configuration
- Event handler runs in JavaScript runtime with limited UI (Smart Alert dialog only for send)
- Execution time: design for **< 5 seconds** practical target
- Networking in send handler risky — prefer pre-computed state
- `OnMessageDecrypt` is experimental; E2EE protocol not finalized

## Proposed design

### Handler architecture

```text
manifest.xml (LaunchEvent)
        │
        ▼
event-handlers.js (lightweight entry)
        │
        ▼
SendPipeline / ComposePipeline (packages/office)
        │
        ├── read cached SemanticMailDocument
        ├── PolicyEngine.evaluate()
        ├── ScommMessageMetadataAdapter.write()  (headers)
        └── return SendDecision → Smart Alert mapping
```

### OnMessageCompose

**Purpose:** Warm semantic cache when user opens compose form.

```typescript
async function onMessageComposeHandler(event: Office.AddinCommands.Event) {
  if (!capabilities.onMessageCompose) {
    event.completed();
    return;
  }
  try {
    const raw = await mailHost.getCurrentMessage();
    const semantic = await heuristicExtractor.extract({ document: raw });
    composeSessionCache.set(itemId, semantic);
  } finally {
    event.completed();
  }
}
```

Debounced updates also occur from task pane when open.

### OnMessageSend (Smart Alerts)

**Purpose:** Policy check + SComm header stamp before send.

```typescript
interface SendDecision {
  mode: "allow" | "warn" | "block";
  message?: string;
  findings?: PolicyFinding[];
}
```

Mapping to Office.js:

| SendDecision | Smart Alert action |
|--------------|-------------------|
| `allow` | `event.completed({ allowEvent: true })` |
| `warn` | `event.completed({ allowEvent: true, errorMessage: message })` or promptUser per API |
| `block` | `event.completed({ allowEvent: false, errorMessage: message })` |

Pipeline steps:

1. Collect minimal metadata (recipients, subject, attachment count)
2. Load cached `SemanticMailDocument` (or quick heuristic re-parse)
3. Run `PolicyEngine.evaluate()`
4. Write `X-SComm-*` headers if `internetHeaders` capable
5. Return decision

**No AI calls. No IDR connections. No pubkey SET.**

### OnMessageDecrypt (stub)

**Purpose:** Future hook for SComm E2EE when protocol is defined.

```typescript
async function onMessageDecryptHandler(event: Office.AddinCommands.Event) {
  // @experimental — see openspec/security/e2ee-protocol.md
  throw new UnsupportedFeatureError(
    "OnMessageDecrypt: E2EE protocol not finalized"
  );
}
```

Registered in manifest only when `capabilities.onMessageDecrypt && experimentalEncryptionEnabled`.

### Manifest (add-in-only XML MVP)

```xml
<ExtensionPoint xsi:type="LaunchEvent">
  <LaunchEvents>
    <LaunchEvent Type="OnMessageCompose" FunctionName="onMessageCompose"/>
    <LaunchEvent Type="OnMessageSend" FunctionName="onMessageSend"/>
    <!-- OnMessageDecrypt deferred -->
  </LaunchEvents>
  <SourceLocation resid="eventHandlersUrl"/>
</ExtensionPoint>
```

Requires `"permissions": "ReadWriteItem"` or appropriate send permission.

### Session cache

```typescript
interface ComposeSessionCache {
  get(itemId: string): SemanticMailDocument | null;
  set(itemId: string, doc: SemanticMailDocument): void;
  invalidate(itemId: string): void;
}
```

In-memory for MVP; keyed by compose item ID from Office.js.

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Send interception via task pane only | Cannot block send when pane closed |
| Full re-parse on every send | Latency risk |
| Infobar API only | Weaker enforcement than Smart Alerts |

## Security considerations

- Event handlers run with user's mailbox permissions — do not exfiltrate body to third parties
- Policy block/warn messages must not leak internal policy IDs to external recipients
- Header write failures should not silently pass non-compliant sends (configurable strict mode)

## Compatibility

- Not available: Outlook mobile, some older desktop builds
- Smart Alert UI varies by host — test on OWA and new Outlook

## Open questions

- Exact `promptUser` vs `errorMessage` API for warn mode on each host
- Whether compose cache survives item switch within same window
- Admin deployment of LaunchEvent via Centralized Deployment

## Decision

**MVP implements OnMessageCompose + OnMessageSend framework with cached semantics and policy mapping. OnMessageDecrypt remains stubbed behind feature flag. No network I/O on send path.**

## Implementation status

| Item | Status |
|------|--------|
| Event handler entry files | Planned (Milestone 8) |
| SendPipeline | Planned |
| ComposeSessionCache | Planned |
| OnMessageDecrypt stub | Planned (Milestone 10) |
| Smart Alert mapping tests | Planned |

## Deferred work

- Production OnMessageDecrypt with finalized E2EE
- Unified manifest LaunchEvent schema
- Multi-rule policy aggregation UX in Smart Alert dialog

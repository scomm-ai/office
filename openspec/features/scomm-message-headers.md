# SComm Message Headers

## Status

**Accepted**

## Context

SComm protocol metadata travels in email **Internet Headers** where Outlook supports read/write (Mailbox 1.8+). Headers provide interoperability hints for SComm-aware clients without breaking ordinary mail clients.

Constants defined in `@scomm-office/protocol` (`packages/protocol/src/headers.ts`).

## Problem

Stuffing full semantic JSON into headers exceeds Exchange size limits (~32 KB total custom headers) and leaks internal structure to all MTAs. Missing headers break digest verification and client detection.

## Goals

- Define compact **`X-SComm-*`** header set
- Read/write via `ScommMessageMetadataAdapter` on capable hosts
- Store digests and UIDs in headers; large semantics elsewhere
- Version all protocol fields

## Non-goals

- Full `SemanticMailDocument` in headers
- Non-standard headers without `X-` prefix (MVP)
- S/MIME integration in MVP

## Constraints

- Outlook `internetHeaders.setAsync` requires compose mode + Mailbox 1.8+
- Header names and values must be ASCII-safe strings
- Total custom header budget limited — keep each value small

## Proposed design

### Header constants

| Header | Purpose | Example value size |
|--------|---------|-------------------|
| `X-SComm-Version` | Protocol version | `1` |
| `X-SComm-Message-UID` | Stable message identifier | ~40 chars |
| `X-SComm-Schema` | Semantic schema version | `semantics/1.0` |
| `X-SComm-Semantics` | Compact semantics reference | URI or short token, not full JSON |
| `X-SComm-Semantic-Digest` | SHA-256 of canonical semantic doc | 64 hex chars |
| `X-SComm-Classification` | Short classification code | `internal`, `confidential`, … |
| `X-SComm-Security` | Security flags bitmask or JSON token | compact |

### ScommMessageMetadata model

```typescript
interface ScommMessageMetadata {
  version: string;
  messageUid?: string;
  schema?: string;
  semanticsRef?: string;      // e.g. server URL or "inline:pending"
  semanticDigest?: string;    // sha256 hex
  classification?: string;
  security?: string;
}
```

### Adapter interface

```typescript
interface ScommMessageMetadataAdapter {
  read(): Promise<ScommMessageMetadata | null>;
  write(metadata: ScommMessageMetadata): Promise<void>;
}
```

Outlook implementation uses `Office.context.mailbox.item.internetHeaders`.

### Write workflow (compose / OnMessageSend)

1. Generate or reuse `messageUid` via `UidProvider`
2. Compute `semanticDigest` from cached `SemanticMailDocument`
3. Set `X-SComm-Semantics` to short reference:
   - MVP: `"local"` or dev-server URL if persisted
   - Not: base64-encoded full JSON
4. Write headers via adapter (capability-gated)

### Read workflow (read mode)

1. Read headers via adapter
2. If digest present, optionally fetch full semantics from server/ref
3. Display metadata in task pane Security/Semantics modules

### OnMessageSend integration

Send handler stamps headers from cached metadata — no recomputation of heavy semantics.

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Custom MIME part only | Requires [scomm-mime](./scomm-mime.md) — deferred |
| Single JSON header | Size limits; MTA stripping risk |
| Transport Rules instead of headers | Not portable across clients |

## Security considerations

- Headers are attacker-controlled on inbound mail — validate all values with Zod
- Digest alone is not authenticity ([semantic-signatures](../security/semantic-signatures.md))
- Do not put secrets or private key material in headers
- Log header names in audit, not values containing PII

## Compatibility

- Ordinary clients ignore unknown `X-SComm-*` headers
- SComm native client should read same header names for interoperability
- Missing headers → treat message as non-SComm-enhanced

## Open questions

- Exact `X-SComm-Semantics` reference format (URL vs CID vs attachment part-id)
- Classification vocabulary standardization
- Header preservation rate across forwarding gateways

## Decision

**MVP writes `X-SComm-Version`, `X-SComm-Message-UID`, `X-SComm-Semantics` (compact ref), and `X-SComm-Semantic-Digest`. Full semantic document stored locally/server-side, not in headers.**

## Implementation status

| Item | Status |
|------|--------|
| Header constants | Planned |
| Zod metadata schema | Planned |
| `OutlookScommHeaderAdapter` | Planned (Milestone 9) |
| Digest integration | Planned |

## Deferred work

- `X-SComm-Security` encryption indicators when E2EE finalized
- Header signing
- Gateway normalization testing

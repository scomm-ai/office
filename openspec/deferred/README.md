# Deferred Work Index

## Status

**Accepted**

## Context

SComm Office MVP deliberately defers features where requirements are incomplete, platform support is unverified, or security review is pending. Each deferred item links to its OpenSpec for interface stubs and TODO references in code.

## Problem

Without a central deferred index, contributors implement speculative features or duplicate decision records.

## Goals

- Single checklist of out-of-scope MVP work
- Link every item to authoritative spec
- Track implementation stub locations

## Non-goals

- Project management ticketing (use GitHub issues separately)
- Commitment dates for deferred items

## Constraints

- Deferred ≠ cancelled — interfaces remain for compile-time integration
- Stubs must throw `UnsupportedFeatureError` or equivalent with OpenSpec link

## Proposed design

### Deferred features

| Item | Spec | Reason |
|------|------|--------|
| **Production E2EE** | [e2ee-protocol](../security/e2ee-protocol.md) | Protocol NOT FINALIZED |
| **Semantic signing** | [semantic-signatures](../security/semantic-signatures.md) | Digest only in MVP |
| **Durable private key storage** | [private-key-storage](../security/private-key-storage.md) | Host persistence unverified |
| **`application/scomm+json` MIME** | [scomm-mime](../features/scomm-mime.md) | Outlook MIME unverified |
| **WebRTC platform guarantees** | [webrtc-host-support](../microsoft/webrtc-host-support.md) | Under Investigation |
| **OnMessageDecrypt production** | [e2ee-protocol](../security/e2ee-protocol.md) | Depends on E2EE |
| **Production pubkey API contract** | [pubkey-server-api](../features/pubkey-server-api.md) | Ecosystem alignment pending |
| **PostgreSQL persistence** | [001-monorepo](../architecture/001-monorepo.md) | MVP in-memory repos |
| **Cloud AI providers** | [ai-trust-boundary](../security/ai-trust-boundary.md) | IDR/local first |
| **Unified Outlook manifest** | [requirement-sets](../microsoft/requirement-sets.md) | XML manifest for MVP |
| **Graph fallback auth** | [graph-authentication](../microsoft/graph-authentication.md) | NAA-only for MVP |
| **Formal compliance certification** | [threat-model](../security/threat-model.md) | Not attested |
| **Server-issued SComm UIDs** | [scomm-message-headers](../features/scomm-message-headers.md) | Local UID provider for MVP |
| **Enterprise key escrow** | [private-key-storage](../security/private-key-storage.md) | Policy undefined |
| **Penetration testing** | [threat-model](../security/threat-model.md) | Pre-GA activity |

### Stub pattern

```typescript
/**
 * @experimental
 * See openspec/security/e2ee-protocol.md
 */
export class ExperimentalMessageEncryptor implements MessageEncryptor {
  async encrypt(): Promise<EncryptedMessage> {
    throw new UnsupportedFeatureError(
      "SComm E2EE protocol has not yet been finalized"
    );
  }
}
```

### Code TODO convention

```typescript
// TODO(openspec/security/e2ee-protocol.md): Implement envelope v1
```

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Implement without spec | Violates project anti-speculation rule |
| Remove stubs entirely | Breaks vertical architecture compile |

## Security considerations

- Deferred security features must remain **off by default**
- Feature flags for experimental paths require explicit user/org opt-in
- Never ship dev-only key storage in production builds

## Compatibility

- MVP success criteria ([implementation plan](../../README.md)) explicitly allow deferred areas with OpenSpec coverage

## Open questions

- Priority order post-MVP (recommended: WebRTC matrix → pubkey contract → MIME verification → E2EE spec)

## Decision

**All items in the table above are deferred for MVP. Implement interfaces + stubs + OpenSpec only.**

## Implementation status

| Item | Status |
|------|--------|
| Deferred index | This document |
| Per-feature stubs | In progress with milestones |

## Deferred work

(Meta: future deferred items should be appended to the table above with spec links.)

### Recommended next specs to write

- Server-issued UID integration
- SComm server authentication federation
- PostgreSQL repository schema
- Outlook MIME capability test results (update scomm-mime.md)

# Deferred Work Index

## Status

**Accepted**

## Context

SComm Office deliberately defers features where requirements are incomplete, platform support is unverified, or security review is pending. Auth/billing, production pubkey discovery, IDR embed, and Local+Cloud BYOAI are **in scope** for the client-only phase ([constitution](../constitution.md)).

## Goals

- Single checklist of out-of-scope / later-phase work
- Link every item to authoritative spec
- Track stub locations

## Deferred features

| Item | Spec | Reason |
|------|------|--------|
| **Product Office API server** | [005-no-office-server](../architecture/005-no-office-server.md) | Client-first phase; billing/pubkey/IDR are external |
| **Production E2EE** | [e2ee-protocol](../security/e2ee-protocol.md) | Protocol NOT FINALIZED |
| **Semantic signing** | [semantic-signatures](../security/semantic-signatures.md) | Digest only for now |
| **Durable private key storage** | [private-key-storage](../security/private-key-storage.md) | Host persistence unverified |
| **Pubkey write/bootstrap UI** | [pubkey-server-api](../features/pubkey-server-api.md) | Discovery first; OTP/signed upload P1 |
| **`application/scomm+json` MIME** | [scomm-mime](../features/scomm-mime.md) | Outlook MIME unverified |
| **WebRTC platform guarantees** | [webrtc-host-support](../microsoft/webrtc-host-support.md) | Under Investigation |
| **OnMessageDecrypt production** | [e2ee-protocol](../security/e2ee-protocol.md) | Depends on E2EE |
| **PostgreSQL fixture persistence** | [001-monorepo](../architecture/001-monorepo.md) | Fixture server optional |
| **Unified Outlook manifest** | [requirement-sets](../microsoft/requirement-sets.md) | XML manifest for now |
| **Graph fallback auth** | [graph-authentication](../microsoft/graph-authentication.md) | NAA-only initially |
| **Formal compliance certification** | [threat-model](../security/threat-model.md) | Not attested |
| **Server-issued SComm UIDs** | [scomm-message-headers](../features/scomm-message-headers.md) | Local UID provider |
| **Enterprise key escrow** | [private-key-storage](../security/private-key-storage.md) | Policy undefined |
| **Penetration testing** | [threat-model](../security/threat-model.md) | Pre-GA activity |
| **Full inbox sync / IMAP IDLE** | [constitution](../constitution.md) | Host-bound add-in scope |

## Promoted off deferred (client-only phase)

| Item | Spec |
|------|------|
| Billing / Better Auth client | [006-billing-auth-js](../architecture/006-billing-auth-js.md) |
| Production pubkey discovery | [pubkey-server-api](../features/pubkey-server-api.md) |
| Cloud + Local BYOAI | [byoai](../features/byoai.md) |
| IDR third-party embed | [003-idr-transport](../architecture/003-idr-transport.md) |

## Decision

**Items in the deferred table are later-phase. Client-only auth, billing, pubkey discovery, IDR, and BYOAI proceed under the constitution.**

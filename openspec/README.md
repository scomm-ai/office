# SComm Office — OpenSpec Index

OpenSpec documents capture architecture, feature, security, and Microsoft platform decisions for **SComm Office**: an Outlook-hosted SComm capability layer (client-first Office.js add-in + shared packages). Product paths talk to billing, pubkey, and IDR hosts — not a dedicated Office backend ([constitution](./constitution.md)).

Each spec uses a consistent structure: **Status → Context → Problem → Goals → Non-goals → Constraints → Proposed design → Alternatives → Security considerations → Compatibility → Open questions → Decision → Implementation status → Deferred work**.

## Constitution

| Document | Summary |
|----------|---------|
| [constitution](./constitution.md) | SComm-in-Office parity goal, client-first, dual identity, entitlements, trust |

## Architecture

| Document | Summary |
|----------|---------|
| [001-monorepo](./architecture/001-monorepo.md) | pnpm workspaces, `@scomm-office/*` package map, apps vs packages |
| [002-office-graph-boundary](./architecture/002-office-graph-boundary.md) | `MailHost` (Office.js) vs Microsoft Graph separation |
| [003-idr-transport](./architecture/003-idr-transport.md) | Third-party `@idrto/idr_browser_sdk` embed only |
| [004-semantic-engine](./architecture/004-semantic-engine.md) | `RawMailDocument` → `SemanticMailDocument` pipeline |
| [005-no-office-server](./architecture/005-no-office-server.md) | Client-only product; Fastify is fixture |
| [006-billing-auth-js](./architecture/006-billing-auth-js.md) | `@scomm-office/billing` — Better Auth + license JWT |

## Microsoft / Outlook

| Document | Summary |
|----------|---------|
| [outlook-capabilities](./microsoft/outlook-capabilities.md) | Runtime capability registry; no UA sniffing |
| [requirement-sets](./microsoft/requirement-sets.md) | Mailbox 1.8 headers, 1.12 OnMessageSend, NestedAppAuth 1.1 |
| [event-based-activation](./microsoft/event-based-activation.md) | OnMessageCompose, OnMessageSend Smart Alerts, OnMessageDecrypt stub |
| [webrtc-host-support](./microsoft/webrtc-host-support.md) | Platform matrix — **Under Investigation** |
| [graph-authentication](./microsoft/graph-authentication.md) | MSAL Nested App Authentication, least-privilege scopes |

## Features

| Document | Summary |
|----------|---------|
| [typed-body-segments](./features/typed-body-segments.md) | Discriminated semantic segment union |
| [conversation-semantics](./features/conversation-semantics.md) | Graph `conversationId` over quoted body history |
| [email-identity-normalization](./features/email-identity-normalization.md) | Domain lowercase only; preserve local part |
| [pubkey-server-api](./features/pubkey-server-api.md) | Production pubkey read/write/VKS (same as secMail) |
| [byoai](./features/byoai.md) | Local (IDR) + Cloud BYOAI profiles |
| [scomm-message-headers](./features/scomm-message-headers.md) | Compact `X-SComm-*` headers only |
| [scomm-mime](./features/scomm-mime.md) | `application/scomm+json` — deferred |

## Security

| Document | Summary |
|----------|---------|
| [threat-model](./security/threat-model.md) | Malicious HTML, headers, spoofed sender, pubkey, IDR, AI injection |
| [private-key-storage](./security/private-key-storage.md) | WebCrypto / IndexedDB / Outlook host limits |
| [e2ee-protocol](./security/e2ee-protocol.md) | **NOT FINALIZED** — interfaces and stubs only |
| [semantic-signatures](./security/semantic-signatures.md) | Digest now; signing later |
| [privacy](./security/privacy.md) | Data flow categories and retention |
| [ai-trust-boundary](./security/ai-trust-boundary.md) | Hostile email; no privileged tools from model output |

## Deferred

| Document | Summary |
|----------|---------|
| [deferred index](./deferred/README.md) | Consolidated list of deferred work with links |

## Status legend

| Status | Meaning |
|--------|---------|
| **Accepted** | Decision locked for MVP; implement accordingly |
| **Proposed** | Direction chosen but details may evolve |
| **Draft** | Early thinking; not yet locked |
| **Deferred** | Explicitly out of MVP scope |

## Related code

- Package scope: `@scomm-office/*`
- Email normalization: `packages/core/src/email.ts`
- Errors: `packages/core/src/errors.ts`

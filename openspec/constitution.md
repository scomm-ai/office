# SComm Office Constitution

## Status

**Accepted**

## Purpose

This constitution states non-negotiable product principles for **SComm Office**. OpenSpec feature and architecture docs must remain consistent with it. When a decision conflicts with this document, update the constitution deliberately — do not silently diverge.

## Principles

### 1. SComm-in-Office parity (ongoing desirable goal)

The monorepo exists to bring **as much of SComm (secMail) functionality as reasonably possible** into Microsoft Office applications, **starting with Outlook**, then expanding to other Office hosts where the platform allows.

Parity is a **continuous goal**, not a one-shot MVP checklist. Host constraints (Office.js item scope, WebView storage, CSP, WebRTC) may force alternative transports (for example IDR instead of desktop SComm Connect), but capability intent should track secMail.

### 2. Client-first; no product Office backend (current phase)

Product paths must not depend on a dedicated SComm Office server. Prefer direct clients to existing ecosystem services:

| Concern | Host |
|---------|------|
| Profile / billing SSO + entitlements | Billing host (Better Auth + `/api/v1/*`) |
| Public keys | Production pubkey service (same as secMail) |
| Local AI / BYOM routing | Third-party [idr.to](https://idr.to) browser SDK |

A Fastify app under `apps/server` may remain as a **local/test fixture only**. Introduce a product Office backend only in a later, explicit phase.

### 3. Dual identity

Mailbox/host identity (Office.js / future Graph Nested App Auth) is **separate** from profile/billing SSO (Better Auth on the billing host). Mirror secMail’s mailbox auth vs `app_auth` split. Never conflate mailbox OAuth tokens with billing license JWTs.

### 4. Entitlements gate premium capability

License JWTs are verified **client-side** (ES256 public PEM). Checkout, invoices, and seat admin stay on the billing portal. Premium AI, connectors, and future crypto add-ons require active entitlement claims (`hasAddon` / `hasPlan` / `hasProduct`).

### 5. Trust boundaries

- Mail content stays in the Outlook host / add-in WebView; billing and pubkey servers must not receive mailbox message bodies or Graph tokens.
- AI model output must not drive privileged actions alone ([ai-trust-boundary](./security/ai-trust-boundary.md)).
- Never upload private keys to the pubkey directory — public keys and possession proofs only.
- IDR is a **user/org subscription to a third party**; SComm Office embeds the browser SDK and does not proxy IDR.

## Decision

**Lock these principles for the client-only phase.** Architecture and feature specs (`005-no-office-server`, `006-billing-auth-js`, pubkey production contract, BYOAI, IDR) implement them.

## Related

- [001-monorepo](./architecture/001-monorepo.md)
- [005-no-office-server](./architecture/005-no-office-server.md)
- [006-billing-auth-js](./architecture/006-billing-auth-js.md)
- [003-idr-transport](./architecture/003-idr-transport.md)
- [pubkey-server-api](./features/pubkey-server-api.md)
- [byoai](./features/byoai.md)

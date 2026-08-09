# Public Key Server API

## Status

**Accepted**

## Context

SComm Office and secMail share the **production pubkey service** (`pubkey` read/write processes). Early MVP proposed a Fastify `/api/v1/identities/...` directory; that contract is **obsolete for product paths**. See [constitution](../constitution.md) and [005-no-office-server](../architecture/005-no-office-server.md).

Canonical schema and routes: ecosystem `pubkey` docs (`docs/SCHEMA.md`).

## Problem

A parallel MVP API drifts from secMail’s `sdk_pubkey` and production discovery (preference + VKS).

## Goals

- Client discovery against production **read** APIs: `GET /keys/preference`, `GET /vks/v1/by-email/:email`
- Later: OTP bootstrap + signed **write** upload (possession proofs) — same as secMail
- Keep `PublicKeyDirectory` application interface; adapt wire shapes
- Never upload private keys

## Non-goals

- Shipping Office’s Fastify pubkey routes as production
- Web-of-trust or DNS discovery in this phase
- Fingerprint-only lookup (production is email-scoped)

## Constraints

- Read/write base URLs: `VITE_PUBKEY_READ_BASE_URL` / `VITE_PUBKEY_WRITE_BASE_URL`
- Wire encoding: base64url without padding for auth signatures/blobs
- Identity emails use [email normalization](./email-identity-normalization.md)

## Proposed design

### Production discovery (P0)

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/keys/preference?email=&usage=encrypt\|sign` | Public |
| `GET` | `/vks/v1/by-email/:email` | Public |
| `GET` | `/keys/revoked` | Public |
| `GET` | `/health` | Public |

### Write / bootstrap (P1 follow-on)

OTP bootstrap (`POST /auth/bootstrap`, verify) → `FetchToken`; signed requests (`X-Auth-Payload` / `X-Auth-Signature`); `POST /keys` with possession proof.

### Client

`@scomm-office/pubkeys`:

- `ProductionPubkeyDirectory` — preference + VKS → normalized `PublicKeyRecord[]`
- Retain `MockPublicKeyDirectory` for tests
- Legacy `HttpPublicKeyDirectory` (`/api/v1/identities/...`) fixture-only against `apps/server`

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Keep Fastify as product directory | Diverges from secMail; violates client-first constitution |
| Hard DELETE keys | Production prefers archive/revoke semantics |

## Security considerations

- Finding a key ≠ proving ownership (trust UI separate)
- Rate limits and TLS on production hosts
- Private keys never leave `@scomm-office/storage` / WebCrypto

## Decision

**Product clients use production pubkey read (then write) contracts. Fastify MVP routes are fixtures only.**

## Implementation status

| Item | Status |
|------|--------|
| Production discovery adapter | In progress |
| Bootstrap/upload UI | Deferred to P1 (interfaces remain) |
| Fixture Fastify routes | Demoted |

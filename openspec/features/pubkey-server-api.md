# Public Key Server API

## Status

**Proposed**

## Context

SComm Office synchronizes **public keys only** with a SComm Public Key Directory for identity discovery and future encryption. The external production API contract is not finalized; MVP implements the **`PublicKeyDirectory`** interface against a mock Fastify server.

## Problem

Without a documented API shape, client and server implementations diverge. Hard DELETE of keys destroys audit history needed for trust decisions and revocation.

## Goals

- Propose REST endpoints for GET/PUT key records
- Model **key states** (active, revoked, expired, superseded)
- Prefer **revocation** over destructive delete
- Zod-validated `PublicKeyRecord` in `@scomm-office/protocol`
- `HttpPublicKeyDirectory` + `MockPublicKeyDirectory` clients

## Non-goals

- Finalizing production SComm ecosystem pubkey server URL
- Private key upload (forbidden)
- Web-of-trust or certificate pinning in MVP
- Key discovery via DNS (deferred)

## Constraints

- Never upload private keys
- Identity path segments must use [normalized email](./email-identity-normalization.md)
- Records versioned (`version: 1`)
- Server auth via `ScommAuthProvider` abstraction (dev token in MVP)

## Proposed design

### PublicKeyRecord model

```typescript
interface PublicKeyRecord {
  version: 1;
  identity: {
    type: "email" | "scomm-uid" | "other";
    value: string;
  };
  keyId: string;
  algorithm: "Ed25519" | "X25519" | string;
  publicKey: string;
  encoding: "base64url" | "jwk";
  purpose: "signing" | "encryption" | "authentication";
  state: "created" | "active" | "revoked" | "expired" | "superseded";
  createdAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  supersededBy?: string;
  metadata?: Record<string, unknown>;
}
```

### Key states

| State | Meaning |
|-------|---------|
| `created` | Registered but not yet active |
| `active` | Usable for verification/encryption |
| `revoked` | Explicitly revoked; must not be used |
| `expired` | Past `expiresAt` |
| `superseded` | Replaced by newer keyId |

Clients must not cache revoked/expired records beyond TTL.

### Proposed REST API

Base: `{SCOMM_PUBKEY_BASE_URL}/v1`

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/identities/{identityType}/{identity}/keys/{keyId}` | Upsert public key record |
| `GET` | `/identities/{identityType}/{identity}/keys` | List keys for identity (filterable by state) |
| `GET` | `/identities/{identityType}/{identity}/keys/{keyId}` | Get specific key |
| `POST` | `/identities/{identityType}/{identity}/keys/{keyId}/revoke` | Transition to `revoked` |

**Avoid hard DELETE** for trust audit trail. If DELETE exists, it should soft-delete (tombstone) only.

Query parameters for GET list:

- `state=active` (default for clients)
- `purpose=encryption`

### Example PUT body

```json
{
  "version": 1,
  "identity": { "type": "email", "value": "alice@example.com" },
  "keyId": "key-2026-01",
  "algorithm": "Ed25519",
  "publicKey": "base64url...",
  "encoding": "base64url",
  "purpose": "signing",
  "state": "active",
  "createdAt": "2026-08-08T00:00:00Z"
}
```

### Client interface

```typescript
interface PublicKeyDirectory {
  getKeys(identity: ScommIdentity): Promise<PublicKeyRecord[]>;
  setKey(record: PublicKeyRecord): Promise<PublicKeyRecord>;
  revokeKey?(identity: ScommIdentity, keyId: string, reason?: string): Promise<void>;
}
```

### Trust model (separate from discovery)

```typescript
type KeyTrust =
  | "unknown"
  | "directory-asserted"
  | "verified"
  | "organization-verified"
  | "user-verified";
```

Finding a key ≠ proving ownership. UI must distinguish discovery from trust.

### MVP server

`apps/server` implements in-memory store with proposed routes. Config: `SCOMM_PUBKEY_BASE_URL` defaults to local server.

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Hard DELETE keys | Loses revocation audit trail |
| Keybase-style proofs in v1 | Complexity; defer |
| Single global key per identity | No rotation support |

## Security considerations

- Authenticate PUT/revoke (dev token MVP; Entra federation later)
- Rate limit lookups to prevent enumeration
- Validate algorithm allowlist server-side
- TLS required in production
- Monitor for pubkey substitution attacks ([threat-model](../security/threat-model.md))

## Compatibility

- Align with standalone SComm ecosystem when contract published
- URL-encode identity paths (`alice@example.com` → path segment encoding)

## Open questions

- Who may PUT keys for an email identity (proof of mailbox control?)
- Federation with external WOT or SMIME PKI
- Key rotation grace period semantics

## Decision

**MVP implements proposed PUT/GET + POST revoke against mock server. No hard DELETE. Client filters to `active` keys by default. Production contract subject to ecosystem alignment.**

## Implementation status

| Item | Status |
|------|--------|
| Zod schemas | Planned |
| `HttpPublicKeyDirectory` | Planned (Milestone 5) |
| Mock server routes | Planned |
| In-memory cache | Planned |

## Deferred work

- Proof-of-email-control before PUT
- Organization-verified key workflow
- DNS-based discovery
- PostgreSQL persistence

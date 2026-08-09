# Private Key Storage

## Status

**Proposed**

## Context

SComm Office requires local private key material for future signing and encryption. Outlook add-ins run in browser-like sandboxes with WebCrypto and storage APIs subject to host-specific limits.

**MVP does not implement production durable private key storage.**

## Problem

Plaintext private keys in `localStorage`, downloadable files, or add-in bundle are unacceptable. Outlook hosts differ in IndexedDB persistence, WebCrypto key export support, and session lifetime.

## Goals

- Define **`PrivateKeyStore`** interface
- Use WebCrypto **non-exportable** keys where possible
- Document host limitations honestly
- Ship dev/test storage only for MVP vertical slice
- Support public key SET without durable private key (generate ephemeral keys for demo)

## Non-goals

- Production key backup/recovery in MVP
- Hardware security module integration
- Enterprise key escrow
- Cross-device key sync

## Constraints

- Outlook WebView may clear storage on update or policy
- Non-exportable keys cannot be backed up without separate key ceremony
- IDR SDK uses separate device identity in `sessionStorage` — do not conflate with SComm message keys
- No plaintext production storage — **hard requirement**

## Proposed design

### Key store interface

```typescript
interface PrivateKeyStore {
  generateKeyPair(options: KeyGenOptions): Promise<KeyPairHandle>;
  getSigningKey(keyId: string): Promise<CryptoKey | null>;
  getEncryptionKey(keyId: string): Promise<CryptoKey | null>;
  listKeyIds(): Promise<string[]>;
  deleteKey(keyId: string): Promise<void>;  // dev/test only in MVP
}

interface KeyPairHandle {
  keyId: string;
  publicKey: PublicKeyMaterial;  // exportable for pubkey SET
  algorithm: "Ed25519" | "X25519";
}
```

### Storage layers (preference order)

| Layer | MVP | Production target |
|-------|-----|-------------------|
| WebCrypto non-exportable in IndexedDB | Dev probe | Preferred |
| WebCrypto session-only (no persistence) | Demo | Acceptable for session signing |
| `InMemoryPrivateKeyStore` | Tests | Tests only |
| `DevFilePrivateKeyStore` | Local dev only | **Forbidden in prod build** |
| Plaintext localStorage | **Forbidden** | **Forbidden** |

### WebCrypto generation (Ed25519 signing)

```typescript
const keyPair = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  false,  // non-exportable
  ["sign", "verify"]
);
// Store CryptoKey handle via IndexedDB wrapper (idb-keyval or custom)
```

Export **public** key only for `PublicKeyDirectory.setKey()`.

### Outlook host considerations

| Host | IndexedDB | Notes |
|------|-----------|-------|
| Outlook Web | Likely persistent | Third-party cookie/storage policies evolving |
| New Outlook Windows | WebView2 | Generally persistent |
| Classic Outlook | WebView2 | Verify per build |
| Mac | WKWebView | Verify persistence |

Test matrix not complete — treat persistence as **best effort** until verified.

### MVP workflow

```text
User clicks "Generate identity key"
        │
        ▼
WebCrypto generateKey (non-exportable if supported)
        │
        ├── public key → SET to pubkey server
        └── private key → Dev: InMemory or IndexedDB experimental
                          Prod: throw if only dev store available
```

UI label: **"Experimental — keys may not persist across sessions"**

### Key rotation (future)

1. Generate new keyId
2. SET new public key as `active`
3. POST revoke on old keyId
4. Mark old as `superseded`

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Plaintext IndexedDB | Trivial exfiltration |
| Server-side private keys | Violates E2EE goals |
| Password-wrapped export file | UX + security review needed |

## Security considerations

- Never log key material or JWK private components
- Clear keys on explicit logout (when implemented)
- Warn users on shared machines
- Enterprise may require escrow — separate policy spec

## Compatibility

- Align algorithms with future [e2ee-protocol](./e2ee-protocol.md)
- IDR SDK device keys remain separate system

## Open questions

- Outlook event handler context access to same IndexedDB as task pane
- WebAuthn/passkey as root of trust
- Multi-profile Outlook key isolation

## Decision

**MVP: `PrivateKeyStore` interface + `InMemoryPrivateKeyStore` + experimental IndexedDB adapter behind feature flag. No plaintext production storage. Public key registration works; durable signing deferred.**

## Implementation status

| Item | Status |
|------|--------|
| `PrivateKeyStore` interface | Planned (Milestone 10) |
| In-memory impl | Planned |
| IndexedDB experimental | Planned |
| Production persistence | **Deferred** |

## Deferred work

- Hardware-backed keys (TPM via platform APIs if exposed)
- Secure backup/recovery ceremony
- Enterprise escrow integration
- Cross-device sync

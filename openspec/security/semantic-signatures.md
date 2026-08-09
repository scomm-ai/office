# Semantic Signatures

## Status

**Proposed**

## Context

SComm stamps a **semantic digest** (`X-SComm-Semantic-Digest`) derived from canonical `SemanticMailDocument` JSON. Digital signatures over semantics provide authenticity and tamper evidence — but signing protocol depends on [private-key-storage](./private-key-storage.md) and ecosystem trust rules.

**MVP: digest only. Signing deferred.**

## Problem

Digest alone detects accidental mutation but not malicious forgery — anyone can compute SHA-256 over arbitrary semantic JSON. Users may mistakenly trust digest as proof of sender intent.

## Goals

- Define canonical serialization for deterministic digest
- Implement `sha256SemanticDocument()` in MVP
- Specify future signing envelope without implementing it
- Clear UI distinction: "digest" vs "signed"

## Non-goals

- S/MIME or DKIM replacement
- Signing full email body in MVP
- Timestamp authority integration

## Constraints

- Canonical JSON must be stable across TypeScript and other SComm clients
- Use WebCrypto SHA-256 in browser; Node crypto in server tests
- Signing requires non-exportable private key (not production-ready)

## Proposed design

### Canonicalization (MVP — implemented target)

```typescript
function canonicalizeSemanticDocument(doc: SemanticMailDocument): string {
  // Deterministic JSON:
  // - sorted object keys recursively
  // - arrays preserve order (segment order is semantic)
  // - no insignificant whitespace
  // - UTF-8 NFC normalization on strings
  return stableStringify(doc);
}

async function sha256SemanticDocument(doc: SemanticMailDocument): Promise<string> {
  const canonical = canonicalizeSemanticDocument(doc);
  const bytes = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return hexEncode(hash);
}
```

Written to `X-SComm-Semantic-Digest` at send time ([scomm-message-headers](../features/scomm-message-headers.md)).

### Future signing (non-normative sketch)

```typescript
interface SemanticSignature {
  version: 1;
  keyId: string;
  algorithm: "Ed25519";
  digest: string;       // must match header digest
  signature: string;    // base64url
  signedAt: string;     // ISO8601
}

// Potential header: X-SComm-Semantic-Signature (deferred)
```

Verification pipeline (future):

1. Read `X-SComm-Semantic-Digest` and optional signature header
2. Recompute digest from retrieved semantic document
3. Fetch signer public key from directory
4. Verify Ed25519 signature over digest or canonical bytes
5. Apply [KeyTrust](../features/pubkey-server-api.md) policy

### UI labeling (MVP)

| Display | Meaning |
|---------|---------|
| "Semantic digest present" | SHA-256 computed at send |
| "Signed" | **Not shown in MVP** |
| "Digest mismatch" | Tampering or parse drift |

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Sign full MIME | Complexity; deferred to E2EE spec |
| No digest | Loses tamper detection for semantics |
| HMAC with server secret | Not end-to-end verifiable by recipients |

## Security considerations

- Do not represent digest as cryptographic proof of sender
- Canonicalization bugs cause false mismatch — version canonical algorithm
- Inbound signatures (future) validated before trust UI upgrade

## Compatibility

- Canonical format must match standalone SComm client when signing ships
- Include `schemaVersion` in document for algorithm agility

## Open questions

- Sign digest only vs canonical JSON bytes
- Multiple signatures (sender + organization)
- Counter-signature on forwarded messages

## Decision

**MVP ships canonicalization + SHA-256 digest in header. No signature header. UI never claims "verified sender" based on digest alone.**

## Implementation status

| Item | Status |
|------|--------|
| `canonicalizeSemanticDocument` | Planned (Milestone 9) |
| `sha256SemanticDocument` | Planned |
| Signature format | Deferred |
| Verification UI | Deferred |

## Deferred work

- Ed25519 signing implementation
- `X-SComm-Semantic-Signature` header
- Cross-client test vectors
- Organization co-signing

# End-to-End Encryption Protocol

## Status

**Draft — NOT FINALIZED**

## Context

SComm Office will eventually encrypt message content for recipient public keys. Cryptographic protocol details must be specified before any production encryption is enabled. Outlook provides experimental `OnMessageDecrypt` event hooks.

**This document defines requirements and stubs only. No production E2EE in MVP.**

## Problem

Ad-hoc encryption implementations cause interoperability failures, downgrade vulnerabilities, and key management disasters. Outlook-specific representation (headers vs MIME vs attachments) adds complexity.

## Goals

- Capture protocol design questions for future specification
- Define **`MessageEncryptor`** / **`MessageDecryptor`** interfaces
- Stub implementations throwing `UnsupportedFeatureError`
- Align algorithm choices with SComm ecosystem (Ed25519, X25519, AES-GCM, HKDF)
- Document Outlook representation options

## Non-goals

- Shipping encryption in MVP
- Claiming S/MIME compatibility
- Forward secrecy in v1 (open question)

## Constraints

- Must interoperate with standalone SComm native client (future)
- Must not break non-SComm clients (encrypted payload as attachment or opaque part)
- Algorithm agility required
- `OnMessageDecrypt` scaffold only until protocol locked

## Proposed design

### Interfaces (stubs)

```typescript
interface MessageEncryptor {
  encrypt(
    message: EncryptableMessage,
    recipients: RecipientKeySet[]
  ): Promise<EncryptedMessage>;
}

interface MessageDecryptor {
  decrypt(message: EncryptedMessage): Promise<DecryptedMessage>;
}

/** @experimental — see openspec/security/e2ee-protocol.md */
class ExperimentalMessageEncryptor implements MessageEncryptor {
  async encrypt(): Promise<EncryptedMessage> {
    throw new UnsupportedFeatureError(
      "SComm E2EE protocol has not yet been finalized"
    );
  }
}
```

### Topics requiring specification

| Topic | Questions |
|-------|-----------|
| **Canonical envelope** | JSON? CMS? Custom binary? |
| **Recipient key wrapping** | X25519 ECDH + AES-GCM per recipient? |
| **Sender authentication** | Ed25519 signature over envelope? |
| **Forward secrecy** | Per-message ephemeral keys? |
| **Key rotation** | Multi-key decrypt grace period |
| **Multi-device recipients** | Multiple active encryption keys |
| **Attachment encryption** | Streamed vs whole-file |
| **Associated data** | Bind headers/metadata to ciphertext |
| **Algorithm agility** | Version byte + suite identifier |
| **Downgrade protection** | Signed capability negotiation |
| **Metadata leakage** | Subject/recipient visibility |
| **Outlook representation** | Attachment vs MIME vs header pointer |
| **Native interop** | Byte-identical envelope with Flutter client |

### Draft envelope sketch (non-normative)

```typescript
// ILLUSTRATIVE ONLY — NOT FINAL
interface EncryptedMessage {
  version: 1;
  algorithmSuite: "scomm-v1-x25519-aes256gcm";
  senderKeyId: string;
  recipients: Array<{
    keyId: string;
    wrappedKey: string;  // base64url
  }>;
  ciphertext: string;
  associatedData?: string;
  signature?: string;
}
```

### Outlook integration paths (evaluation)

1. Encrypted blob as `application/octet-stream` attachment
2. `X-SComm-Security` header with pointer to attachment
3. Future `application/scomm+json` encrypted sub-object
4. `OnMessageDecrypt` native hook (when documented)

All paths **unverified**.

### Security metadata header (until E2EE)

`X-SComm-Security: none` or omitted in MVP.

## Alternatives

| Alternative | Why rejected for SComm |
|-------------|------------------------|
| S/MIME only | Ecosystem control; key directory model differs |
| PGP inline | Poor HTML email UX |
| TLS-only | Does not protect at-rest/recipient-forwarding |

## Security considerations

- Never enable experimental encryptor in production builds by default
- Downgrade: attacker strips encryption → policy should warn (future)
- Avoid encrypting with `directory-asserted` keys without user confirmation
- Side-channel risks in JavaScript crypto — prefer WebCrypto

## Compatibility

- Decrypt stub registers only with manifest + feature flag
- Non-SComm clients must receive readable plaintext wrapper until encryption mode

## Open questions

- All items in topics table above
- Legal export classification for shipped crypto
- Third-party crypto audit requirement

## Decision

**Do not implement production E2EE. Interfaces and throwing stubs only. Protocol specification is prerequisite for Milestone beyond MVP.**

## Implementation status

| Item | Status |
|------|--------|
| Encryptor/decryptor interfaces | Planned stub |
| OnMessageDecrypt handler | Scaffold only |
| Protocol spec | **Not written** |

## Deferred work

- Normative protocol document v1
- Interop test vectors with SComm native
- External cryptographic review
- Production encrypt/decrypt implementations
